import type { Page, BrowserContext } from "playwright";
import type { BackendProvider, BrowserBackendConfig } from "./backend-provider.js";
import type { GenerationRequest } from "../domain/generation-request.js";
import type { GenerationResult } from "../domain/generation-result.js";
import {
  findPromptInput,
  findSubmitButton,
  findFileInput,
  snapshotImages,
  waitForNewImage,
} from "./element-discovery.js";
import { createSessionContext } from "../session/session-manager.js";
import { sessionExists } from "../session/session-manager.js";
import { removeWatermark } from "../core/watermark-remover.js";
import {
  debug,
  debugSaveScreenshot,
  debugSaveHtml,
} from "../debug/logger.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

export function detectImageFormat(buffer: Buffer): { ext: string; mime: string } {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return { ext: "png", mime: "image/png" }; // default
}

const COMPONENT = "browser-backend";

export abstract class BrowserBackendBase implements BackendProvider {
  abstract readonly name: string;
  readonly supportsImg2Img = true;
  readonly requiresSession = true;
  /** Whether this backend's images have a watermark that needs removal */
  protected readonly hasWatermark: boolean = false;

  protected abstract config: BrowserBackendConfig;

  async isAvailable(): Promise<boolean> {
    return sessionExists(this.config.name);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = Date.now();
    let context: BrowserContext | null = null;

    try {
      debug(COMPONENT, `Starting generation with ${this.name} backend`);
      debug(COMPONENT, `Prompt: ${request.prompt.value}`);
      if (request.hasImages) {
        debug(COMPONENT, `Image inputs: ${request.imageInputs.map((i) => i.filePath).join(", ")}`);
      }

      context = await createSessionContext(this.config.name);
      const page = context.pages()[0] || (await context.newPage());

      // Navigate to the service
      debug(COMPONENT, `Navigating to ${this.config.url}`);
      await page.goto(this.config.url, { waitUntil: "domcontentloaded" });

      // Wait for page to be interactive (don't use networkidle — SPA pages never go idle)
      debug(COMPONENT, "Waiting for page to settle...");
      await page.waitForTimeout(3000);

      // Debug: capture initial page state
      const initialScreenshot = await page.screenshot();
      debugSaveScreenshot("page_initial", initialScreenshot);
      const initialHtml = await page.content();
      debugSaveHtml("page_initial", initialHtml);
      debug(COMPONENT, `Page title: ${await page.title()}`);
      debug(COMPONENT, `Page URL: ${page.url()}`);

      // Allow subclasses to do pre-processing (dismiss modals, select model, etc.)
      await this.beforeInteraction(page);

      // Upload reference images if provided (before typing prompt)
      if (request.hasImages) {
        await this.uploadImages(page, request.imageInputs.map((i) => i.filePath));
      }

      // Find and fill prompt input
      const promptInput = await findPromptInput(page, this.config.hints?.promptSelector);

      debug(COMPONENT, "Clearing and typing prompt...");
      await promptInput.click();
      await promptInput.fill("");
      await promptInput.fill(request.prompt.value);
      debug(COMPONENT, "Prompt entered");

      // Debug: capture state after prompt entry
      const afterPromptScreenshot = await page.screenshot();
      debugSaveScreenshot("after_prompt", afterPromptScreenshot);

      // Find and click submit
      const submitButton = await findSubmitButton(page, this.config.hints?.submitSelector);

      debug(COMPONENT, "Clicking submit button...");
      await submitButton.click();
      debug(COMPONENT, "Submit clicked, waiting for image generation...");

      // Wait for the page to settle after submit — uploaded images get re-hosted
      // with new server URLs, so we snapshot AFTER submit to avoid false positives.
      await page.waitForTimeout(5000);

      // Debug: capture state after submit
      const afterSubmitScreenshot = await page.screenshot();
      debugSaveScreenshot("after_submit", afterSubmitScreenshot);

      // Snapshot images after submit settle so re-hosted uploads are captured as "existing"
      const imagesBefore = await snapshotImages(page);

      // Wait for new image to appear (may be a preview/placeholder)
      const newImageSrc = await waitForNewImage(page, imagesBefore);
      debug(COMPONENT, `Found image: ${newImageSrc.slice(0, 150)}`);

      // Wait for the response to finish (image may still be generating)
      await this.waitForGenerationComplete(page);

      // Debug: capture state after generation is complete
      const afterGenScreenshot = await page.screenshot();
      debugSaveScreenshot("after_generation_complete", afterGenScreenshot);

      // Re-fetch image list — the final image URL may differ from the preview
      const finalImages = await page.evaluate((minSize: number) => {
        const result: { src: string; w: number; h: number }[] = [];
        document.querySelectorAll("img").forEach((img) => {
          if (img.src && img.naturalWidth >= minSize && img.naturalHeight >= minSize) {
            result.push({ src: img.src, w: img.naturalWidth, h: img.naturalHeight });
          }
        });
        return result;
      }, 128);

      // Pick the latest new image that wasn't in our snapshot
      let finalSrc = newImageSrc;
      for (const img of finalImages) {
        if (!imagesBefore.srcs.has(img.src) && !img.src.includes("gstatic.com") && !img.src.includes("googleusercontent.com/a/")) {
          debug(COMPONENT, `New image candidate: ${img.w}x${img.h} — ${img.src.slice(0, 150)}`);
          finalSrc = img.src;
        }
      }

      if (finalSrc !== newImageSrc) {
        debug(COMPONENT, `Final image URL changed: ${finalSrc.slice(0, 150)}`);
      }

      // Download the final full-resolution image
      const imageBuffer = await this.downloadFullResImage(page, finalSrc);

      // Remove watermark (only for backends that have one, e.g. Gemini)
      const cleanedBuffer = this.hasWatermark
        ? await removeWatermark(imageBuffer)
        : imageBuffer;

      // Detect actual image format and save with correct extension
      const format = detectImageFormat(cleanedBuffer);
      debug(COMPONENT, `Detected image format: ${format.ext} (${format.mime})`);

      const outputDir = resolve("output");
      mkdirSync(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = join(outputDir, `gen_${timestamp}.${format.ext}`);
      writeFileSync(outputPath, cleanedBuffer);
      debug(COMPONENT, `Image saved to: ${outputPath}`);

      // Let subclass clean up (e.g. delete chat)
      await this.afterGeneration(page);

      const durationMs = Date.now() - startTime;
      return {
        success: true,
        filePath: outputPath,
        backend: this.name,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      debug(COMPONENT, `Generation failed: ${error.message}`);

      // Try to clean up the chat even on failure
      if (context) {
        try {
          const page = context.pages()[0];
          if (page) await this.afterGeneration(page);
        } catch (e: any) {
          debug(COMPONENT, `Post-failure cleanup failed: ${e.message}`);
        }
      }

      return {
        success: false,
        filePath: "",
        backend: this.name,
        durationMs,
        error: {
          code: error.code ?? "GENERATION_FAILED",
          message: error.message,
        },
      };
    } finally {
      if (context) {
        try {
          await context.close();
        } catch {
          // ignore
        }
      }
    }
  }

  protected async uploadImages(page: Page, filePaths: string[]): Promise<void> {
    debug(COMPONENT, `Uploading ${filePaths.length} reference image(s)...`);
    const fileInput = await findFileInput(page);
    if (fileInput) {
      await fileInput.setInputFiles(filePaths);
      debug(COMPONENT, "Images uploaded via file input");
      await page.waitForTimeout(2000);
    } else {
      debug(COMPONENT, "WARNING: No file input found, could not upload reference images");
    }
  }

  protected async beforeInteraction(_page: Page): Promise<void> {
    // Subclasses can override to dismiss modals, select models, etc.
  }

  protected async afterGeneration(_page: Page): Promise<void> {
    // Subclasses can override to clean up (e.g. delete chat to avoid clutter)
  }

  protected async waitForGenerationComplete(_page: Page): Promise<void> {
    // Subclasses can override to wait for the model to finish generating
    // (e.g. wait for "Creating image..." indicator to disappear)
  }

  protected async downloadFullResImage(page: Page, src: string): Promise<Buffer> {
    debug(COMPONENT, "Attempting to get full-resolution image...");

    const { default: sharp } = await import("sharp");

    // Try to get full-res PNG by requesting with =s0 (original size, no JPEG conversion).
    // Google image URLs serve different formats/sizes based on URL suffix.
    // Try twice — the first request sometimes fails or returns a smaller version.
    const fullResSrc = this.getFullResUrl(src);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        debug(COMPONENT, `PNG attempt ${attempt}/2: ${fullResSrc.slice(0, 120)}...`);
        const buf = await this.fetchImage(page, fullResSrc);
        const meta = await sharp(buf).metadata();
        debug(COMPONENT, `Got: ${meta.width}x${meta.height} (${buf.length} bytes, ${meta.format})`);

        if (meta.format === "png") {
          debug(COMPONENT, "Got PNG — using this version");
          return buf;
        }
        debug(COMPONENT, `Got ${meta.format} instead of PNG, retrying...`);
      } catch (e: any) {
        debug(COMPONENT, `Attempt ${attempt} failed: ${e.message}`);
      }
    }

    // Fallback: fetch the original URL directly (likely JPEG preview)
    debug(COMPONENT, "PNG not available, falling back to preview image");
    const buf = await this.fetchImage(page, src);
    try {
      const meta = await sharp(buf).metadata();
      debug(COMPONENT, `Preview image: ${meta.width}x${meta.height} (${buf.length} bytes, ${meta.format})`);
    } catch { /* ignore */ }
    return buf;
  }

