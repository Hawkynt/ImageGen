import type { Page, Locator } from "playwright";
import {
  debug,
  debugSaveElementList,
  debugSaveScreenshot,
  debugSaveHtml,
  type ElementDebugInfo,
} from "../debug/logger.js";

const COMPONENT = "element-discovery";

// --- Prompt input discovery ---

const PROMPT_KEYWORDS = [
  "prompt",
  "message",
  "describe",
  "ask",
  "type",
  "enter",
  "write",
  "chat",
  "input",
  "create",
  "imagine",
];

export async function findPromptInput(page: Page, hint?: string): Promise<Locator> {
  debug(COMPONENT, "Looking for prompt input element...");

  if (hint) {
    debug(COMPONENT, `Trying hint selector: ${hint}`);
    const hinted = page.locator(hint).first();
    if (await safeIsVisible(hinted)) {
      debug(COMPONENT, "Found prompt input via hint selector");
      return hinted;
    }
    debug(COMPONENT, "Hint selector not visible, falling back to heuristics");
  }

  // Gather all candidate text inputs
  const candidates = page.locator(
    'textarea, input[type="text"], [contenteditable="true"], [contenteditable=""], [role="textbox"]'
  );
  const count = await candidates.count();
  debug(COMPONENT, `Found ${count} text input candidates`);

  const debugInfos: ElementDebugInfo[] = [];
  const scored: { locator: Locator; score: number; index: number }[] = [];

  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    const info = await getElementDebugInfo(el);
    debugInfos.push(info);

    if (!info.visible) continue;

    let score = 0;
    const allText = `${info.attributes} ${info.text}`.toLowerCase();

    // Score by keyword matches
    for (const kw of PROMPT_KEYWORDS) {
      if (allText.includes(kw)) score += 10;
    }

    // Prefer textarea over input
    if (info.tag === "textarea") score += 5;
    if (info.tag === "div" || info.tag === "p") score += 2; // contenteditable

    // Prefer larger elements (more likely to be the main input)
    if (info.rect) {
      score += Math.min(info.rect.width / 100, 5);
      score += Math.min(info.rect.height / 50, 3);
    }

    debug(COMPONENT, `  Candidate [${i}]: <${info.tag}> score=${score}`, {
      text: info.text.slice(0, 80),
      rect: info.rect,
    });

    scored.push({ locator: el, score, index: i });
  }

  debugSaveElementList("prompt_candidates", debugInfos);

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    await captureDebugSnapshot(page, "no_prompt_input");
    throw new ElementDiscoveryError(
      "UI_ELEMENT_NOT_FOUND",
      "Could not find a prompt text input on the page"
    );
  }

  const best = scored[0];
  debug(
    COMPONENT,
    `Selected prompt input: candidate [${best.index}] with score ${best.score}`
  );
  return best.locator;
}

// --- Submit button discovery ---

const SUBMIT_KEYWORDS = [
  "send",
  "generate",
  "submit",
  "go",
  "run",
  "create",
  "enter",
  "arrow",
];

