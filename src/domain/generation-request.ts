import { Prompt } from "./prompt.js";
import { ImageInput } from "./image-input.js";

export interface GenerationRequestParams {
  prompt: string;
  imagePath?: string;
  imagePaths?: string[];
  width?: number;
  height?: number;
  backend?: string;
  apiUrl?: string;
  model?: string;
}

export class GenerationRequest {
  readonly prompt: Prompt;
  readonly imageInputs: ImageInput[];
  readonly width?: number;
  readonly height?: number;
  readonly backend: string;
  readonly apiUrl?: string;
  readonly model?: string;

  constructor(params: GenerationRequestParams) {
    this.prompt = new Prompt(params.prompt);
    const paths = params.imagePaths ?? (params.imagePath ? [params.imagePath] : []);
    this.imageInputs = paths.map((p) => new ImageInput(p));
    this.width = params.width;
    this.height = params.height;
    this.backend = params.backend ?? "gemini";
    this.apiUrl = params.apiUrl;
    this.model = params.model;
  }

  /** Convenience: true if any reference images were provided */
  get hasImages(): boolean {
    return this.imageInputs.length > 0;
  }
}
