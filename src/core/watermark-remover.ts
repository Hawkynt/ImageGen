import sharp from "sharp";
import { debug } from "../debug/logger.js";

const COMPONENT = "watermark-remover";

// The Gemini sparkle watermark is a 48x48 icon in the BOTTOM-RIGHT corner,
// positioned at a fixed offset of 80px from each edge (i.e. 32px margin from
// the corner). Strategy: detect by comparing the watermark region with a
// neighboring reference region. If anomalous brightness/variance detected,
// patch it using pixels from just ABOVE the watermark area (same column).

const WM_SIZE = 48;       // watermark is 48x48 pixels
const WM_OFFSET = 80;     // top-left of watermark is at (width-80, height-80)
const WM_PAD = 4;         // extra padding around the watermark for safe removal

export async function removeWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();

  if (!metadata.width || !metadata.height) {
    debug(COMPONENT, "Could not read image dimensions, skipping watermark removal");
    return imageBuffer;
  }

  const { width, height } = metadata;
  const regionSize = WM_SIZE + WM_PAD * 2;
  const regionLeft = width - WM_OFFSET - WM_PAD;
  const regionTop = height - WM_OFFSET - WM_PAD;

  if (regionLeft < 0 || regionTop < 0) {
    debug(COMPONENT, "Image too small to contain watermark region, skipping watermark removal");
    return imageBuffer;
  }

  debug(COMPONENT, `Image: ${width}x${height}, watermark region: ${regionSize}px at (${regionLeft}, ${regionTop})`);

  // Watermark is in the BOTTOM-RIGHT corner with a fixed offset from the edge
  const wmRegion = {
    left: regionLeft,
    top: regionTop,
    width: regionSize,
    height: regionSize,
  };

  const hasWatermark = await detectWatermark(imageBuffer, wmRegion, width, height);

  if (!hasWatermark) {
    debug(COMPONENT, "No watermark detected, skipping removal");
    return imageBuffer;
  }

  debug(COMPONENT, "Watermark detected in bottom-right corner, performing removal...");

  // Sample a patch from just ABOVE the watermark (same column, adjacent area)
  const patchTop = Math.max(0, wmRegion.top - regionSize);
  const patch = await sharp(imageBuffer)
    .extract({
      left: wmRegion.left,
      top: patchTop,
      width: regionSize,
      height: regionSize,
    })
    .toBuffer();

  const result = await sharp(imageBuffer)
    .composite([
      {
        input: patch,
        left: wmRegion.left,
        top: wmRegion.top,
      },
    ])
    .toBuffer();

  debug(COMPONENT, "Watermark removed");
  return result;
}

async function detectWatermark(
  imageBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
  _imgWidth: number,
  _imgHeight: number,
): Promise<boolean> {
  const wmResult = await sharp(imageBuffer)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Reference: region immediately to the LEFT of the watermark (same row)
  const refLeft = Math.max(0, region.left - region.width);
  const refResult = await sharp(imageBuffer)
    .extract({
      left: refLeft,
      top: region.top,
      width: region.width,
      height: region.height,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = wmResult.info.channels;
  const wmStats = computePixelStats(wmResult.data, channels);
  const refStats = computePixelStats(refResult.data, channels);

  debug(COMPONENT, `Watermark region - avg brightness: ${wmStats.avgBrightness.toFixed(1)}, variance: ${wmStats.variance.toFixed(1)}`);
  debug(COMPONENT, `Reference region - avg brightness: ${refStats.avgBrightness.toFixed(1)}, variance: ${refStats.variance.toFixed(1)}`);

  const brightnessDiff = Math.abs(wmStats.avgBrightness - refStats.avgBrightness);
  const varianceDiff = Math.abs(wmStats.variance - refStats.variance);

  debug(COMPONENT, `Brightness diff: ${brightnessDiff.toFixed(1)}, variance diff: ${varianceDiff.toFixed(1)}`);

  // The sparkle watermark adds bright semi-transparent pixels that create
  // a brightness or variance anomaly compared to the neighboring region
  return brightnessDiff > 3 || varianceDiff > 500;
}

function computePixelStats(pixels: Buffer, channels: number): { avgBrightness: number; variance: number } {
  const pixelCount = pixels.length / channels;
  let sum = 0;
  const values: number[] = [];

  for (let i = 0; i < pixels.length; i += channels) {
    const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sum += brightness;
    values.push(brightness);
  }

  const avg = sum / pixelCount;
  let varianceSum = 0;
  for (const v of values) {
    varianceSum += (v - avg) ** 2;
  }

  return {
    avgBrightness: avg,
    variance: varianceSum / pixelCount,
  };
}
