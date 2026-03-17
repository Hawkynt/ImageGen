export interface GenerationResult {
  success: boolean;
  filePath: string;
  width?: number;
  height?: number;
  backend: string;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
}
