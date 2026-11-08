import { compareRgbaPixels } from "./pixel-diff";

type PixelDiffMessage = {
  before: ImageBitmap;
  after: ImageBitmap;
  beforeSourceWidth: number;
  beforeSourceHeight: number;
  afterSourceWidth: number;
  afterSourceHeight: number;
};

type PixelDiffWorkerScope = {
  onmessage: ((event: MessageEvent<PixelDiffMessage>) => void | Promise<void>) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const workerScope = self as unknown as PixelDiffWorkerScope;

workerScope.onmessage = async ({ data }) => {
  const width = Math.max(1, Math.ceil(Math.max(data.beforeSourceWidth, data.afterSourceWidth) * 2));
  const height = Math.max(1, Math.ceil(Math.max(data.beforeSourceHeight, data.afterSourceHeight) * 2));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    data.before.close();
    data.after.close();
    workerScope.postMessage({ error: "The browser could not prepare the pixel comparison." });
    return;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(data.before, 0, 0, Math.ceil(data.beforeSourceWidth * 2), Math.ceil(data.beforeSourceHeight * 2));
  const beforePixels = context.getImageData(0, 0, width, height).data;
  context.clearRect(0, 0, width, height);
  context.drawImage(data.after, 0, 0, Math.ceil(data.afterSourceWidth * 2), Math.ceil(data.afterSourceHeight * 2));
  const afterPixels = context.getImageData(0, 0, width, height).data;
  const { pixels, changedPixels } = compareRgbaPixels(beforePixels, afterPixels);

  data.before.close();
  data.after.close();
  workerScope.postMessage(
    { width, height, pixels: pixels.buffer, changedPixels },
    [pixels.buffer],
  );
};
