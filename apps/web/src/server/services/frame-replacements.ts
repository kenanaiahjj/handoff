export type ConfirmedFrameReplacement = {
  baselineVersionId: string;
  newVersionId: string;
  beforeFrameId: string;
  afterFrameId: string;
};

export type FrameMatch = {
  beforeFrameId: string;
  afterFrameId: string;
};

export function resolveFrameReplacementMatches(input: {
  versionIds: string[];
  fromVersionId: string;
  toVersionId: string;
  fromFrameIds: string[];
  toFrameIds: string[];
  fromSourceFileId: string;
  toSourceFileId: string;
  replacements: ConfirmedFrameReplacement[];
}): FrameMatch[] {
  const fromIndex = input.versionIds.indexOf(input.fromVersionId);
  const toIndex = input.versionIds.indexOf(input.toVersionId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];

  const fromFrameIdSet = new Set(input.fromFrameIds);
  const currentFrameIds = new Map(input.fromFrameIds.map((frameId) => [frameId, frameId]));

  if (fromIndex < toIndex) {
    for (let index = fromIndex + 1; index <= toIndex; index += 1) {
      const baselineVersionId = input.versionIds[index - 1];
      const newVersionId = input.versionIds[index];
      for (const replacement of input.replacements) {
        if (replacement.baselineVersionId !== baselineVersionId || replacement.newVersionId !== newVersionId) continue;
        for (const [originalId, currentId] of currentFrameIds) {
          if (currentId === replacement.beforeFrameId) currentFrameIds.set(originalId, replacement.afterFrameId);
        }
      }
    }
  } else {
    for (let index = fromIndex; index > toIndex; index -= 1) {
      const baselineVersionId = input.versionIds[index - 1];
      const newVersionId = input.versionIds[index];
      for (const replacement of input.replacements) {
        if (replacement.baselineVersionId !== baselineVersionId || replacement.newVersionId !== newVersionId) continue;
        for (const [originalId, currentId] of currentFrameIds) {
          if (currentId === replacement.afterFrameId) currentFrameIds.set(originalId, replacement.beforeFrameId);
        }
      }
    }
  }

  const baselineVersionId = input.versionIds[Math.min(fromIndex, toIndex)];
  const newVersionId = input.versionIds[Math.max(fromIndex, toIndex)];
  const directMatches = input.replacements.filter(
    (replacement) => replacement.baselineVersionId === baselineVersionId && replacement.newVersionId === newVersionId,
  );
  if (fromIndex < toIndex) {
    for (const replacement of directMatches) {
      if (fromFrameIdSet.has(replacement.beforeFrameId)) {
        currentFrameIds.set(replacement.beforeFrameId, replacement.afterFrameId);
      }
    }
  } else {
    for (const replacement of directMatches) {
      if (fromFrameIdSet.has(replacement.afterFrameId)) {
        currentFrameIds.set(replacement.afterFrameId, replacement.beforeFrameId);
      }
    }
  }

  const targetFrameIds = new Set(input.toFrameIds);
  const sourceFilesDiffer = input.fromSourceFileId !== input.toSourceFileId;
  return [...currentFrameIds].flatMap(([beforeFrameId, afterFrameId]) =>
    (afterFrameId !== beforeFrameId || sourceFilesDiffer) && targetFrameIds.has(afterFrameId)
      ? [{ beforeFrameId, afterFrameId }]
      : [],
  );
}
