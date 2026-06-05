import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageInput, ImageInputError } from "../../src/domain/image-input.js";

let dir: string;

function createFile(name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, "dummy");
  return filePath;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "imagegen-test-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ImageInput", () => {
  describe("supported formats (equivalence class: existing file with allowed extension)", () => {
    it.each(["png", "jpg", "jpeg", "webp"])(
      "given an existing .%s file, when constructing, then format is derived without the dot",
      (ext) => {
        const filePath = createFile(`image.${ext}`);
        const input = new ImageInput(filePath);
        expect(input.filePath).toBe(filePath);
        expect(input.format).toBe(ext);
      },
    );

    it("given an uppercase extension, when constructing, then it is accepted case-insensitively", () => {
      const input = new ImageInput(createFile("image.PNG"));
      expect(input.format).toBe("png");
    });
  });

  describe("invalid inputs (equivalence classes: missing file, unsupported extension)", () => {
    it("given a non-existing path, when constructing, then ImageInputError with code INVALID_IMAGE_INPUT is thrown", () => {
      try {
        new ImageInput(join(dir, "does-not-exist.png"));
        expect.unreachable("expected ImageInputError");
      } catch (e) {
        expect(e).toBeInstanceOf(ImageInputError);
        expect((e as ImageInputError).code).toBe("INVALID_IMAGE_INPUT");
        expect((e as ImageInputError).message).toContain("not found");
      }
    });

    it("given an existing file with an unsupported extension, when constructing, then ImageInputError is thrown", () => {
      const filePath = createFile("image.gif");
      expect(() => new ImageInput(filePath)).toThrow(ImageInputError);
      expect(() => new ImageInput(filePath)).toThrow(/Unsupported image format/);
    });

    it("given an existing file without any extension, when constructing, then ImageInputError is thrown", () => {
      expect(() => new ImageInput(createFile("image"))).toThrow(ImageInputError);
    });
  });
});
