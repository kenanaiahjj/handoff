type CanvasImageRenderPlanInput = {
  kind: "overview" | "frame";
  exact: boolean;
  changedOnly: boolean;
  frameVisible: boolean;
  hasScreenFrames: boolean;
  zoomScale: number;
  overviewResolutionScale: number;
};

export function getCanvasImageRenderPlan({
  kind,
  exact,
  changedOnly,
  frameVisible,
  hasScreenFrames,
  zoomScale,
  overviewResolutionScale,
}: CanvasImageRenderPlanInput) {
  if (kind === "frame") {
    return {
      showBaseImage: !changedOnly || frameVisible,
      showFrameImages: false,
    };
  }

  const canRenderFrameImages = exact && hasScreenFrames;
  return {
    showBaseImage: !changedOnly,
    showFrameImages: canRenderFrameImages && (changedOnly || zoomScale > overviewResolutionScale),
  };
}
