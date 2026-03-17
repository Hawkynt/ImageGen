import type { Page } from "playwright";
import { BrowserBackendBase } from "./browser-backend-base.js";
import type { BrowserBackendConfig } from "./backend-provider.js";
import { debug, debugSaveScreenshot } from "../debug/logger.js";

const COMPONENT = "chatgpt-backend";

export class ChatGptBackend extends BrowserBackendBase {
  readonly name = "chatgpt";

  protected config: BrowserBackendConfig = {
    name: "chatgpt",
    url: "https://chatgpt.com/chat",
    loginUrl: "https://chatgpt.com/chat",
    hints: {},
  };

  protected override async beforeInteraction(page: Page): Promise<void> {
    debug(COMPONENT, "Running ChatGPT-specific pre-interaction steps...");

    await page.waitForTimeout(3000);

    // Handle Cloudflare Turnstile challenge if present
    await this.handleCloudflareChallenge(page);

    const screenshot = await page.screenshot();
    debugSaveScreenshot("chatgpt_before_interaction", screenshot);

    // Try to dismiss any welcome/cookie dialogs
    const dismissSelectors = [
      'button:has-text("Got it")',
      'button:has-text("Accept")',
      'button:has-text("Dismiss")',
      'button:has-text("Close")',
      'button:has-text("OK")',
      'button:has-text("No thanks")',
      'button:has-text("Skip")',
      'button:has-text("Stay logged out")',
      'button:has-text("Next")',
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
        // selector not found
      }
    }

    // Try to enable temporary chat mode to avoid cluttering history
    await this.enableTemporaryChat(page);

