import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { removeWatermark } from "../../src/core/watermark-remover.js";

// Mirror the constants from watermark-remover.ts: the sparkle is 48x48 with its
// top-left corner at (width - 80, height - 80).
const WM_SIZE = 48;
const WM_OFFSET = 80;

const BG = { r: 40, g: 40, b: 40 };

async function createUniformImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: BG } })
    .png()
    .toBuffer();
}

async function createWatermarkedImage(width: number, height: number): Promise<Buffer> {
  const sparkle = await sharp({
    create: { width: WM_SIZE, height: WM_SIZE, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width, height, channels: 3, background: BG } })
    .composite([{ input: sparkle, left: width - WM_OFFSET, top: height - WM_OFFSET }])
    .png()
    .toBuffer();
}

async function averageBrightness(
  imageBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data, info } = await sharp(imageBuffer)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return sum / (data.length / info.channels);
}

describe("removeWatermark", () => {
  it("given an image with a bright sparkle at the watermark position, when removing, then the region matches the background afterwards", async () => {
    const width = 512;
    const height = 512;
    const input = await createWatermarkedImage(width, height);

    const result = await removeWatermark(input);

    expect(result).not.toBe(input);
    const brightness = await averageBrightness(result, {
      left: width - WM_OFFSET,
      top: height - WM_OFFSET,
      width: WM_SIZE,
      height: WM_SIZE,
    });
    expect(brightness).toBeCloseTo(BG.r, 0);
  });

  it("given a uniform image without watermark, when removing, then the original buffer is returned unchanged", async () => {
    const input = await createUniformImage(512, 512);
    const result = await removeWatermark(input);
    expect(result).toBe(input);
  });

  it("given an image too small to contain the watermark region (boundary), when removing, then it is skipped without throwing", async () => {
    const input = await createUniformImage(64, 64);
    const result = await removeWatermark(input);
    expect(result).toBe(input);
  });

  it("given the minimal size where the region fits exactly (boundary), when removing, then no error occurs", async () => {
    // regionLeft/regionTop become exactly 0 at WM_OFFSET + 4 padding = 84
    const input = await createUniformImage(84, 84);
    await expect(removeWatermark(input)).resolves.toBeInstanceOf(Buffer);
  });

  it("given a non-image buffer (exceptional case), when removing, then the promise rejects", async () => {
    await expect(removeWatermark(Buffer.from("not an image"))).rejects.toThrow();
  });
});
