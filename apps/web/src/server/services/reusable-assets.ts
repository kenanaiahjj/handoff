import type { SnapshotAsset } from "@asbir/snapshot-contract";

type StoredReusableAsset = Pick<SnapshotAsset, "fileName" | "contentType" | "sizeBytes" | "sha256" | "width" | "height"> & {
  objectKey: string;
};

export function findReusableAsset(
  asset: SnapshotAsset,
  candidates: readonly StoredReusableAsset[],
): StoredReusableAsset | undefined {
  return candidates.find((candidate) =>
    candidate.fileName === asset.fileName &&
    candidate.contentType === asset.contentType &&
    candidate.sizeBytes === asset.sizeBytes &&
    candidate.sha256 === asset.sha256 &&
    (candidate.width ?? null) === (asset.width ?? null) &&
    (candidate.height ?? null) === (asset.height ?? null),
  );
}
