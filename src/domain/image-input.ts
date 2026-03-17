import { existsSync } from "fs";
import { extname } from "path";

const SUPPORTED_FORMATS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export class ImageInput {
  readonly filePath: string;
  readonly format: string;

  constructor(filePath: string) {
    if (!existsSync(filePath)) {
      throw new ImageInputError(
        "INVALID_IMAGE_INPUT",
        `Image file not found: ${filePath}`
      );
    }
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.has(ext)) {
      throw new ImageInputError(
        "INVALID_IMAGE_INPUT",
        `Unsupported image format: ${ext}. Supported: ${[...SUPPORTED_FORMATS].join(", ")}`
      );
    }
    this.filePath = filePath;
    this.format = ext.slice(1);
  }
}

export class ImageInputError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ImageInputError";
  }
}
