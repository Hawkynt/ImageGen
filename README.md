# ImageGen — AI Agent Image Generation Tool

[![License](https://img.shields.io/github/license/Hawkynt/ImageGen)](https://github.com/Hawkynt/ImageGen/blob/main/LICENSE)
[![Language](https://img.shields.io/github/languages/top/Hawkynt/ImageGen?color=8957D5)](https://github.com/Hawkynt/ImageGen)

[![CI](https://github.com/Hawkynt/ImageGen/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Hawkynt/ImageGen/actions/workflows/ci.yml)
![Last Commit](https://img.shields.io/github/last-commit/Hawkynt/ImageGen?branch=main)
![Activity](https://img.shields.io/github/commit-activity/m/Hawkynt/ImageGen)

[![Stars](https://img.shields.io/github/stars/Hawkynt/ImageGen?color=FFD700)](https://github.com/Hawkynt/ImageGen/stargazers)
[![Forks](https://img.shields.io/github/forks/Hawkynt/ImageGen?color=008080)](https://github.com/Hawkynt/ImageGen/network/members)
[![Issues](https://img.shields.io/github/issues/Hawkynt/ImageGen)](https://github.com/Hawkynt/ImageGen/issues)
![Code Size](https://img.shields.io/github/languages/code-size/Hawkynt/ImageGen?color=4CAF50)
![Repo Size](https://img.shields.io/github/repo-size/Hawkynt/ImageGen?color=FF9800)

> A tool exposable to AI agents (via MCP, CLI, or function-call interface) that generates high-quality images from text prompts with optional image input — at zero cost — by browser-automating free web interfaces (Google Gemini, ChatGPT/DALL-E) or running local models via [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp).

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Quick Start](#quick-start)
3. [Backends](#backends)
4. [Domain Model (DDD)](#domain-model-ddd)
5. [User Stories & MoSCoW Prioritization](#user-stories--moscow-prioritization)
6. [Acceptance Criteria (BDD)](#acceptance-criteria-bdd)
7. [Technical Architecture](#technical-architecture)
8. [API / Interface Contract](#api--interface-contract)
9. [Test Strategy (TDD/BDD)](#test-strategy-tddbdd)
10. [Non-Functional Requirements](#non-functional-requirements)
11. [Glossary](#glossary)

---

## Problem Statement

AI agents need the ability to generate images as part of their workflows. Existing solutions either cost money per generation (DALL-E API, Midjourney) or require complex local setup. Many models offer free generation through their web interfaces but not through their APIs — or API usage is billed separately from a paid plan. This tool provides a single, agent-friendly interface that:

- Accepts a text prompt and optional reference image(s)
- Returns a generated image (file path)
- Costs nothing to run — by automating free web UIs or using local models
- Produces high-quality results (Gemini 2.0 Flash, GPT-4o/DALL-E 3, Stable Diffusion)
- Is simple enough for any agent framework to invoke

---

## Quick Start

```bash
# Install dependencies
npm install

# --- Browser backends (Gemini / ChatGPT) ---

# 1. Log in to a browser backend (opens headed browser for manual auth)
npx tsx src/index.ts login --backend gemini
npx tsx src/index.ts login --backend chatgpt

# 2. Generate an image
npx tsx src/index.ts generate --prompt "A sunset over mountains"
npx tsx src/index.ts generate --prompt "A red sports car" --backend chatgpt

# 3. Image-to-image (multiple reference images supported)
npx tsx src/index.ts generate --prompt "Put the character on a spritesheet" \
  --image input/character.png --image input/template.jpg

# --- Local backend (sd.cpp — no login needed) ---

# Auto-downloads sd.cpp binary + SD 1.5 model on first run (~2 GB total)
npx tsx src/index.ts generate --prompt "A pixel art castle" --backend local

# Use FLUX.2 Klein 4B for much higher quality (downloads ~5 GB on first run)
npx tsx src/index.ts generate --prompt "A pixel art castle" --backend local --model flux

# Or connect to an existing SD WebUI / ComfyUI API
npx tsx src/index.ts generate --prompt "A logo" --backend local \
  --api-url http://localhost:7860

# Verbose debug output (saves screenshots to debug/)
npx tsx src/index.ts generate --prompt "A cat" -v
```

**Output:** JSON to stdout with the generated image path:
```json
{
  "success": true,
  "filePath": "D:\\Working Copies\\ImageGen\\output\\gen_2026-03-17T06-25-41-506Z.png",
  "backend": "gemini",
  "durationMs": 114703
}
```

---

## Backends

### Gemini (default)

Browser automation of [gemini.google.com/app](https://gemini.google.com/app) using Playwright.

| Feature          | Details                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| Model            | Gemini 2.0 Flash (image generation)                                            |
| Cost             | Free (Google account required)                                                 |
| Supports img2img | Yes — upload via filechooser intercept                                         |
| Output           | PNG, typically 1264×842 or 1408×768                                            |
| Watermark        | Auto-removed (Gemini sparkle in bottom-right)                                  |
| Session          | `imagegen login --backend gemini`, persisted in `~/.imagegen/sessions/gemini/` |
| Cleanup          | Chat auto-deleted after generation                                             |

### ChatGPT

Browser automation of [chatgpt.com](https://chatgpt.com) using Playwright.

| Feature          | Details                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| Model            | GPT-4o + DALL-E 3                                                                |
| Cost             | Free (OpenAI account required, limited generations)                              |
| Supports img2img | Yes — file input upload                                                          |
| Output           | PNG, 1024×1536 (portrait) or 1536×1024 (landscape)                               |
| Watermark        | None                                                                             |
| Session          | `imagegen login --backend chatgpt`, persisted in `~/.imagegen/sessions/chatgpt/` |
| Cloudflare       | Bypassed via User-Agent spoofing                                                 |
| Cleanup          | Chat auto-deleted after generation                                               |

### Local (sd.cpp)

Runs [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) locally — no browser, no login, fully offline.

| Feature           | Details                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| Models            | SD 1.5 Q8_0 (fast, `--model sd15`) or **FLUX.2 Klein 4B** (top-tier, `--model flux`) |
| Cost              | Free, fully offline                                                                  |
| Supports img2img  | Yes — auto-converts WebP/etc. to PNG for sd.cpp                                      |
| Output            | PNG, default 512×512 (SD 1.5) or 1024×1024 (FLUX)                                    |
| Auto-provisioning | Binary + model files downloaded on first run                                         |
| API mode          | `--api-url http://...` connects to SD WebUI / ComfyUI instead                        |

**Available models:**

| Model                | Flag                     | Download          | Steps | Speed (CPU)   |
| -------------------- | ------------------------ | ----------------- | ----- | ------------- |
| Stable Diffusion 1.5 | `--model sd15` (default) | ~1.9 GB           | 20    | ~2 min @ 512² |
| **FLUX.2 Klein 4B**  | `--model flux`           | ~4.9 GB (3 files) | 4     | ~2 min @ 512² |

FLUX.2 Klein 4B is from [Black Forest Labs](https://blackforestlabs.ai/) — a top-tier open model on the [arena leaderboard](https://lmarena.ai/leaderboard/text-to-image), producing significantly better results than SD 1.5 in only 4 inference steps.

**Auto-provisioning flow:**
1. Checks `~/.imagegen/local/` for `sd-cli` binary
2. If missing, downloads latest release from [leejet/stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp/releases) (platform-matched, ~8 MB)
3. Checks `~/.imagegen/local/models/` for required model files
4. If missing, downloads from HuggingFace (SD 1.5: 1 file, FLUX: 3 files — diffusion model + VAE + text encoder)

---

## Domain Model (DDD)

### Bounded Contexts

```
+---------------------+       +---------------------+       +---------------------+
| Generation Core |  | Backend Adapter |  | Agent Interface |
| --------------- ||---------------------|       |---------------------|
| GenerationRequest   |------>| BackendProvider      |<------| MCPServer           |
| GenerationResult    |       | GeminiBackend       |       | CLIEntrypoint       |
| ImageInput          |       | ChatGPTBackend      |       | FunctionCallSchema  |
| Prompt              |       | LocalBackend        |       |                     |
+---------------------+       +---------------------+       +---------------------+
```

### Core Domain Entities

| Entity              | Description                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `GenerationRequest` | Immutable value object: prompt (required), input images (optional), parameters (size, backend, apiUrl) |
| `GenerationResult`  | Output: image file path, format, backend name, duration, error info                                    |
| `ImageInput`        | Reference image: file path, used for img2img                                                           |
| `Prompt`            | Text prompt value object with validation (non-empty, max length)                                       |
| `BackendProvider`   | Strategy interface — implementations generate images                                                   |

### Aggregates

- **GenerationJob** — root aggregate that orchestrates a single generation: validates request, selects backend, triggers generation, returns result.

---

## User Stories & MoSCoW Prioritization

### Must Have (M) ✅

| ID   | Story                                                                                       | Status |
| ---- | ------------------------------------------------------------------------------------------- | ------ |
| US-1 | As an AI agent, I want to submit a text prompt and receive a generated image                | ✅ Done |
| US-2 | As an AI agent, I want to provide optional reference image(s) alongside my prompt (img2img) | ✅ Done |
| US-3 | As a user, I want the tool to work without payment (free web UIs + local models)            | ✅ Done |
| US-4 | As an AI agent, I want a clear error response when generation fails                         | ✅ Done |
| US-5 | As a developer, I want a CLI interface                                                      | ✅ Done |
| US-6 | As a user, I want a `login` command for browser backends                                    | ✅ Done |

### Should Have (S)

| ID    | Story                                                                       | Status    |
| ----- | --------------------------------------------------------------------------- | --------- |
| US-7  | As an AI agent, I want to specify image dimensions                          | ✅ Done    |
| US-8  | As a developer, I want an MCP server interface                              | 🔲 Planned |
| US-9  | As a user, I want to choose which backend (gemini, chatgpt, local)          | ✅ Done    |
| US-10 | As a user, I want generated images saved to a configurable output directory | ✅ Done    |

### Could Have (C)

| ID    | Story                                                             | Status    |
| ----- | ----------------------------------------------------------------- | --------- |
| US-11 | As an AI agent, I want to request multiple variations             | 🔲 Planned |
| US-12 | As a user, I want a progress indicator                            | 🔲 Planned |
| US-13 | As a developer, I want to add new backends via a plugin interface | 🔲 Planned |

### Won't Have (W) — this version

| ID    | Story                            |
| ----- | -------------------------------- |
| US-14 | Video generation                 |
| US-15 | Image editing/inpainting UI      |
| US-16 | Multi-user / hosted service mode |

---

## Acceptance Criteria (BDD)

### US-1: Text-to-Image Generation

```gherkin
Feature: Text-to-Image Generation

  Scenario: Successful generation from text prompt
    Given the tool is configured with a working backend
    When an agent calls generate with prompt "A sunset over mountains"
    Then a valid image file is returned
    And the image file exists on disk
    And the image is in PNG or JPEG format
    And the result includes the file path and dimensions

  Scenario: Empty prompt is rejected
    When an agent calls generate with an empty prompt
    Then an error is returned with reason "INVALID_PROMPT"

  Scenario: Backend is unavailable
    Given the configured backend is not reachable
    When an agent calls generate with a valid prompt
    Then an error is returned with reason "BACKEND_UNAVAILABLE"
```

### US-2: Image-to-Image Generation

```gherkin
Feature: Image-to-Image Generation

  Scenario: Generation guided by reference image
    Given the tool is configured with a working backend that supports img2img
    When an agent calls generate with prompt "Make it winter" and image "reference.png"
    Then a valid image file is returned
    And the output visually relates to the reference image

  Scenario: Multiple reference images
    When an agent calls generate with prompt "Combine these" and images "a.png", "b.png"
    Then a valid image file is returned

  Scenario: Invalid image path
    When an agent calls generate with prompt "test" and image "nonexistent.png"
    Then an error is returned with reason "INVALID_IMAGE_INPUT"

  Scenario: Backend does not support img2img
    Given the configured backend does not support img2img
    When an agent calls generate with prompt "test" and an image
    Then an error is returned with reason "IMG2IMG_NOT_SUPPORTED"
```

### US-5: CLI Interface

```gherkin
Feature: CLI Interface

  Scenario: Generate via CLI
    When the user runs: imagegen generate --prompt "A red car"
    Then an image is generated and saved to the output directory
    And the file path is printed to stdout as JSON

  Scenario: Help output
    When the user runs: imagegen --help
    Then usage instructions are displayed
```

### US-6: Login & Session Persistence

```gherkin
Feature: Login & Session Management

  Scenario: First-time login for a browser backend
    Given no saved session exists for the "gemini" backend
    When the user runs: imagegen login --backend gemini
    Then a headed browser opens to the Gemini login page
    And the user can manually log in
    When the user closes the browser or presses Enter in the terminal
    Then the browser session (cookies, local storage) is saved to disk
    And subsequent generate commands reuse the saved session without prompting

  Scenario: Session expired or invalidated
    Given a saved session exists for "gemini" but has expired
    When an agent calls generate with a valid prompt
    Then an error is returned with reason "SESSION_EXPIRED"
    And the error message suggests running: imagegen login --backend gemini
```

### US-8: MCP Server

```gherkin
Feature: MCP Tool Interface

  Scenario: Agent calls generate_image tool
    Given the MCP server is running
    When an agent invokes the "generate_image" tool with arguments:
      | prompt | "A forest at dawn" |
    Then the tool returns a result containing the image file path

  Scenario: Tool schema is discoverable
    Given the MCP server is running
    When an agent requests available tools
    Then "generate_image" is listed with its JSON schema
```

---

## Technical Architecture

### Stack

- **Language:** TypeScript (Node.js)
- **CLI framework:** Commander
- **MCP SDK:** `@modelcontextprotocol/sdk` (planned)
- **Browser automation:** Playwright (controls Gemini and ChatGPT web UIs)
- **Local model runtime:** [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (auto-provisioned) or external SD WebUI/ComfyUI API
- **Image processing:** Sharp (watermark removal, format detection)
- **Test framework:** Vitest (planned)

### Project Structure

```
ImageGen/
  README.md              # This file — PRD + documentation
  package.json
  tsconfig.json
  src/
    index.ts             # CLI entrypoint
    mcp-server.ts        # MCP server entrypoint (planned)
    domain/
      generation-request.ts   # Request value object (prompt, images, params)
      generation-result.ts    # Result type (filePath, backend, duration, error)
      image-input.ts          # Image reference value object
      prompt.ts               # Prompt value object with validation
    core/
      generation-job.ts       # Orchestrates generation, selects backend
      watermark-remover.ts    # Detects & removes Gemini watermark
    backends/
      backend-provider.ts      # BackendProvider interface
      browser-backend-base.ts  # Shared browser automation logic
      gemini-backend.ts        # Gemini-specific overrides
      chatgpt-backend.ts       # ChatGPT-specific overrides
      local-backend.ts         # sd.cpp CLI + API mode
      element-discovery.ts     # Heuristic element finding (text input, submit, image)
    session/
      session-manager.ts       # Playwright persistent context + login flow
    debug/
      logger.ts                # Verbose logger, screenshot/HTML captures
  output/                # Default output directory (gitignored)
  input/                 # Test input images
  debug/                 # Debug screenshots (gitignored)
```

---

## Backends

### Browser Automation (Gemini, ChatGPT)

Both browser backends extend `BrowserBackendBase` which implements a generic heuristic interaction model:

```
1. FIND the text input    → type the prompt
2. FIND the submit button → click it
3. WAIT for a new image   → download it
```

#### Element Discovery Heuristics

| Step                   | Strategy                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Find text input**    | Scan for `<textarea>`, `<input[type=text]>`, or `[contenteditable]`. Prefer the largest visible one, or one with placeholder text mentioning "prompt", "message", "describe". |
| **Attach image**       | Look for `<input[type=file]>` (ChatGPT) or intercept filechooser via upload menu (Gemini).                                                                                    |
| **Find submit button** | Look for `<button>` near the text input. Prefer buttons with `type=submit`, `data-testid="send-button"`, or aria-labels containing "send", "generate".                        |
| **Detect new image**   | Snapshot all `<img>` sources before submit. Poll for new `<img>` with `src` not in snapshot, filtering UI assets (`gstatic.com`, avatars).                                    |
| **Download image**     | Try full-resolution URL transformation (`=s0` for Google). For ChatGPT, try both direct fetch and download button (hover to reveal). Compare sizes, keep larger.              |

#### Session Management

- `imagegen login --backend <name>` opens a **headed** browser (system Edge/Chrome)
- User logs in manually (handles 2FA, CAPTCHAs)
- Session saved via Playwright's persistent browser context (`~/.imagegen/sessions/<backend>/`)
- Subsequent `generate` calls launch a **headless** browser reusing the session
- User-Agent spoofed to Edge 131 to avoid bot detection
- `navigator.webdriver` set to false via `--disable-blink-features=AutomationControlled`

### Local Backend (sd.cpp)

Two modes:

**CLI mode** (default): Runs `sd-cli` as a subprocess.
- Auto-downloads binary from GitHub releases if not present
- Auto-downloads SD 1.5 Q8_0 GGUF model if no model file found
- Supports custom models — place any `.gguf` / `.safetensors` in `~/.imagegen/local/models/`

**API mode** (`--api-url`): Connects to an existing SD WebUI or ComfyUI instance.
- Uses the standard `/sdapi/v1/txt2img` and `/sdapi/v1/img2img` endpoints
- No auto-provisioning needed

### Backend Provider Interface

```typescript
interface BackendProvider {
  readonly name: string;
  readonly supportsImg2Img: boolean;
  readonly requiresSession: boolean;

  isAvailable(): Promise<boolean>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
```

---

## API / Interface Contract

### CLI

```bash
# First-time setup: log in to a browser backend
imagegen login --backend gemini
imagegen login --backend chatgpt

# Text-to-image (defaults to gemini backend)
imagegen generate --prompt "A sunset over mountains"

# Image-to-image (multiple images supported)
imagegen generate --prompt "Make it snowy" --image ./reference.png
imagegen generate --prompt "Combine these" --image a.png --image b.png

# Choose backend
imagegen generate --prompt "A red car" --backend chatgpt
imagegen generate --prompt "A logo" --backend local

# Local with external API
imagegen generate --prompt "A logo" --backend local --api-url http://localhost:7860

# With dimensions
imagegen generate --prompt "A logo" --width 512 --height 512

# Verbose debug output
imagegen generate --prompt "A cat" -v
```

**stdout (JSON):**
```json
{
  "success": true,
  "filePath": "./output/gen_2026-03-17T06-25-41-506Z.png",
  "backend": "gemini",
  "durationMs": 114703
}
```

### MCP Tool Schema (planned)

```json
{
  "name": "generate_image",
  "description": "Generate an image from a text prompt with optional reference image input.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "Text description of the image to generate."
      },
      "image": {
        "type": "string",
        "description": "Optional. File path to a reference image for img2img."
      },
      "width": { "type": "number", "description": "Output width in pixels." },
      "height": { "type": "number", "description": "Output height in pixels." },
      "backend": {
        "type": "string",
        "enum": ["gemini", "chatgpt", "local"],
        "description": "Which backend to use. Defaults to gemini."
      }
    },
    "required": ["prompt"]
  }
}
```

---

## Test Strategy (TDD/BDD)

### Unit Tests (TDD)

| Area                | What to test                                           |
| ------------------- | ------------------------------------------------------ |
| `Prompt`            | Validation: non-empty, max length, trimming            |
| `ImageInput`        | File existence check, format validation (PNG/JPG/WEBP) |
| `GenerationRequest` | Construction with valid/invalid inputs                 |
| `GenerationJob`     | Backend selection, error mapping, result construction  |
| `ElementDiscovery`  | Heuristic matching against mock DOM snapshots          |
| `SessionManager`    | Session path construction, expiry detection            |
| Local backend       | Mock HTTP responses, verify correct API calls          |

### Integration Tests

| Area            | What to test                                              |
| --------------- | --------------------------------------------------------- |
| Gemini backend  | Browser automation (requires Google login, skipped in CI) |
| ChatGPT backend | Browser automation (requires OpenAI login, skipped in CI) |
| Local backend   | sd.cpp CLI generation, API mode against running instance  |
| CLI             | End-to-end: invoke CLI, verify output file created        |
| MCP server      | Start server, send tool call, verify response             |

### Test Commands

```bash
npm test              # All unit tests
npm run test:bdd      # BDD scenarios
npm run test:int      # Integration tests (requires backends)
npm run test:all      # Everything
```

---

## Non-Functional Requirements

| Requirement     | Target                                                                |
| --------------- | --------------------------------------------------------------------- |
| Generation time | < 60s for local, < 120s for browser-automated backends                |
| Output quality  | Minimum 512×512, up to 1536×1024 on ChatGPT, up to 1408×768 on Gemini |
| Cost            | $0 per generation (uses free web tiers + local models)                |
| Reliability     | Graceful degradation with clear errors; fallback between backends     |
| Portability     | Windows, macOS, Linux                                                 |
| Dependencies    | Node.js 20+, Playwright (for browser backends), sharp                 |

---

## Glossary

| Term               | Definition                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **txt2img**        | Text-to-image generation: creating an image solely from a text prompt                                                 |
| **img2img**        | Image-to-image generation: modifying/guiding output using a reference image                                           |
| **Backend**        | An image generation engine (browser-automated service or local model)                                                 |
| **sd.cpp**         | [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) — lightweight C/C++ Stable Diffusion inference |
| **GGUF**           | Quantized model format used by sd.cpp, reduces memory usage by 40-60%                                                 |
| **MCP**            | Model Context Protocol — standard for exposing tools to AI agents                                                     |
| **Playwright**     | Browser automation library used to control web UIs                                                                    |
| **ComfyUI**        | Node-based UI/API for Stable Diffusion workflows                                                                      |
| **SD WebUI**       | Stable Diffusion Web UI (Automatic1111/Forge) with REST API                                                           |
| **Generation Job** | A single end-to-end image generation request lifecycle                                                                |
