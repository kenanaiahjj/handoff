type EvidenceLinkTarget = {
  versionId: string;
  frameId: string;
  sourceNodeId: string | null;
};

export function evidenceCanvasHref(versionHrefPrefix: string, evidence: EvidenceLinkTarget) {
  const query = new URLSearchParams({ versionId: evidence.versionId });
  const hash = new URLSearchParams({ screen: evidence.frameId });
  if (evidence.sourceNodeId) hash.set("element", evidence.sourceNodeId);
  return `${versionHrefPrefix}?${query.toString()}#${hash.toString()}`;
}
