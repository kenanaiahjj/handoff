export type ConfirmedNodeReplacement = {
  baselineVersionId: string;
  newVersionId: string;
  beforeFrameId: string;
  afterFrameId: string;
  beforeNodeId: string;
  afterNodeId: string;
};

export type NodeMatch = {
  beforeFrameId: string;
  afterFrameId: string;
  beforeNodeId: string;
  afterNodeId: string;
};

export function resolveNodeReplacementMatches(input: {
  versionIds: string[];
  fromVersionId: string;
  toVersionId: string;
  replacements: ConfirmedNodeReplacement[];
}): NodeMatch[] {
  const fromIndex = input.versionIds.indexOf(input.fromVersionId);
  const toIndex = input.versionIds.indexOf(input.toVersionId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];

  const baselineVersionId = input.versionIds[Math.min(fromIndex, toIndex)];
  const newVersionId = input.versionIds[Math.max(fromIndex, toIndex)];
  const directMatches = input.replacements.filter((replacement) =>
    replacement.baselineVersionId === baselineVersionId && replacement.newVersionId === newVersionId,
  );

  return directMatches.map((replacement) => fromIndex < toIndex
    ? {
        beforeFrameId: replacement.beforeFrameId,
        afterFrameId: replacement.afterFrameId,
        beforeNodeId: replacement.beforeNodeId,
        afterNodeId: replacement.afterNodeId,
      }
    : {
        beforeFrameId: replacement.afterFrameId,
        afterFrameId: replacement.beforeFrameId,
        beforeNodeId: replacement.afterNodeId,
        afterNodeId: replacement.beforeNodeId,
      });
}
