import { describe, expect, it } from "vitest";
import { Prompt, PromptError } from "../../src/domain/prompt.js";

const MAX_LENGTH = 10000;

describe("Prompt", () => {
  describe("valid prompts (equivalence class: non-empty within limit)", () => {
    it("given a normal prompt, when constructing, then value is stored", () => {
      const prompt = new Prompt("a cat on a skateboard");
      expect(prompt.value).toBe("a cat on a skateboard");
    });

    it("given a prompt with surrounding whitespace, when constructing, then value is trimmed", () => {
      const prompt = new Prompt("  a cat  ");
      expect(prompt.value).toBe("a cat");
    });

    it("given a single character, when constructing, then it is accepted (lower boundary)", () => {
      expect(new Prompt("x").value).toBe("x");
    });
  });

  describe("length boundaries", () => {
    it("given exactly the maximum length, when constructing, then it is accepted", () => {
      const raw = "a".repeat(MAX_LENGTH);
      expect(new Prompt(raw).value).toHaveLength(MAX_LENGTH);
    });

    it("given one character over the maximum, when constructing, then PromptError is thrown", () => {
      const raw = "a".repeat(MAX_LENGTH + 1);
      expect(() => new Prompt(raw)).toThrow(PromptError);
    });

    it("given maximum length plus surrounding whitespace, when constructing, then trimming happens before the length check", () => {
      const raw = "  " + "a".repeat(MAX_LENGTH) + "  ";
      expect(new Prompt(raw).value).toHaveLength(MAX_LENGTH);
    });
  });

  describe("invalid prompts (equivalence class: empty after trim)", () => {
    it("given an empty string, when constructing, then PromptError with code INVALID_PROMPT is thrown", () => {
      try {
        new Prompt("");
        expect.unreachable("expected PromptError");
      } catch (e) {
        expect(e).toBeInstanceOf(PromptError);
        expect((e as PromptError).code).toBe("INVALID_PROMPT");
        expect((e as PromptError).name).toBe("PromptError");
      }
    });

    it("given a whitespace-only string, when constructing, then PromptError is thrown", () => {
      expect(() => new Prompt("   \t\n  ")).toThrow(PromptError);
    });
  });
});
