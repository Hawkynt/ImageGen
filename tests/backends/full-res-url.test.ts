import { describe, expect, it } from "vitest";
import { BrowserBackendBase } from "../../src/backends/browser-backend-base.js";
import type { BrowserBackendConfig } from "../../src/backends/backend-provider.js";

/** Minimal subclass exposing the protected URL transformation for testing. */
class TestBackend extends BrowserBackendBase {
  readonly name = "test";
  protected config: BrowserBackendConfig = {
    name: "test",
    url: "https://example.com",
    loginUrl: "https://example.com/login",
  };

  fullResUrl(src: string): string {
    return this.getFullResUrl(src);
  }
}

const backend = new TestBackend();
const base = "https://lh3.googleusercontent.com/gg-dl/AB12cd34";

describe("getFullResUrl", () => {
  describe("non-Google URLs (equivalence class: passthrough)", () => {
    it("given a non-Google URL, when transforming, then it is returned unchanged", () => {
      const src = "https://chatgpt.com/backend-api/estuary/content?id=file_123";
      expect(backend.fullResUrl(src)).toBe(src);
    });
  });

  describe("Google URLs with size suffix (equivalence class: replace)", () => {
    it("given an =s1600-rj suffix, when transforming, then it is replaced with =s0", () => {
      expect(backend.fullResUrl(`${base}=s1600-rj`)).toBe(`${base}=s0`);
    });

    it("given a width-height suffix =w800-h600, when transforming, then it is replaced with =s0", () => {
      expect(backend.fullResUrl(`${base}=w800-h600`)).toBe(`${base}=s0`);
    });

    it("given a width-only suffix =w800, when transforming, then it is replaced with =s0", () => {
      expect(backend.fullResUrl(`${base}=w800`)).toBe(`${base}=s0`);
    });

    it("given multiple modifier flags =s1600-rw-no, when transforming, then all are replaced with =s0", () => {
      expect(backend.fullResUrl(`${base}=s1600-rw-no`)).toBe(`${base}=s0`);
    });

    it("given an already full-res =s0 suffix (idempotency), when transforming, then it stays =s0", () => {
      expect(backend.fullResUrl(`${base}=s0`)).toBe(`${base}=s0`);
    });
  });

  describe("Google URLs without size suffix (equivalence class: append)", () => {
    it("given no size suffix, when transforming, then =s0 is appended", () => {
      expect(backend.fullResUrl(base)).toBe(`${base}=s0`);
    });
  });
});
