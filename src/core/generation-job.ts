import type { BackendProvider } from "../backends/backend-provider.js";
import { GenerationRequest, type GenerationRequestParams } from "../domain/generation-request.js";
import type { GenerationResult } from "../domain/generation-result.js";
import { GeminiBackend } from "../backends/gemini-backend.js";
import { ChatGptBackend } from "../backends/chatgpt-backend.js";
import { LocalBackend } from "../backends/local-backend.js";
import { debug } from "../debug/logger.js";

const COMPONENT = "generation-job";

const browserBackends: Record<string, BackendProvider> = {
  gemini: new GeminiBackend(),
  chatgpt: new ChatGptBackend(),
};

export async function runGeneration(
  params: GenerationRequestParams
): Promise<GenerationResult> {
  debug(COMPONENT, "Creating generation request", params);

  const request = new GenerationRequest(params);
  const backendName = request.backend;

  // Local backend is created on-demand with optional apiUrl
  let backend: BackendProvider | undefined;
  if (backendName === "local") {
    backend = new LocalBackend(request.apiUrl, request.model);
  } else {
    backend = browserBackends[backendName];
  }

  if (!backend) {
    return {
      success: false,
      filePath: "",
      backend: backendName,
      durationMs: 0,
      error: {
        code: "UNKNOWN_BACKEND",
        message: `Unknown backend: ${backendName}. Available: gemini, chatgpt, local`,
      },
    };
  }

  debug(COMPONENT, `Using backend: ${backend.name}`);

  const available = await backend.isAvailable();
  if (!available) {
    return {
      success: false,
      filePath: "",
      backend: backendName,
      durationMs: 0,
      error: {
        code: "SESSION_EXPIRED",
        message: backendName === "local"
          ? `Local API at ${request.apiUrl} is not reachable`
          : `No session for ${backendName}. Run: imagegen login --backend ${backendName}`,
      },
    };
  }

  if (request.hasImages && !backend.supportsImg2Img) {
    return {
      success: false,
      filePath: "",
      backend: backendName,
      durationMs: 0,
      error: {
        code: "IMG2IMG_NOT_SUPPORTED",
        message: `Backend ${backendName} does not support image-to-image generation`,
      },
    };
  }

  return backend.generate(request);
}
