// src/overlay/hitTest.ts
/**
 * Pixel-level alpha hit-testing for overlay canvas clicks.
 *
 * Used by the overlay pointerdown handler to distinguish clicks on the
 * actual dictation cell (opaque pixels) from clicks on the empty
 * transparent aquarium background.
 */

/**
 * Check if a pixel in raw RGBA image data is opaque.
 *
 * @param data  Raw RGBA pixel data (Uint8ClampedArray from getImageData).
 * @param width Width of the image data in pixels.
 * @param x     Pixel x-coordinate.
 * @param y     Pixel y-coordinate.
 * @param threshold  Minimum alpha value (0-255) to consider opaque (default 10).
 * @returns true when alpha >= threshold, false otherwise or when out of bounds.
 */
export function isOpaqueAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  threshold = 10,
): boolean {
  if (x < 0 || y < 0 || x >= width) return false;
  const idx = (y * width + x) * 4 + 3; // alpha byte offset
  if (idx >= data.length) return false;
  return data[idx] >= threshold;
}

/**
 * Check if a canvas is opaque at the given client coordinates.
 *
 * Maps client (window) coordinates to canvas pixel coordinates using
 * getBoundingClientRect and the canvas backing size, handling devicePixelRatio
 * scaling transparently.
 *
 * @param canvas    The HTMLCanvasElement to hit-test.
 * @param clientX   ClientX from the pointer event.
 * @param clientY   ClientY from the pointer event.
 * @param threshold Minimum alpha value (0-255) to consider opaque (default 10).
 * @returns true if the pixel is opaque, or safe defaults: true if canvas
 *          has zero rect size, no 2d context, or getImageData throws.
 */
export function isCanvasOpaqueAt(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  threshold = 10,
): boolean {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true; // can't measure -> don't block

  // Map client coordinate to canvas backing-pixel coordinate.
  // canvas.width/height are the backing store dimensions; rect.width/height
  // are CSS layout dimensions. This naturally handles devicePixelRatio scaling.
  const px = Math.floor(
    ((clientX - rect.left) / rect.width) * canvas.width,
  );
  const py = Math.floor(
    ((clientY - rect.top) / rect.height) * canvas.height,
  );

  const ctx = canvas.getContext("2d");
  if (!ctx) return true; // can't read -> don't block

  try {
    const d = ctx.getImageData(px, py, 1, 1).data;
    return isOpaqueAt(d, 1, 0, 0, threshold);
  } catch {
    return true; // never block dictation due to a read failure
  }
}
