export function availableOverviewBudget(
  assets: readonly { bytes: Uint8Array }[],
  maxUploadBytes: number,
) {
  const assetBytes = assets.reduce((total, asset) => total + asset.bytes.byteLength, 0);
  return maxUploadBytes - assetBytes;
}
