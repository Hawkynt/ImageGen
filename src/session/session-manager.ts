import { chromium, type BrowserContext } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { debug } from "../debug/logger.js";

const SESSIONS_ROOT = join(homedir(), ".imagegen", "sessions");

// Spoof a real browser UA for all sessions to avoid bot detection
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

export interface SessionConfig {
  backend: string;
  loginUrl: string;
}

function sessionDir(backend: string): string {
  return join(SESSIONS_ROOT, backend);
}

export function sessionExists(backend: string): boolean {
  return existsSync(sessionDir(backend));
}

/**
 * Detect a real system browser to use instead of Playwright's bundled Chromium.
 * Google blocks login from automation-detected browsers, so we need
 * a real Chrome or Edge installation.
 */
function detectSystemBrowser(): { channel?: string; executablePath?: string } {
  // Try Chrome first, then Edge
  const candidates: { channel: string; paths: string[] }[] = [
    {
      channel: "chrome",
      paths: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
      ],
    },
    {
      channel: "msedge",
      paths: [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ],
    },
  ];

  for (const browser of candidates) {
    for (const p of browser.paths) {
      if (existsSync(p)) {
        debug("session", `Found system browser: ${browser.channel} at ${p}`);
        return { channel: browser.channel };
      }
    }
  }

  // Fallback: try to find Edge via EdgeCore (versioned path)
  try {
    const result = execSync(
      'powershell -Command "(Get-ChildItem \'C:\\Program Files (x86)\\Microsoft\\EdgeCore\' -Filter msedge.exe -Recurse -ErrorAction SilentlyContinue | Select -First 1).FullName"',
      { encoding: "utf-8" }
    ).trim();
    if (result && existsSync(result)) {
      debug("session", `Found Edge via EdgeCore: ${result}`);
      return { executablePath: result };
    }
  } catch {
    // ignore
  }

  debug("session", "No system browser found, falling back to Playwright Chromium");
  return {};
}

export async function openLoginSession(config: SessionConfig): Promise<void> {
  const dir = sessionDir(config.backend);
  mkdirSync(dir, { recursive: true });
  debug("session", `Opening headed browser for login to ${config.backend}`);
  debug("session", `Session dir: ${dir}`);
  debug("session", `Login URL: ${config.loginUrl}`);

  const browserOpts = detectSystemBrowser();
  debug("session", "Browser launch options:", browserOpts);

  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    ...browserOpts,
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());

  // Mask automation indicators
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await page.goto(config.loginUrl);

  console.log(
    `\nBrowser opened to ${config.loginUrl}\nLog in manually, then close the browser or press Enter here to save session.\n`
  );

  await Promise.race([
    new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    }),
    new Promise<void>((resolve) => {
      context.on("close", () => resolve());
    }),
  ]);

  try {
    await context.close();
  } catch {
    // already closed by user
  }

  debug("session", `Session saved for ${config.backend}`);
}

export async function createSessionContext(
  backend: string,
  headless: boolean = true
): Promise<BrowserContext> {
  const dir = sessionDir(backend);
  if (!existsSync(dir)) {
    throw new SessionError(
      "SESSION_EXPIRED",
      `No session found for ${backend}. Run: imagegen login --backend ${backend}`
    );
  }

  debug("session", `Launching ${headless ? "headless" : "headed"} browser for ${backend}`);
  debug("session", `Session dir: ${dir}`);

  const browserOpts = detectSystemBrowser();
  debug("session", "Browser launch options:", browserOpts);

  const context = await chromium.launchPersistentContext(dir, {
    headless,
    ...browserOpts,
    acceptDownloads: true,
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  // Mask automation indicators on every page
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return context;
}

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SessionError";
  }
}