export async function findSubmitButton(page: Page, hint?: string): Promise<Locator> {
  debug(COMPONENT, "Looking for submit button...");

  if (hint) {
    debug(COMPONENT, `Trying hint selector: ${hint}`);
    const hinted = page.locator(hint).first();
    if (await safeIsVisible(hinted)) {
      debug(COMPONENT, "Found submit button via hint selector");
      return hinted;
    }
    debug(COMPONENT, "Hint selector not visible, falling back to heuristics");
  }

  const candidates = page.locator(
    'button, [role="button"], input[type="submit"]'
  );
  const count = await candidates.count();
  debug(COMPONENT, `Found ${count} button candidates`);

  const debugInfos: ElementDebugInfo[] = [];
  const scored: { locator: Locator; score: number; index: number }[] = [];

  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    const info = await getElementDebugInfo(el);
    debugInfos.push(info);

    if (!info.visible) continue;

    let score = 0;
    const allText = `${info.attributes} ${info.text}`.toLowerCase();

    for (const kw of SUBMIT_KEYWORDS) {
      if (allText.includes(kw)) score += 10;
    }

    // type="submit" is a strong signal
    if (info.attributes.includes('type="submit"')) score += 15;

    // aria-label with send/submit
    const ariaMatch = info.attributes.match(/aria-label="([^"]+)"/);
    if (ariaMatch) {
      const ariaLower = ariaMatch[1].toLowerCase();
      for (const kw of SUBMIT_KEYWORDS) {
        if (ariaLower.includes(kw)) score += 15;
      }
    }

    // SVG inside (likely an icon button like send arrow)
    const hasSvg = await el.locator("svg").count();
    if (hasSvg > 0 && info.text.length < 5) score += 3;

    debug(COMPONENT, `  Candidate [${i}]: <${info.tag}> score=${score}`, {
      text: info.text.slice(0, 80),
      attributes: info.attributes.slice(0, 120),
    });

    scored.push({ locator: el, score, index: i });
  }

  debugSaveElementList("submit_candidates", debugInfos);

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    await captureDebugSnapshot(page, "no_submit_button");
    throw new ElementDiscoveryError(
      "UI_ELEMENT_NOT_FOUND",
      "Could not find a submit button on the page"
    );
  }

  const best = scored[0];
  debug(
    COMPONENT,
    `Selected submit button: candidate [${best.index}] with score ${best.score}`
  );
  return best.locator;
}

// --- File upload discovery ---

export async function findFileInput(page: Page): Promise<Locator | null> {
  debug(COMPONENT, "Looking for file input for image upload...");

  // Direct file inputs
  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();
  debug(COMPONENT, `Found ${count} file input(s)`);

  if (count > 0) {
    // Prefer one that accepts images
    for (let i = 0; i < count; i++) {
      const el = fileInputs.nth(i);
      const accept = (await el.getAttribute("accept")) ?? "";
      debug(COMPONENT, `  File input [${i}] accept="${accept}"`);
      if (accept.includes("image") || accept === "" || accept === "*") {
        return el;
      }
    }
    return fileInputs.first();
  }

  debug(COMPONENT, "No file input found");
  return null;
}

// --- New image detection ---

// Minimum dimensions for a "real" generated image (filters out icons, logos, UI elements)
const MIN_IMAGE_SIZE = 128;

// URL patterns that are always UI/static assets, never generated images
const IGNORED_URL_PATTERNS = [
  "gstatic.com",
  "googleusercontent.com/a/",  // profile avatars
  "googleapis.com/favicon",
  "/favicon",
  "/icon",
  "/logo",
  "watermark",
  "sprite",
  "data:image/svg",
];

function isIgnoredImageUrl(src: string): boolean {
  const lower = src.toLowerCase();
  return IGNORED_URL_PATTERNS.some((pattern) => lower.includes(pattern));
}

export interface ImageSnapshot {
  srcs: Set<string>;
  timestamp: number;
}

