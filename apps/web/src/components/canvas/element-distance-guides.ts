export type ElementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GuideSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ElementDistanceGuide = {
  axis: "horizontal" | "vertical";
  distance: number;
  segment: GuideSegment;
  extensions: GuideSegment[];
  labelX: number;
  labelY: number;
};

function isValidRect(rect: ElementRect) {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) && Number.isFinite(rect.y + rect.height);
}

function center(start: number, size: number) {
  return start + size / 2;
}

function midpoint(first: number, second: number) {
  return first / 2 + second / 2;
}

export function getElementDistanceGuides(first: ElementRect, second: ElementRect): ElementDistanceGuide[] {
  if (!isValidRect(first) || !isValidRect(second)) return [];

  const firstRight = first.x + first.width;
  const secondRight = second.x + second.width;
  const firstBottom = first.y + first.height;
  const secondBottom = second.y + second.height;
  const guides: ElementDistanceGuide[] = [];

  const firstIsLeft = firstRight < second.x;
  const secondIsLeft = secondRight < first.x;
  if (firstIsLeft || secondIsLeft) {
    const x1 = firstIsLeft ? firstRight : secondRight;
    const x2 = firstIsLeft ? second.x : first.x;
    const firstEdgeX = firstIsLeft ? x1 : x2;
    const secondEdgeX = firstIsLeft ? x2 : x1;
    const horizontalGap = x2 - x1;
    const overlapStart = Math.max(first.y, second.y);
    const overlapEnd = Math.min(firstBottom, secondBottom);
    const hasVerticalOverlap = overlapEnd > overlapStart;
    const lineY = hasVerticalOverlap
      ? midpoint(overlapStart, overlapEnd)
      : midpoint(center(first.y, first.height), center(second.y, second.height));

    if (Number.isFinite(horizontalGap) && horizontalGap > 0) {
      guides.push({
        axis: "horizontal",
        distance: horizontalGap,
        segment: { x1, y1: lineY, x2, y2: lineY },
        extensions: hasVerticalOverlap ? [] : [
          { x1: firstEdgeX, y1: center(first.y, first.height), x2: firstEdgeX, y2: lineY },
          { x1: secondEdgeX, y1: center(second.y, second.height), x2: secondEdgeX, y2: lineY },
        ],
        labelX: midpoint(x1, x2),
        labelY: lineY - 7,
      });
    }
  }

  const firstIsAbove = firstBottom < second.y;
  const secondIsAbove = secondBottom < first.y;
  if (firstIsAbove || secondIsAbove) {
    const y1 = firstIsAbove ? firstBottom : secondBottom;
    const y2 = firstIsAbove ? second.y : first.y;
    const firstEdgeY = firstIsAbove ? y1 : y2;
    const secondEdgeY = firstIsAbove ? y2 : y1;
    const verticalGap = y2 - y1;
    const overlapStart = Math.max(first.x, second.x);
    const overlapEnd = Math.min(firstRight, secondRight);
    const hasHorizontalOverlap = overlapEnd > overlapStart;
    const lineX = hasHorizontalOverlap
      ? midpoint(overlapStart, overlapEnd)
      : midpoint(center(first.x, first.width), center(second.x, second.width));

    if (Number.isFinite(verticalGap) && verticalGap > 0) {
      guides.push({
        axis: "vertical",
        distance: verticalGap,
        segment: { x1: lineX, y1, x2: lineX, y2 },
        extensions: hasHorizontalOverlap ? [] : [
          { x1: center(first.x, first.width), y1: firstEdgeY, x2: lineX, y2: firstEdgeY },
          { x1: center(second.x, second.width), y1: secondEdgeY, x2: lineX, y2: secondEdgeY },
        ],
        labelX: lineX + 7,
        labelY: midpoint(y1, y2),
      });
    }
  }

  return guides;
}