  /**
   * Transform a Google image URL to request original/full resolution.
   * Google image URLs end with size parameters like =s1600-rj (max 1600px, JPEG).
   * =s0 requests the original size without format conversion.
   * If no size param exists, append =s0 to request full resolution.
   */
  protected getFullResUrl(src: string): string {
    if (!src.includes("googleusercontent.com")) return src;

    // Replace existing size suffix: =s{number}... or =w{number}-h{number}...
    const googleUrlPattern = /=(?:s\d+|w\d+(?:-h\d+)?)(?:-[a-z]+)*$/;
    if (googleUrlPattern.test(src)) {
      return src.replace(googleUrlPattern, "=s0");
    }

    // No size parameter found — append =s0 for original resolution
    return src + "=s0";
  }

  protected async fetchImage(page: Page, src: string): Promise<Buffer> {
    debug(COMPONENT, `Fetching image: ${src.slice(0, 120)}`);

    if (src.startsWith("blob:") || src.startsWith("data:")) {
      debug(COMPONENT, "Extracting blob/data URL via page context");
      const base64 = await page.evaluate(async (imgSrc: string) => {
        const img = document.querySelector(`img[src="${imgSrc}"]`) as HTMLImageElement;
        if (img) {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return canvas.toDataURL("image/png").split(",")[1];
        }
        const resp = await fetch(imgSrc);
        const blob = await resp.blob();
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.readAsDataURL(blob);
        });
      }, src);

      return Buffer.from(base64, "base64");
    }

    debug(COMPONENT, "Fetching image via HTTP");
    const response = await page.request.get(src);
    return Buffer.from(await response.body());
  }
}
