import { describe, expect, it } from "vitest";
import { detectImageFormat } from "../../src/backends/browser-backend-base.js";

describe("detectImageFormat", () => {
  it("given a PNG magic number, when detecting, then png is returned", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageFormat(buf)).toEqual({ ext: "png", mime: "image/png" });
  });

  it("given a JPEG magic number, when detecting, then jpg is returned", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageFormat(buf)).toEqual({ ext: "jpg", mime: "image/jpeg" });
  });

  it("given a RIFF/WEBP header, when detecting, then webp is returned", () => {
    const buf = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP"),
    ]);
    expect(detectImageFormat(buf)).toEqual({ ext: "webp", mime: "image/webp" });
  });

  it("given a RIFF header without WEBP marker (e.g. WAV), when detecting, then the png default is returned", () => {
    const buf = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WAVE"),
    ]);
    expect(detectImageFormat(buf).ext).toBe("png");
  });

  it("given unknown bytes, when detecting, then png is returned as default", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageFormat(buf).ext).toBe("png");
  });

  it("given an empty buffer (boundary), when detecting, then it falls back to png without throwing", () => {
    expect(detectImageFormat(Buffer.alloc(0)).ext).toBe("png");
  });
});
