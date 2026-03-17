#!/usr/bin/env node
import { Command } from "commander";
import { setVerbose, setDebugDir } from "./debug/logger.js";
import { openLoginSession } from "./session/session-manager.js";
import { runGeneration } from "./core/generation-job.js";
import { join } from "path";

const program = new Command();

program
  .name("imagegen")
  .description("AI agent image generation tool via browser automation")
  .version("1.0.0");

program
  .command("login")
  .description("Open a browser to log in to a generation service (session is saved for future use)")
  .requiredOption("--backend <name>", "Backend to log in to (gemini, chatgpt)", "gemini")
  .option("-v, --verbose", "Enable verbose debug output")
  .action(async (opts) => {
    if (opts.verbose) {
      setVerbose(true);
      setDebugDir(join(process.cwd(), "debug"));
    }

    const loginUrls: Record<string, string> = {
      gemini: "https://gemini.google.com/app",
      chatgpt: "https://chatgpt.com",
    };

    const loginUrl = loginUrls[opts.backend];
    if (!loginUrl) {
      console.error(`Unknown backend: ${opts.backend}. Available: ${Object.keys(loginUrls).join(", ")}`);
      process.exit(1);
    }

    await openLoginSession({ backend: opts.backend, loginUrl });
    console.log(`Session saved for ${opts.backend}. You can now run: imagegen generate --prompt "..."`);
  });

program
  .command("generate")
  .description("Generate an image from a text prompt")
  .requiredOption("--prompt <text>", "Text prompt describing the image to generate")
  .option("--image <path...>", "Reference image(s) for img2img generation (can specify multiple)")
  .option("--backend <name>", "Backend to use (gemini, chatgpt, local)", "gemini")
  .option("--api-url <url>", "API endpoint for local backend (ComfyUI / SD WebUI)")
  .option("--model <name>", "Model for local backend: sd15, flux4b, flux (9B, default), flux-dev (32B)")
  .option("--width <pixels>", "Output width in pixels", parseInt)
  .option("--height <pixels>", "Output height in pixels", parseInt)
  .option("--output-dir <path>", "Output directory", "./output")
  .option("-v, --verbose", "Enable verbose debug output")
  .action(async (opts) => {
    if (opts.verbose) {
      setVerbose(true);
      setDebugDir(join(process.cwd(), "debug"));
    }

    const result = await runGeneration({
      prompt: opts.prompt,
      imagePaths: opts.image,
      backend: opts.backend,
      apiUrl: opts.apiUrl,
      model: opts.model,
      width: opts.width,
      height: opts.height,
    });

    // Output result as JSON to stdout
    console.log(JSON.stringify(result, null, 2));

    if (!result.success) {
      process.exit(1);
    }
  });

program.parse();