export interface ImageInfo {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

export async function snapshotImages(page: Page): Promise<ImageSnapshot> {
  debug(COMPONENT, "Taking image snapshot before generation...");

  const images = await page.evaluate(() => {
    const result: { src: string; w: number; h: number }[] = [];
    document.querySelectorAll("img").forEach((img) => {
      if (img.src) {
        result.push({ src: img.src, w: img.naturalWidth, h: img.naturalHeight });
      }
    });
    return result;
  });

  const srcs = new Set<string>();
  for (const img of images) {
    srcs.add(img.src);
    debug(COMPONENT, `  existing: ${img.w}x${img.h} ${img.src.slice(0, 120)}`);
  }

  debug(COMPONENT, `Snapshot contains ${srcs.size} existing image sources`);
  return { srcs, timestamp: Date.now() };
}

export async function waitForNewImage(
  page: Page,
  before: ImageSnapshot,
  timeoutMs: number = 120000
): Promise<string> {
  debug(COMPONENT, `Waiting for new image (timeout: ${timeoutMs}ms)...`);
  debug(COMPONENT, `Minimum image size: ${MIN_IMAGE_SIZE}px, ignoring UI assets`);

  const pollInterval = 2000;
  const startTime = Date.now();
  let lastLogHash = "";

  while (Date.now() - startTime < timeoutMs) {
    const currentImages = await page.evaluate((minSize: number) => {
      const result: {
        candidates: { src: string; w: number; h: number }[];
        allCount: number;
        canvasCount: number;
        downloadLinks: string[];
      } = {
        candidates: [],
        allCount: 0,
        canvasCount: 0,
        downloadLinks: [],
      };

      document.querySelectorAll("img").forEach((img) => {
        result.allCount++;
        if (img.src && img.naturalWidth >= minSize && img.naturalHeight >= minSize) {
          result.candidates.push({
            src: img.src,
            w: img.naturalWidth,
            h: img.naturalHeight,
          });
        }
      });

      result.canvasCount = document.querySelectorAll("canvas").length;

      document.querySelectorAll('a[download], a[href*="blob:"]').forEach((a) => {
        result.downloadLinks.push((a as HTMLAnchorElement).href);
      });

      return result;
    }, MIN_IMAGE_SIZE);

    // Log only when something changes
    const logHash = `${currentImages.allCount}-${currentImages.candidates.length}-${currentImages.canvasCount}-${currentImages.downloadLinks.length}`;
    if (logHash !== lastLogHash) {
      debug(
        COMPONENT,
        `Poll: ${currentImages.allCount} total imgs, ${currentImages.candidates.length} large (>=${MIN_IMAGE_SIZE}px), ${currentImages.canvasCount} canvases, ${currentImages.downloadLinks.length} download links`
      );
      for (const c of currentImages.candidates) {
        debug(COMPONENT, `  candidate: ${c.w}x${c.h} ${c.src.slice(0, 120)}`);
      }
      lastLogHash = logHash;
    }

    // Find new large images that aren't UI assets
    for (const img of currentImages.candidates) {
      if (!before.srcs.has(img.src) && !isIgnoredImageUrl(img.src)) {
        const elapsed = Date.now() - startTime;
        debug(
          COMPONENT,
          `New generated image detected after ${elapsed}ms: ${img.w}x${img.h} ${img.src.slice(0, 150)}`
        );
        await debugSaveCurrentState(page, "new_image_detected");
        return img.src;
      }
    }

    // Check for new download links
    for (const href of currentImages.downloadLinks) {
      if (!before.srcs.has(href)) {
        const elapsed = Date.now() - startTime;
        debug(COMPONENT, `New download link detected after ${elapsed}ms: ${href.slice(0, 150)}`);
        return href;
      }
    }

    // Periodic debug screenshot every 30s
    const elapsed = Date.now() - startTime;
    if (elapsed > 0 && elapsed % 30000 < pollInterval) {
      await debugSaveCurrentState(page, `waiting_${Math.round(elapsed / 1000)}s`);
    }

    await page.waitForTimeout(pollInterval);
  }

  await captureDebugSnapshot(page, "image_timeout");
  throw new ElementDiscoveryError(
    "GENERATION_TIMEOUT",
    `No new image appeared within ${timeoutMs}ms`
  );
}

// --- Debug helpers ---

async function getElementDebugInfo(locator: Locator): Promise<ElementDebugInfo> {
  try {
    const info = await locator.evaluate((el) => {
      const attrs = Array.from(el.attributes)
        .map((a) => `${a.name}="${a.value}"`)
        .join(" ");
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        attributes: attrs,
        text: (el.textContent ?? "").trim().slice(0, 200),
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(el).visibility !== "hidden" &&
          getComputedStyle(el).display !== "none",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    });
    return info;
  } catch {
    return {
      tag: "unknown",
      attributes: "",
      text: "",
      visible: false,
      rect: null,
    };
  }
}

async function safeIsVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function captureDebugSnapshot(page: Page, label: string): Promise<void> {
  try {
    const screenshot = await page.screenshot({ fullPage: true });
    debugSaveScreenshot(label, screenshot);
  } catch (e) {
    debug(COMPONENT, `Failed to capture screenshot: ${e}`);
  }
  try {
    const html = await page.content();
    debugSaveHtml(label, html);
  } catch (e) {
    debug(COMPONENT, `Failed to capture HTML: ${e}`);
  }
}

async function debugSaveCurrentState(page: Page, label: string): Promise<void> {
  try {
    const screenshot = await page.screenshot();
    debugSaveScreenshot(label, screenshot);
  } catch {
    // ignore
  }
}

export class ElementDiscoveryError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ElementDiscoveryError";
  }
}