    debug(COMPONENT, "Pre-interaction complete");
  }

  private async handleCloudflareChallenge(page: Page): Promise<void> {
    const title = await page.title();
    debug(COMPONENT, `Page title: "${title}"`);

    // Detect Cloudflare challenge page
    const isChallenged = title.includes("Moment") || title.includes("moment") ||
      title.includes("Just a moment") || title.includes("Nur einen Moment");

    if (!isChallenged) {
      debug(COMPONENT, "No Cloudflare challenge detected");
      return;
    }

    debug(COMPONENT, "Cloudflare Turnstile challenge detected, attempting to solve...");

    // The Turnstile widget is inside an iframe. Try to find and click the checkbox.
    for (let attempt = 1; attempt <= 3; attempt++) {
      debug(COMPONENT, `Challenge attempt ${attempt}/3...`);

      try {
        // Look for Turnstile iframe
        const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
        const checkbox = turnstileFrame.locator('input[type="checkbox"], .cb-i, #cf-turnstile-response, body');

        if (await checkbox.first().isVisible({ timeout: 3000 })) {
          debug(COMPONENT, "Found Turnstile checkbox, clicking...");
          await checkbox.first().click({ force: true });
        } else {
          // Try clicking the iframe element directly
          const iframeEl = page.locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').first();
          if (await iframeEl.isVisible({ timeout: 1000 })) {
            debug(COMPONENT, "Clicking Turnstile iframe directly...");
            const box = await iframeEl.boundingBox();
            if (box) {
              // Click in the center-left area where the checkbox typically is
              await page.mouse.click(box.x + 30, box.y + box.height / 2);
            }
          }
        }
      } catch (e: any) {
        debug(COMPONENT, `Turnstile click failed: ${e.message}`);
      }

      // Wait and check if the challenge was solved
      await page.waitForTimeout(5000);

      const newTitle = await page.title();
      debug(COMPONENT, `Title after attempt: "${newTitle}"`);

      if (!newTitle.includes("Moment") && !newTitle.includes("moment")) {
        debug(COMPONENT, "Cloudflare challenge passed!");
        await page.waitForTimeout(2000); // Let the page fully load
        return;
      }
    }

    debug(COMPONENT, "WARNING: Could not solve Cloudflare challenge — ChatGPT may require headed mode");
  }

  private async enableTemporaryChat(page: Page): Promise<void> {
    debug(COMPONENT, "Attempting to enable temporary chat...");

    try {
      // ChatGPT has a temporary chat toggle in the UI.
      // Look for it in the top-right area or in a menu.
      // The toggle might be accessible via a button or dropdown.

      // Try clicking the model selector / top bar area that may reveal temp chat option
      const tempChatSelectors = [
        'button[aria-label*="emporary"]',
        'button[aria-label*="Temporary"]',
        '[data-testid="temporary-chat"]',
        'button:has-text("Temporary")',
        'button:has-text("temporary")',
      ];

      for (const selector of tempChatSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 1000 })) {
            debug(COMPONENT, `Found temporary chat toggle: ${selector}`);
            await btn.click();
            await page.waitForTimeout(500);
            debug(COMPONENT, "Temporary chat enabled");
            return;
          }
        } catch {
          continue;
        }
      }

      debug(COMPONENT, "Temporary chat toggle not found — will delete chat after generation");
    } catch (e: any) {
      debug(COMPONENT, `Failed to enable temp chat: ${e.message}`);
    }
  }

  protected override async waitForGenerationComplete(page: Page): Promise<void> {
    debug(COMPONENT, "Waiting for ChatGPT image generation to complete...");

    // ChatGPT shows "Bild wird erstellt" / "Creating image" while DALL-E is working.
    // Wait for this indicator to disappear.
    const generatingSelectors = [
      'text="Bild wird erstellt"',
      'text="Creating image"',
      'text="Generating"',
    ];

    // First check if generation is still in progress
    let isGenerating = false;
    for (const selector of generatingSelectors) {
      try {
        if (await page.locator(selector).first().isVisible({ timeout: 2000 })) {
          isGenerating = true;
          debug(COMPONENT, `Generation in progress (found: ${selector})`);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!isGenerating) {
      debug(COMPONENT, "No generation indicator found — may already be complete");
      // Still wait a moment for the image to finalize
      await page.waitForTimeout(3000);
      return;
    }

    // Wait for the generating text to disappear (up to 120s)
    debug(COMPONENT, "Waiting for generation to finish...");
    for (let elapsed = 0; elapsed < 120000; elapsed += 3000) {
      await page.waitForTimeout(3000);

      let stillGenerating = false;
      for (const selector of generatingSelectors) {
        try {
          if (await page.locator(selector).first().isVisible({ timeout: 500 })) {
            stillGenerating = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!stillGenerating) {
        debug(COMPONENT, `Generation completed after ~${elapsed + 3000}ms`);
        // Extra settle time for the final image to load
        await page.waitForTimeout(3000);
        return;
      }

      debug(COMPONENT, `Still generating... (${elapsed + 3000}ms)`);
    }

    debug(COMPONENT, "Generation wait timed out, proceeding anyway");
  }

  /**
   * Download the full-res image from ChatGPT.
   * Strategy: try direct URL fetch first (fast, reliable), then download button
   * as fallback/comparison.  Keep whichever is larger.
   */
  protected override async downloadFullResImage(page: Page, src: string): Promise<Buffer> {
    debug(COMPONENT, "Downloading ChatGPT image...");

    // 1. Direct fetch — ChatGPT backend-api/estuary URLs serve the original file
    let directBuf: Buffer | null = null;
    try {
      directBuf = await this.fetchImage(page, src);
      debug(COMPONENT, `Direct fetch: ${directBuf.length} bytes`);
    } catch (e: any) {
      debug(COMPONENT, `Direct fetch failed: ${e.message}`);
    }

    // 2. Download button approach — hover over image to reveal download button
    let downloadBuf: Buffer | null = null;
    try {
      // Find the image by matching src — use filter to handle special chars in URL
      const allImgs = page.locator("img");
      const imgCount = await allImgs.count();
      let imgEl = null;
      for (let i = 0; i < imgCount; i++) {
        const el = allImgs.nth(i);
        const elSrc = await el.getAttribute("src");
        if (elSrc === src) {
          imgEl = el;
          break;
        }
      }

      if (imgEl && await imgEl.isVisible({ timeout: 3000 })) {
        await imgEl.hover();
        await page.waitForTimeout(1000);

        const downloadBtnSelectors = [
          'a[download]',
          'button[aria-label*="ownload"]',
          'button[aria-label*="erunterladen"]',
          'a[aria-label*="ownload"]',
          'a[aria-label*="erunterladen"]',
        ];

        for (const selector of downloadBtnSelectors) {
          try {
            const dlBtn = page.locator(selector).first();
            if (await dlBtn.isVisible({ timeout: 1000 })) {
              debug(COMPONENT, `Found download button: ${selector}`);

              // Check if it's a direct link we can fetch
              const href = await dlBtn.getAttribute("href");
              if (href && !href.startsWith("blob:")) {
                debug(COMPONENT, `Fetching download link: ${href.slice(0, 120)}`);
                downloadBuf = await this.fetchImage(page, href);
                debug(COMPONENT, `Download link: ${downloadBuf.length} bytes`);
                break;
              }

              // Try intercepting the download event
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: 10000 }),
                dlBtn.click(),
              ]);

              const path = await download.path();
              if (path) {
                const { readFileSync } = await import("fs");
                downloadBuf = Buffer.from(readFileSync(path));
                debug(COMPONENT, `Download event: ${downloadBuf.length} bytes`);
                break;
              }
            }
          } catch (e: any) {
            debug(COMPONENT, `Download button ${selector} failed: ${e.message}`);
          }
        }
      } else {
        debug(COMPONENT, "Could not find image element for hover");
      }
    } catch (e: any) {
      debug(COMPONENT, `Download button approach failed: ${e.message}`);
    }

    // Pick the larger result (more data = higher quality / less compression)
    if (directBuf && downloadBuf) {
      debug(COMPONENT, `Comparing: direct=${directBuf.length} vs download=${downloadBuf.length}`);
      return downloadBuf.length >= directBuf.length ? downloadBuf : directBuf;
    }

    if (downloadBuf) return downloadBuf;
    if (directBuf) return directBuf;

    throw new Error("Could not download image via any method");
  }

  protected override async afterGeneration(page: Page): Promise<void> {
    debug(COMPONENT, "Cleaning up: deleting chat to avoid account clutter...");

    try {
      // Check if this is a temporary chat (URL won't have a conversation ID, or
      // the page indicates temporary mode). If so, no cleanup needed.
      const currentUrl = page.url();
      debug(COMPONENT, `Current URL: ${currentUrl}`);

      // If we're still on /chat (no conversation ID), it might be temporary
      if (currentUrl === "https://chatgpt.com/chat" || currentUrl === "https://chatgpt.com/") {
        debug(COMPONENT, "Appears to be a temporary chat or no conversation created, skipping cleanup");
        return;
      }

      // Extract conversation ID from URL (e.g. /c/abc123)
      const match = currentUrl.match(/\/c\/([a-z0-9-]+)/i);
      if (!match) {
        debug(COMPONENT, "Could not extract conversation ID from URL, skipping cleanup");
        return;
      }

      const convId = match[1];
      debug(COMPONENT, `Conversation ID: ${convId}`);

      // Open the sidebar if needed
      await this.ensureSidebarOpen(page);

      // Find the conversation in the sidebar and delete it
      // ChatGPT sidebar items have a hover-revealed "..." menu button
      // We'll look for the conversation by finding elements that link to our conversation
      const convLink = page.locator(`a[href*="/c/${convId}"]`).first();
      if (await convLink.isVisible({ timeout: 2000 })) {
        debug(COMPONENT, "Found conversation in sidebar, hovering to reveal menu...");
        await convLink.hover();
        await page.waitForTimeout(500);

        // Look for the "..." menu button that appears on hover
        const menuBtnSelectors = [
          'button[data-testid*="options"]',
          'button[aria-label*="Options"]',
          'button[aria-label*="options"]',
          'button[aria-label*="More"]',
          'button[aria-haspopup="menu"]',
        ];

        let menuBtn = null;
        for (const selector of menuBtnSelectors) {
          try {
            // Look for the menu button within or near the conversation link
            const btn = convLink.locator("..").locator(selector).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              menuBtn = btn;
              debug(COMPONENT, `Found menu button via: ${selector}`);
              break;
            }
          } catch {
            continue;
          }
        }

        // Fallback: look for any newly visible button near the hovered item
        if (!menuBtn) {
          try {
            const parentLi = convLink.locator("xpath=ancestor::li[1]");
            const btns = parentLi.locator("button");
            const btnCount = await btns.count();
            debug(COMPONENT, `Found ${btnCount} buttons in conversation item`);
            if (btnCount > 0) {
              menuBtn = btns.last();
            }
          } catch {
            debug(COMPONENT, "Could not find menu button via ancestor");
          }
        }

        if (menuBtn) {
          await menuBtn.click({ force: true });
          await page.waitForTimeout(500);

          const menuScreenshot = await page.screenshot();
          debugSaveScreenshot("chatgpt_delete_menu", menuScreenshot);

          // Click "Delete" in the dropdown
          const deleteSelectors = [
            '[role="menuitem"]:has-text("Delete")',
            '[role="menuitem"]:has-text("Löschen")',
            'div[role="menuitem"]:has-text("Delete")',
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

                // Confirm deletion
                const confirmSelectors = [
                  'button:has-text("Delete")',
                  'button:has-text("Löschen")',
                  'button:has-text("Confirm")',
                  'button:has-text("Bestätigen")',
                  '[data-testid*="confirm"]',
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
            debug(COMPONENT, "Could not find delete option — closing menu");
            await page.keyboard.press("Escape");
          }
        } else {
          debug(COMPONENT, "Could not find menu button for conversation");
        }
      } else {
        debug(COMPONENT, "Conversation not found in sidebar");
      }
    } catch (e: any) {
      debug(COMPONENT, `Chat cleanup failed (non-fatal): ${e.message}`);
    }
  }

  private async ensureSidebarOpen(page: Page): Promise<void> {
    try {
      // Check if sidebar is already visible by looking for the conversation list
      const sidebar = page.locator('nav').first();
      if (await sidebar.isVisible({ timeout: 1000 })) {
        debug(COMPONENT, "Sidebar already visible");
        return;
      }

      // Try to open the sidebar
      const toggleSelectors = [
        'button[aria-label*="sidebar"]',
        'button[aria-label*="Sidebar"]',
        'button[aria-label*="menu"]',
        'button[aria-label*="Menu"]',
        'button[data-testid="open-sidebar"]',
      ];

      for (const selector of toggleSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 500 })) {
            debug(COMPONENT, `Opening sidebar via: ${selector}`);
            await btn.click();
            await page.waitForTimeout(500);
            return;
          }
        } catch {
          continue;
        }
      }
    } catch {
      debug(COMPONENT, "Could not verify/open sidebar");
    }
  }

  /**
   * ChatGPT images are served from oaidalleapiprodscus.blob.core.windows.net
   * or similar Azure blob storage URLs. No special URL transformation needed.
   */
  protected override getFullResUrl(src: string): string {
    // No URL transformation for ChatGPT — images are already full resolution
    return src;
  }

}
