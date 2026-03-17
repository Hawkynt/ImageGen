const MAX_PROMPT_LENGTH = 10000;

export class Prompt {
  readonly value: string;

  constructor(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new PromptError("INVALID_PROMPT", "Prompt must not be empty");
    }
    if (trimmed.length > MAX_PROMPT_LENGTH) {
      throw new PromptError(
        "INVALID_PROMPT",
        `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`
      );
    }
    this.value = trimmed;
  }
}

export class PromptError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PromptError";
  }
}
