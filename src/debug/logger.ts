import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

let verbose = false;
let debugDir: string | null = null;

export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function setDebugDir(dir: string): void {
  debugDir = dir;
  mkdirSync(dir, { recursive: true });
}

export function isVerbose(): boolean {
  return verbose;
}

export function debug(component: string, message: string, data?: unknown): void {
  if (!verbose) return;
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${component}]`;
  if (data !== undefined) {
    console.error(`${prefix} ${message}`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  } else {
    console.error(`${prefix} ${message}`);
  }
}

export function debugSaveFile(filename: string, content: string | Buffer): string | null {
  if (!debugDir) return null;
  const filePath = join(debugDir, filename);
  writeFileSync(filePath, content);
  debug("debug", `Saved debug file: ${filePath}`);
  return filePath;
}

export function debugSaveHtml(label: string, html: string): string | null {
  const timestamp = Date.now();
  return debugSaveFile(`${label}_${timestamp}.html`, html);
}

export function debugSaveScreenshot(label: string, buffer: Buffer): string | null {
  const timestamp = Date.now();
  return debugSaveFile(`${label}_${timestamp}.png`, buffer);
}

export function debugSaveElementList(label: string, elements: ElementDebugInfo[]): string | null {
  const timestamp = Date.now();
  const content = elements
    .map(
      (e, i) =>
        `[${i}] <${e.tag}> ${e.attributes}\n    text: ${JSON.stringify(e.text)}\n    visible: ${e.visible}\n    rect: ${JSON.stringify(e.rect)}`
    )
    .join("\n\n");
  return debugSaveFile(`${label}_${timestamp}.txt`, content);
}

export interface ElementDebugInfo {
  tag: string;
  attributes: string;
  text: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number } | null;
}
