export type TextRunTokenBinding = {
  sourceId: string;
  bindingPath: string | null;
  name: string;
  category: string;
  value: unknown;
  collectionName: string | null;
  mode: string | null;
};

export type TextRunFill = {
  type: string;
  color: string | null;
  opacity: number | null;
  gradientStops: Array<{ position: number | null; color: string | null; opacity: number | null }>;
};

export type TextStyleRun = {
  start: number;
  end: number;
  characters: string;
  fontFamily: string | null;
  fontStyle: string | null;
  fontSize: number | null;
  fontWeight: number | string | null;
  lineHeight: string | null;
  letterSpacing: string | null;
  textStyleId: string | null;
  fillStyleId: string | null;
  fills: TextRunFill[];
  tokens: TextRunTokenBinding[];
};

type JsonObject = Record<string, unknown>;

function recordOf(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function colorHex(value: unknown): string | null {
  if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) return value.toUpperCase();
  const color = recordOf(value);
  if (!color) return null;
  const channels = [color.r, color.g, color.b].map(numberOf);
  if (channels.some((channel) => channel === null)) return null;
  const hex = channels
    .map((channel) => Math.round(Math.min(1, Math.max(0, channel!)) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `#${hex}`;
}

function styleMeasure(value: unknown): string | null {
  const measure = recordOf(value);
  if (!measure) return null;
  const unit = stringOf(measure.unit)?.toUpperCase();
  if (unit === "AUTO") return "Auto";
  const amount = numberOf(measure.value);
  if (amount === null || !unit) return null;
  if (unit === "PIXELS") return `${amount}px`;
  if (unit === "PERCENT") return `${amount}%`;
  return `${amount} ${unit}`;
}

export function readPaintDetails(value: unknown): TextRunFill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((paintValue) => {
    const paint = recordOf(paintValue);
    if (!paint) return [];
    const type = stringOf(paint.type) ?? (typeof paint.color === "string" ? "SOLID" : "UNKNOWN");
    const color = recordOf(paint.color);
    const opacityRecord = recordOf(paint.opacity);
    const sourceOpacity = typeof paint.opacity === "number"
      ? paint.opacity
      : opacityRecord
        ? numberOf(opacityRecord.value)
        : Object.prototype.hasOwnProperty.call(paint, "opacity")
          ? null
          : 1;
    const opacity = sourceOpacity === null
      ? null
      : sourceOpacity * (type === "SOLID" ? numberOf(color?.a) ?? 1 : 1);
    const stops = Array.isArray(paint.gradientStops)
      ? paint.gradientStops.flatMap((stopValue) => {
          const stop = recordOf(stopValue);
          if (!stop) return [];
          const color = recordOf(stop.color);
          return [{
            position: numberOf(stop.position),
            color: colorHex(stop.color),
            opacity: numberOf(color?.a) ?? 1,
          }];
        })
      : [];
    return [{
      type,
      color: colorHex(paint.color),
      opacity,
      gradientStops: stops,
    }];
  });
}

function textRunFills(value: unknown): TextRunFill[] {
  return readPaintDetails(value);
}

function tokenBindingsForRun(
  tokenBindings: readonly TextRunTokenBinding[],
  start: number,
  end: number,
) {
  const prefix = `textSegments[${start}:${end}].`;
  return tokenBindings.filter((token) => token.bindingPath?.startsWith(prefix));
}

export function readTextStyleRuns(
  sourcePayload: unknown,
  tokenBindings: readonly TextRunTokenBinding[] = [],
): TextStyleRun[] {
  const segments = recordOf(sourcePayload)?.textSegments;
  if (!Array.isArray(segments)) return [];

  return segments.flatMap((segmentValue) => {
    const segment = recordOf(segmentValue);
    const start = numberOf(segment?.start);
    const end = numberOf(segment?.end);
    if (!segment || start === null || end === null || start < 0 || end <= start) return [];

    const fontName = recordOf(segment.fontName);
    const fontWeight = numberOf(segment.fontWeight);
    const rawWeight = stringOf(segment.fontWeight);
    return [{
      start,
      end,
      characters: typeof segment.characters === "string" ? segment.characters : "",
      fontFamily: stringOf(fontName?.family),
      fontStyle: stringOf(fontName?.style),
      fontSize: numberOf(segment.fontSize),
      fontWeight: fontWeight ?? rawWeight,
      lineHeight: styleMeasure(segment.lineHeight),
      letterSpacing: styleMeasure(segment.letterSpacing),
      textStyleId: stringOf(segment.textStyleId),
      fillStyleId: stringOf(segment.fillStyleId),
      fills: textRunFills(segment.fills),
      tokens: tokenBindingsForRun(tokenBindings, start, end),
    }];
  });
}
