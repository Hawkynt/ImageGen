import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenerationRequest } from "../../src/domain/generation-request.js";
import { PromptError } from "../../src/domain/prompt.js";
import { ImageInputError } from "../../src/domain/image-input.js";

let dir: string;
let pngA: string;
let pngB: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "imagegen-test-"));
  pngA = join(dir, "a.png");
  pngB = join(dir, "b.png");
  writeFileSync(pngA, "dummy");
  writeFileSync(pngB, "dummy");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GenerationRequest", () => {
  describe("defaults (equivalence class: minimal params)", () => {
    it("given only a prompt, when constructing, then backend defaults to gemini and no images are set", () => {
      const request = new GenerationRequest({ prompt: "a cat" });
      expect(request.backend).toBe("gemini");
      expect(request.imageInputs).toHaveLength(0);
      expect(request.hasImages).toBe(false);
      expect(request.width).toBeUndefined();
      expect(request.height).toBeUndefined();
      expect(request.apiUrl).toBeUndefined();
      expect(request.model).toBeUndefined();
    });
  });

  describe("parameter pass-through", () => {
    it("given all optional params, when constructing, then they are stored unchanged", () => {
      const request = new GenerationRequest({
        prompt: "a cat",
        width: 512,
        height: 768,
        backend: "chatgpt",
        apiUrl: "http://localhost:7860",
        model: "flux",
      });
      expect(request.width).toBe(512);
      expect(request.height).toBe(768);
      expect(request.backend).toBe("chatgpt");
      expect(request.apiUrl).toBe("http://localhost:7860");
      expect(request.model).toBe("flux");
    });
  });

  describe("image inputs", () => {
    it("given a single imagePath, when constructing, then exactly one input is created", () => {
      const request = new GenerationRequest({ prompt: "a cat", imagePath: pngA });
      expect(request.imageInputs.map((i) => i.filePath)).toEqual([pngA]);
      expect(request.hasImages).toBe(true);
    });

    it("given imagePaths, when constructing, then all inputs are created in order", () => {
      const request = new GenerationRequest({ prompt: "a cat", imagePaths: [pngA, pngB] });
      expect(request.imageInputs.map((i) => i.filePath)).toEqual([pngA, pngB]);
    });

    it("given both imagePaths and imagePath, when constructing, then imagePaths takes precedence", () => {
      const request = new GenerationRequest({
        prompt: "a cat",
        imagePath: pngA,
        imagePaths: [pngB],
      });
      expect(request.imageInputs.map((i) => i.filePath)).toEqual([pngB]);
    });
  });

  describe("validation errors propagate (exceptional cases)", () => {
    it("given an empty prompt, when constructing, then PromptError is thrown", () => {
      expect(() => new GenerationRequest({ prompt: "  " })).toThrow(PromptError);
    });

    it("given a missing image file, when constructing, then ImageInputError is thrown", () => {
      expect(
        () => new GenerationRequest({ prompt: "a cat", imagePath: join(dir, "missing.png") }),
      ).toThrow(ImageInputError);
    });
  });
});
