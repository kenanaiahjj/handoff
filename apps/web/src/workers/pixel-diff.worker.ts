import { compareRgbaPixels, getPixelDiffImageRect, getPixelDiffPlan } from "./pixel-diff";

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
  const plan = getPixelDiffPlan(
    data.beforeSourceWidth,
    data.beforeSourceHeight,
    data.afterSourceWidth,
    data.afterSourceHeight,
  );
  if (plan.status !== "ready") {
    data.before.close();
    data.after.close();
    workerScope.postMessage({
      error: plan.status === "too-large"
        ? "Pixel diff is unavailable for screens this large. Use side-by-side or overlay to compare them at full size."
        : "The captured screen dimensions are invalid. Use side-by-side or overlay to compare these screens.",
    });
    return;
  }

  const { width, height } = plan;
  const beforeRect = getPixelDiffImageRect(data.beforeSourceWidth, data.beforeSourceHeight);
  const afterRect = getPixelDiffImageRect(data.afterSourceWidth, data.afterSourceHeight);
  if (!beforeRect || !afterRect) {
    data.before.close();
    data.after.close();
    workerScope.postMessage({ error: "The captured screen dimensions are invalid. Use side-by-side or overlay to compare these screens." });
    return;
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    data.before.close();
    data.after.close();
    workerScope.postMessage({ error: "The browser could not prepare the pixel comparison." });
    return;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(data.before, beforeRect.x, beforeRect.y, beforeRect.width, beforeRect.height);
  const beforePixels = context.getImageData(0, 0, width, height).data;
  context.clearRect(0, 0, width, height);
  context.drawImage(data.after, afterRect.x, afterRect.y, afterRect.width, afterRect.height);
  const afterPixels = context.getImageData(0, 0, width, height).data;
  const { pixels, changedPixels } = compareRgbaPixels(beforePixels, afterPixels);

  data.before.close();
  data.after.close();
  workerScope.postMessage(
    { width, height, pixels: pixels.buffer, changedPixels },
    [pixels.buffer],
  );
};
