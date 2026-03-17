import type { GenerationRequest } from "../domain/generation-request.js";
import type { GenerationResult } from "../domain/generation-result.js";

export interface BackendProvider {
  readonly name: string;
  readonly supportsImg2Img: boolean;
  readonly requiresSession: boolean;

  isAvailable(): Promise<boolean>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export interface BrowserBackendConfig {
  name: string;
  url: string;
  loginUrl: string;
  hints?: {
    promptSelector?: string;
    submitSelector?: string;
    imageContainerSelector?: string;
  };
}
