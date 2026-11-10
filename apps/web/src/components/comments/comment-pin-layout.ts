import { canvasAnchorToViewportPoint, type CanvasAnchorFrame } from "../canvas/canvas-anchor";

type CommentPinInput = {
  id: string;
  frameId: string;
  sourceNodeId: string | null;
  parentCommentId: string | null;
  x: number | null;
  y: number | null;
  resolvedAt: string | null;
};

type ScreenFramePosition = CanvasAnchorFrame;
type LegacyScreenPosition = { id: string; sourceX: number; sourceY: number };

type CanvasFramePosition = CanvasAnchorFrame;
type LegacyFrameOrigin = { sourceX: number; sourceY: number };

export function layoutCommentPins<Comment extends CommentPinInput>(
  comments: readonly Comment[],
  screens: readonly (ScreenFramePosition | LegacyScreenPosition)[],
  frame: CanvasFramePosition | LegacyFrameOrigin,
  showResolvedPins: boolean,
  overviewOrigin?: { sourceX: number; sourceY: number },
) {
  const positionedComments = comments.filter((comment) =>
    comment.parentCommentId === null && comment.x !== null && comment.y !== null && (showResolvedPins || !comment.resolvedAt),
  );

  return positionedComments.flatMap((comment, index) => {
    const x = comment.x;
    const y = comment.y;
    if (x === null || y === null) return [];
    const anchor = {
      frameId: comment.frameId,
      sourceNodeId: comment.sourceNodeId,
      x,
      y,
    };
    const position = overviewOrigin && "kind" in frame
      ? canvasAnchorToViewportPoint(anchor, frame, screens as readonly ScreenFramePosition[], overviewOrigin)
      : (() => {
          const screen = screens.find((candidate) => candidate.id === comment.frameId);
          return screen
            ? { x: screen.sourceX + x - frame.sourceX, y: screen.sourceY + y - frame.sourceY }
            : null;
        })();
    if (!position) return [];
    return [{
      comment: {
        ...comment,
        x: position.x,
        y: position.y,
      },
      index,
    }];
  });
}
