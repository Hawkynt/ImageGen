import type { BackendProvider } from "./backend-provider.js";
import type { GenerationRequest } from "../domain/generation-request.js";
import type { GenerationResult } from "../domain/generation-result.js";
import { debug } from "../debug/logger.js";
import { existsSync, mkdirSync, writeFileSync, readdirSync, chmodSync, unlinkSync, renameSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const COMPONENT = "local-backend";

/** Directory where sd.cpp binary and models are stored */
const LOCAL_DIR = join(homedir(), ".imagegen", "local");
const MODELS_DIR = join(LOCAL_DIR, "models");

/** Platform-specific binary name */
const SD_BINARY = process.platform === "win32" ? "sd-cli.exe" : "sd-cli";

/** Subdirectories for different backends */
const VULKAN_DIR = join(LOCAL_DIR, "vulkan");
const CPU_DIR = LOCAL_DIR; // AVX2 binary lives at the top level

/** GitHub API for latest sd.cpp release */
const SDCPP_RELEASES_API = "https://api.github.com/repos/leejet/stable-diffusion.cpp/releases?per_page=5";

// ─── Model definitions ──────────────────────────────────────────────

interface ModelDef {
  /** Display name for logging */
  label: string;
  /** Files to download */
  files: Array<{ filename: string; url: string }>;
  /** Total approximate download size */
  totalSize: string;
  /** How to build sd-cli arguments from the downloaded files */
  buildArgs(modelsDir: string): string[];
  /** Default dimensions */
  defaultWidth: number;
  defaultHeight: number;
  /** Whether this model's compute buffers fit in ≤2 GB iGPU VRAM (with offload-to-cpu) */
  vulkanSafe: boolean;
}

const FLUX_VAE = {
  filename: "flux2-vae.safetensors",
  url: "https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors",
};

const MODELS: Record<string, ModelDef> = {
  sd15: {
    label: "Stable Diffusion 1.5 (Q8_0)",
    files: [
      {
        filename: "stable-diffusion-v1-5-Q8_0.gguf",
        url: "https://huggingface.co/gpustack/stable-diffusion-v1-5-GGUF/resolve/main/stable-diffusion-v1-5-Q8_0.gguf",
      },
    ],
    totalSize: "~1.9 GB",
    buildArgs(modelsDir) {
      return ["-m", join(modelsDir, this.files[0].filename), "--steps", "20"];
    },
    defaultWidth: 512,
    defaultHeight: 512,
    vulkanSafe: true,
  },
  flux4b: {
    label: "FLUX.2 Klein 4B (Q4_0) — lightweight",
    files: [
      {
        filename: "flux-2-klein-4b-Q4_0.gguf",
        url: "https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q4_0.gguf",
      },
      FLUX_VAE,
      {
        filename: "Qwen3-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
      },
    ],
    totalSize: "~4.9 GB",
    buildArgs(modelsDir) {
      return [
        "--diffusion-model", join(modelsDir, this.files[0].filename),
        "--vae", join(modelsDir, FLUX_VAE.filename),
        "--llm", join(modelsDir, this.files[2].filename),
        "--cfg-scale", "1.0",
        "--steps", "4",
        "--diffusion-fa",
        "--offload-to-cpu",
      ];
    },
    defaultWidth: 1024,
    defaultHeight: 1024,
    vulkanSafe: true,
  },
  flux: {
    label: "FLUX.2 Klein 9B (Q4_0) — recommended quality",
    files: [
      {
        filename: "flux-2-klein-9b-Q4_0.gguf",
        url: "https://huggingface.co/leejet/FLUX.2-klein-9B-GGUF/resolve/main/flux-2-klein-9b-Q4_0.gguf",
      },
      FLUX_VAE,
      {
        filename: "Qwen3-8B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
      },
    ],
    totalSize: "~11 GB",
    buildArgs(modelsDir) {
      return [
        "--diffusion-model", join(modelsDir, this.files[0].filename),
        "--vae", join(modelsDir, FLUX_VAE.filename),
        "--llm", join(modelsDir, this.files[2].filename),
        "--cfg-scale", "1.0",
        "--steps", "4",
        "--diffusion-fa",
        "--offload-to-cpu",
      ];
    },
    defaultWidth: 1024,
    defaultHeight: 1024,
    vulkanSafe: false,
  },
  "flux-dev": {
    label: "FLUX.2 Dev 32B (Q4_K_S) — best quality, needs 32 GB+ RAM",
    files: [
      {
        filename: "flux2-dev-Q4_K_S.gguf",
        url: "https://huggingface.co/city96/FLUX.2-dev-gguf/resolve/main/flux2-dev-Q4_K_S.gguf",
      },
      FLUX_VAE,
      {
        filename: "Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF/resolve/main/Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf",
      },
    ],
    totalSize: "~34 GB",
    buildArgs(modelsDir) {
      return [
        "--diffusion-model", join(modelsDir, this.files[0].filename),
        "--vae", join(modelsDir, FLUX_VAE.filename),
        "--llm", join(modelsDir, this.files[2].filename),
        "--cfg-scale", "1.0",
        "--steps", "8",
        "--sampling-method", "euler",
        "--diffusion-fa",
        "--offload-to-cpu",
      ];
    },
    defaultWidth: 1024,
    defaultHeight: 1024,
    vulkanSafe: false,
  },
};

export class LocalBackend implements BackendProvider {
  readonly name = "local";
  readonly supportsImg2Img = true;
  readonly requiresSession = false;

  private apiUrl?: string;
  private modelName?: string;

  constructor(apiUrl?: string, modelName?: string) {
    this.apiUrl = apiUrl;
    this.modelName = modelName;
  }

  async isAvailable(): Promise<boolean> {
    if (this.apiUrl) {
      return this.checkApiAvailable();
    }
    return true;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = Date.now();

    try {
      if (this.apiUrl) {
        return await this.generateViaApi(request, startTime);
      }
      return await this.generateViaCli(request, startTime);
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      debug(COMPONENT, `Generation failed: ${error.message}`);
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
    }
  }

  // ─── CLI mode (sd.cpp) ────────────────────────────────────────────

  private resolveModelDef(): ModelDef {
    const name = this.modelName ?? "sd15";
    const def = MODELS[name];
    if (!def) {
      const available = Object.entries(MODELS).map(([k, v]) => `${k} (${v.label})`).join(", ");
      throw new Error(`Unknown model: ${name}. Available: ${available}`);
    }
    return def;
  }

  private async generateViaCli(request: GenerationRequest, startTime: number): Promise<GenerationResult> {
    await this.ensureBinary();
    const modelDef = this.resolveModelDef();
    await this.ensureModelFiles(modelDef);

    // Pick Vulkan binary for GPU acceleration when the model fits in iGPU VRAM
    const binaryPath = this.pickBinary(modelDef);
    const useVulkan = binaryPath.includes("vulkan");

    const outputDir = resolve("output");
    mkdirSync(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = join(outputDir, `gen_${timestamp}.png`);

    // Build sd-cli arguments from model definition
    const args: string[] = [
      ...modelDef.buildArgs(MODELS_DIR),
      "-p", request.prompt.value,
      "-o", outputPath,
    ];

    // Vulkan with iGPU needs offload-to-cpu and vae-on-cpu (2 GB shared VRAM)
    if (useVulkan) {
      if (!args.includes("--offload-to-cpu")) args.push("--offload-to-cpu");
      if (!args.includes("--vae-on-cpu")) args.push("--vae-on-cpu");
    }

    // Dimensions (use model defaults if not specified)
    args.push("-W", String(request.width ?? modelDef.defaultWidth));
    args.push("-H", String(request.height ?? modelDef.defaultHeight));

    // img2img — sd.cpp only supports PNG/JPG input, convert if needed
    if (request.hasImages) {
      const convertedPaths = await this.convertInputImages(request);
      const modelName = this.modelName ?? "sd15";

      if (modelName.startsWith("flux")) {
        // FLUX.2 Klein supports kontext-style ref-image (-r) which preserves
        // subject identity from the reference.
        // 1 image:  -r character  (identity-preserving reference)
        // 2+ images: -r character + -i layout --strength 0.6
        //            (first = character identity, second = spatial layout)
        args.push("-r", convertedPaths[0]);
        args.push("--sampling-method", "euler");
        if (convertedPaths.length > 1) {
          debug(COMPONENT, "Using ref-image (-r) for character + init-img (-i) for layout");
          args.push("-i", convertedPaths[1]);
          args.push("--strength", "0.6");
        } else {
          debug(COMPONENT, "Using kontext-style ref-image (-r) for FLUX model");
        }
      } else {
        // SD 1.5 only has traditional noise-based img2img (-i)
        args.push("-i", convertedPaths[0]);
        args.push("--strength", "0.75");
      }
    }

    args.push("--seed", String(Math.floor(Math.random() * 2147483647)));

    debug(COMPONENT, `Model: ${modelDef.label}`);
    debug(COMPONENT, `Running: ${SD_BINARY} ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`);

    // Run from the binary's directory so it finds its DLL
    const binaryDir = join(binaryPath, "..");
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      cwd: binaryDir,
      timeout: 1800000, // 30 minutes max (large models on CPU are slow)
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) debug(COMPONENT, `stdout: ${stdout.slice(0, 500)}`);
    if (stderr) debug(COMPONENT, `stderr: ${stderr.slice(0, 500)}`);

    if (!existsSync(outputPath)) {
      throw new Error("sd-cli did not produce an output file");
    }

    const durationMs = Date.now() - startTime;
    debug(COMPONENT, `Image generated in ${durationMs}ms: ${outputPath}`);

    return {
      success: true,
      filePath: outputPath,
      backend: this.name,
      durationMs,
    };
  }

  // ─── API mode (ComfyUI / SD WebUI) ───────────────────────────────

  private async checkApiAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(this.apiUrl!, { signal: AbortSignal.timeout(5000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async generateViaApi(request: GenerationRequest, startTime: number): Promise<GenerationResult> {
    debug(COMPONENT, `Generating via API: ${this.apiUrl}`);

    const payload: Record<string, unknown> = {
      prompt: request.prompt.value,
      steps: 20,
      width: request.width ?? 512,
      height: request.height ?? 512,
      cfg_scale: 7,
      seed: Math.floor(Math.random() * 2147483647),
    };

    const endpoint = request.hasImages ? "/sdapi/v1/img2img" : "/sdapi/v1/txt2img";

    if (request.hasImages) {
      const { readFileSync } = await import("fs");
      const imgBuf = readFileSync(request.imageInputs[0].filePath);
      payload.init_images = [imgBuf.toString("base64")];
      payload.denoising_strength = 0.75;
    }

    const url = this.apiUrl!.replace(/\/$/, "") + endpoint;
    debug(COMPONENT, `POST ${url}`);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300000),
    });

    if (!resp.ok) {
      throw new Error(`API returned ${resp.status}: ${await resp.text()}`);
    }

    const result = await resp.json() as { images?: string[] };
    if (!result.images || result.images.length === 0) {
      throw new Error("API returned no images");
    }

    const imgBuffer = Buffer.from(result.images[0], "base64");

    const outputDir = resolve("output");
    mkdirSync(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = join(outputDir, `gen_${timestamp}.png`);
    writeFileSync(outputPath, imgBuffer);

    const durationMs = Date.now() - startTime;
    debug(COMPONENT, `Image saved to: ${outputPath}`);

    return {
      success: true,
      filePath: outputPath,
      backend: this.name,
      durationMs,
    };
  }

  // ─── Auto-provisioning ───────────────────────────────────────────

  /** Pick the best binary for the given model: Vulkan if available and safe, else CPU */
  private pickBinary(modelDef: ModelDef): string {
    const vulkanBin = join(VULKAN_DIR, SD_BINARY);
    if (modelDef.vulkanSafe && existsSync(vulkanBin)) {
      debug(COMPONENT, `Using Vulkan GPU-accelerated binary (~1.7x faster)`);
      return vulkanBin;
    }
    const cpuBin = join(CPU_DIR, SD_BINARY);
    debug(COMPONENT, modelDef.vulkanSafe
      ? `Vulkan binary not found, using CPU binary`
      : `Model too large for iGPU, using CPU binary`);
    return cpuBin;
  }

  private async ensureBinary(): Promise<void> {
    const cpuBinary = join(CPU_DIR, SD_BINARY);

    if (!existsSync(cpuBinary)) {
      debug(COMPONENT, "sd.cpp CPU binary not found, downloading...");
      await this.downloadBinaryVariant(this.getCpuAssetPattern(), CPU_DIR);
    } else {
      debug(COMPONENT, `CPU binary found: ${cpuBinary}`);
    }

    // Also download Vulkan binary on Windows (for GPU acceleration)
    if (process.platform === "win32") {
      const vulkanBinary = join(VULKAN_DIR, SD_BINARY);
      if (!existsSync(vulkanBinary)) {
        debug(COMPONENT, "Downloading Vulkan GPU binary for acceleration...");
        try {
          await this.downloadBinaryVariant("win-vulkan-x64", VULKAN_DIR);
        } catch (e: any) {
          debug(COMPONENT, `Vulkan binary download failed (non-fatal): ${e.message}`);
        }
      }
    }
  }

  private async downloadBinaryVariant(assetPattern: string, destDir: string): Promise<void> {
    mkdirSync(destDir, { recursive: true });
    debug(COMPONENT, `Looking for asset matching: ${assetPattern}`);

    const releasesResp = await fetch(SDCPP_RELEASES_API, {
      headers: { "User-Agent": "imagegen/1.0" },
      signal: AbortSignal.timeout(30000),
    });

    if (!releasesResp.ok) {
      throw new Error(`GitHub API returned ${releasesResp.status}`);
    }

    const releases = await releasesResp.json() as Array<{
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string; size: number }>;
    }>;

    let downloadUrl = "";
    let assetName = "";
    for (const release of releases) {
      const asset = release.assets.find(a => a.name.includes(assetPattern));
      if (asset) {
        downloadUrl = asset.browser_download_url;
        assetName = asset.name;
        debug(COMPONENT, `Found asset in ${release.tag_name}: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
        break;
      }
    }

    if (!downloadUrl) {
      throw new Error(`No sd.cpp binary found for pattern: ${assetPattern}`);
    }

    const zipPath = join(destDir, assetName);
    await this.downloadFile(downloadUrl, zipPath, `sd.cpp binary (${assetName})`);
    await this.extractArchive(zipPath, destDir);

    const binaryPath = join(destDir, SD_BINARY);
    if (!existsSync(binaryPath)) {
      throw new Error(`Extraction succeeded but ${SD_BINARY} not found in ${destDir}`);
    }

    if (process.platform !== "win32") {
      chmodSync(binaryPath, 0o755);
    }

    debug(COMPONENT, `Binary installed: ${binaryPath}`);
  }

  private async ensureModelFiles(modelDef: ModelDef): Promise<void> {
    mkdirSync(MODELS_DIR, { recursive: true });

    const missing = modelDef.files.filter(f => !existsSync(join(MODELS_DIR, f.filename)));

    if (missing.length === 0) {
      debug(COMPONENT, `All model files present for ${modelDef.label}`);
      return;
    }

    console.error(`\nModel: ${modelDef.label}`);
    console.error(`Total download: ${modelDef.totalSize} (${missing.length} file(s))\n`);

    for (const file of missing) {
      const destPath = join(MODELS_DIR, file.filename);
      await this.downloadFile(file.url, destPath, file.filename);
    }

    debug(COMPONENT, `All model files installed for ${modelDef.label}`);
  }

  private getCpuAssetPattern(): string {
    const platform = process.platform;

    if (platform === "win32") {
      // AVX2 for CPU inference — universally reliable
      // Vulkan/CUDA variants need dedicated GPU with sufficient VRAM
      return "win-avx2-x64";
    }
    if (platform === "darwin") return "Darwin";
    if (platform === "linux") return "Linux-Ubuntu";

    throw new Error(`Unsupported platform: ${platform}/${process.arch}`);
  }

  private async downloadFile(url: string, destPath: string, label: string): Promise<void> {
    const { createWriteStream } = await import("fs");

    console.error(`Downloading ${label}...`);
    console.error(`  From: ${url.slice(0, 120)}`);

    const resp = await fetch(url, {
      headers: { "User-Agent": "imagegen/1.0" },
      signal: AbortSignal.timeout(1800000), // 30 minutes for large models
      redirect: "follow",
    });

    if (!resp.ok) {
      throw new Error(`Download failed: HTTP ${resp.status} for ${label}`);
    }

    const contentLength = resp.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    // Stream directly to disk to handle files > 2 GB
    const writer = createWriteStream(destPath);
    const reader = resp.body!.getReader();
    let received = 0;
    let lastPercent = -1;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(value);
        received += value.length;

        if (totalBytes > 0) {
          const percent = Math.floor((received / totalBytes) * 100);
          if (percent !== lastPercent && percent % 10 === 0) {
            console.error(`  Progress: ${percent}% (${(received / 1024 / 1024).toFixed(0)} MB / ${(totalBytes / 1024 / 1024).toFixed(0)} MB)`);
            lastPercent = percent;
          }
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        writer.end(() => resolve());
        writer.on("error", reject);
      });
    }

    console.error(`  Done: ${(received / 1024 / 1024).toFixed(1)} MB\n`);
  }

  private async extractArchive(zipPath: string, destDir: string): Promise<void> {
    debug(COMPONENT, `Extracting ${zipPath} to ${destDir}`);

    if (process.platform === "win32") {
      await execFileAsync("powershell", [
        "-NoProfile", "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ], { timeout: 60000 });
    } else {
      await execFileAsync("unzip", ["-o", zipPath, "-d", destDir], { timeout: 60000 });
    }

    // The zip might contain the binary in a subdirectory — find and move it
    const binaryTarget = join(destDir, SD_BINARY);
    if (!existsSync(binaryTarget)) {
      const found = this.findFile(destDir, SD_BINARY);
      if (found) {
        renameSync(found, binaryTarget);
        debug(COMPONENT, `Moved ${found} -> ${binaryTarget}`);
      }
    }

    try { unlinkSync(zipPath); } catch { /* ignore */ }
  }

  /** Convert input images to PNG/JPG if needed (sd.cpp only supports those formats) */
  private async convertInputImages(request: GenerationRequest): Promise<string[]> {
    const paths: string[] = [];
    for (let i = 0; i < request.imageInputs.length; i++) {
      const inputPath = resolve(request.imageInputs[i].filePath);
      const ext = inputPath.split(".").pop()?.toLowerCase();

      if (ext && !["png", "jpg", "jpeg"].includes(ext)) {
        debug(COMPONENT, `Converting ${ext} input #${i} to PNG for sd.cpp compatibility`);
        const { default: sharp } = await import("sharp");
        const convertedPath = join(LOCAL_DIR, `input_converted_${i}.png`);
        await sharp(inputPath).png().toFile(convertedPath);
        paths.push(convertedPath);
      } else {
        paths.push(inputPath);
      }
    }
    return paths;
  }

  private findFile(dir: string, name: string): string | null {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === name) return fullPath;
        if (stat.isDirectory()) {
          const found = this.findFile(fullPath, name);
          if (found) return found;
        }
      } catch { /* skip */ }
    }
    return null;
  }
}
