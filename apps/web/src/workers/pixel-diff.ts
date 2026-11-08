export function compareRgbaPixels(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
): { pixels: Uint8ClampedArray; changedPixels: number } {
  if (before.length !== after.length || before.length % 4 !== 0) {
    throw new RangeError("Before and after images must have the same number of RGBA values.");
  }

  const pixels = new Uint8ClampedArray(before.length);
  let changedPixels = 0;

  for (let offset = 0; offset < before.length; offset += 4) {
    const difference = Math.max(
      Math.abs(before[offset] - after[offset]),
      Math.abs(before[offset + 1] - after[offset + 1]),
      Math.abs(before[offset + 2] - after[offset + 2]),
      Math.abs(before[offset + 3] - after[offset + 3]),
    );
    if (difference === 0) continue;

    pixels[offset] = 255;
    pixels[offset + 1] = 75;
    pixels[offset + 2] = 125;
    pixels[offset + 3] = Math.min(245, 70 + difference);
    changedPixels += 1;
  }

  return { pixels, changedPixels };
}
