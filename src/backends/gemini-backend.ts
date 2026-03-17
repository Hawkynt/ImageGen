import type { Page } from "playwright";
import { BrowserBackendBase } from "./browser-backend-base.js";
import type { BrowserBackendConfig } from "./backend-provider.js";
import { debug, debugSaveScreenshot } from "../debug/logger.js";

const COMPONENT = "gemini-backend";

export class GeminiBackend extends BrowserBackendBase {
  readonly name = "gemini";
  protected override readonly hasWatermark = true;

  protected config: BrowserBackendConfig = {
    name: "gemini",
    url: "https://gemini.google.com/app",
    loginUrl: "https://gemini.google.com/app",
    hints: {},
  };

  protected override async beforeInteraction(page: Page): Promise<void> {
    debug(COMPONENT, "Running Gemini-specific pre-interaction steps...");

    // Wait for page to fully load
    await page.waitForTimeout(3000);

    // Debug: capture what we see
    const screenshot = await page.screenshot();
    debugSaveScreenshot("gemini_before_interaction", screenshot);

    // Try to dismiss any "welcome" or "cookie" dialogs
    const dismissSelectors = [
      'button:has-text("Got it")',
      'button:has-text("Accept")',
      'button:has-text("Dismiss")',
      'button:has-text("Close")',
      'button:has-text("OK")',
      'button:has-text("No thanks")',
      'button:has-text("Skip")',
    ];

    for (const selector of dismissSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 500 })) {
          debug(COMPONENT, `Dismissing dialog: ${selector}`);
          await btn.click();
          await page.waitForTimeout(500);
        }
      } catch {
        // selector not found, that's fine
      }
    }

    debug(COMPONENT, "Pre-interaction complete");
  }

  protected override async uploadImages(page: Page, filePaths: string[]): Promise<void> {
    debug(COMPONENT, `Uploading ${filePaths.length} reference image(s) via Gemini upload menu...`);

    // Gemini has no visible <input type="file">. The "+" button opens an upload menu,
    // and clicking a menu item triggers a native file dialog. We intercept it with
    // Playwright's filechooser event.
    try {
      // Click the "+" upload button (has aria-controls="upload-file-menu")
      const uploadBtn = page.locator('[aria-controls="upload-file-menu"], button:has-text("+")').first();
      if (!await uploadBtn.isVisible({ timeout: 2000 })) {
        debug(COMPONENT, "Upload button not found");
        return;
      }

      await uploadBtn.click();
      await page.waitForTimeout(500);

      // Look for "Upload file" / "Datei hochladen" menu item, and intercept the file dialog
      const uploadMenuItems = [
        'button:has-text("Datei hochladen")',
        'button:has-text("Upload file")',
        'button:has-text("Upload")',
        '[role="menuitem"]:has-text("Datei")',
        '[role="menuitem"]:has-text("Upload")',
        '[role="menuitem"]:has-text("file")',
      ];

      let clicked = false;
      for (const selector of uploadMenuItems) {
        try {
          const menuItem = page.locator(selector).first();
          if (await menuItem.isVisible({ timeout: 1000 })) {
            debug(COMPONENT, `Found upload menu item: ${selector}`);

            // Intercept the file chooser dialog and set files
            const [fileChooser] = await Promise.all([
              page.waitForEvent("filechooser", { timeout: 5000 }),
              menuItem.click(),
            ]);

            await fileChooser.setFiles(filePaths);
            debug(COMPONENT, "Files set via filechooser");
            clicked = true;
            break;
          }
        } catch (e: any) {
          debug(COMPONENT, `Menu item ${selector} failed: ${e.message}`);
        }
      }

      if (!clicked) {
        debug(COMPONENT, "Could not find upload menu item, trying hidden file input fallback");
        // Some versions might have a hidden input after menu click
        const hiddenInput = page.locator('input[type="file"]').first();
        if (await hiddenInput.count() > 0) {
          await hiddenInput.setInputFiles(filePaths);
          debug(COMPONENT, "Files set via hidden input");
          clicked = true;
        }
      }

      if (clicked) {
        // Wait for thumbnails to appear
        await page.waitForTimeout(3000);
        debug(COMPONENT, "Image upload complete");
      } else {
        debug(COMPONENT, "WARNING: Could not upload images to Gemini");
      }
    } catch (e: any) {
      debug(COMPONENT, `Image upload failed: ${e.message}`);
    }
  }

  protected override async afterGeneration(page: Page): Promise<void> {
    debug(COMPONENT, "Cleaning up: deleting chat to avoid account clutter...");

    try {
      // Extract the current chat URL to identify which chat we're in
      const currentUrl = page.url();
      debug(COMPONENT, `Current URL: ${currentUrl}`);

      // The sidebar has per-conversation action buttons with data-test-id="actions-menu-button"
      // Their aria-label format:
      //   Chats: "Weitere Optionen für „{prompt text}""
      //   Gems:  "Weitere Optionen für Gem „{gem name}""
      // We need to find the one for the CURRENT chat, not for Gems.

      // Extract chat ID from the current URL (e.g. /app/ab42138ed93078c6)
      const chatId = currentUrl.split("/app/")[1] ?? "";
      debug(COMPONENT, `Current chat ID: ${chatId}`);

      // Find all action buttons, filter to chat-only (exclude Gem buttons)
      const actionsButtons = page.locator('[data-test-id="actions-menu-button"]');
      const btnCount = await actionsButtons.count();
      debug(COMPONENT, `Found ${btnCount} action buttons in sidebar`);

      if (btnCount === 0) {
        debug(COMPONENT, "No action buttons found");
        return;
      }

      // Find the action button for the current chat by:
      // 1. Exclude Gem buttons (aria-label contains "für Gem „")
      // 2. Pick the first chat button (most recent = current conversation)
      let targetBtn = null;
      for (let i = 0; i < btnCount; i++) {
        const btn = actionsButtons.nth(i);
        const label = await btn.getAttribute("aria-label") ?? "";
        const isGem = label.includes("für Gem „") || label.includes("for Gem \"");
        debug(COMPONENT, `  Button [${i}]: ${label.slice(0, 80)} ${isGem ? "(Gem, skip)" : "(Chat)"}`);
        if (!isGem) {
          targetBtn = btn;
          break;
        }
      }

      if (!targetBtn) {
        debug(COMPONENT, "No chat action button found (only Gems in sidebar)");
        return;
      }

      const ariaLabel = await targetBtn.getAttribute("aria-label") ?? "";
      debug(COMPONENT, `Clicking actions menu for: ${ariaLabel.slice(0, 100)}`);

      // The "⋮" actions button is only visible on hover in the sidebar.
      // First hover over the parent conversation item to reveal it.
      try {
        // Find the parent conversation element and hover it
        const conversationItem = page.locator('[data-test-id="conversation"]').filter({ has: targetBtn }).first();
        if (await conversationItem.count() > 0) {
          await conversationItem.hover({ timeout: 2000 });
          await page.waitForTimeout(300);
        } else {
          // Fallback: hover the button's parent element
          await targetBtn.hover({ timeout: 2000 });
          await page.waitForTimeout(300);
        }
      } catch {
        debug(COMPONENT, "Could not hover conversation item, trying direct click");
      }

      // Use force:true in case the button is still not fully "visible" to Playwright
      await targetBtn.click({ force: true, timeout: 3000 });
      await page.waitForTimeout(500);

      // Debug: capture the opened menu
      const menuScreenshot = await page.screenshot();
      debugSaveScreenshot("chat_delete_menu", menuScreenshot);

      // Look for delete/Löschen option in the dropdown menu
      const deleteSelectors = [
        '[role="menuitem"]:has-text("Delete")',
        '[role="menuitem"]:has-text("Löschen")',
        '[role="menuitem"]:has-text("löschen")',
        'button:has-text("Delete")',
        'button:has-text("Löschen")',
      ];

      let deleted = false;
      for (const selector of deleteSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 1000 })) {
            debug(COMPONENT, `Clicking delete option: ${selector}`);
            await btn.click();
            await page.waitForTimeout(500);

            // Debug: capture confirm dialog
            const confirmScreenshot = await page.screenshot();
            debugSaveScreenshot("chat_delete_confirm", confirmScreenshot);

            // Confirm deletion dialog
            const confirmSelectors = [
              'button:has-text("Delete")',
              'button:has-text("Löschen")',
              'button:has-text("Confirm")',
              'button:has-text("Bestätigen")',
              'button:has-text("Yes")',
              'button:has-text("Ja")',
            ];
            for (const confirmSel of confirmSelectors) {
              try {
                const confirmBtn = page.locator(confirmSel).first();
                if (await confirmBtn.isVisible({ timeout: 1000 })) {
                  debug(COMPONENT, `Confirming delete: ${confirmSel}`);
                  await confirmBtn.click();
                  deleted = true;
                  break;
                }
              } catch {
                continue;
              }
            }
            break;
          }
        } catch {
          continue;
        }
      }

      if (deleted) {
        debug(COMPONENT, "Chat deleted successfully");
        await page.waitForTimeout(1000);
      } else {
        debug(COMPONENT, "Could not find delete option in menu — closing menu");
        await page.keyboard.press("Escape");
      }
    } catch (e: any) {
      debug(COMPONENT, `Chat cleanup failed (non-fatal): ${e.message}`);
    }
  }
}
