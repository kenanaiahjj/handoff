import type {
  Measurement,
  SnapshotEnvelope,
  SnapshotFrame,
  SnapshotNode,
  VisualOnlySnapshot,
} from "@asbir/snapshot-contract";
import { typographyFromTextSegments } from "@asbir/snapshot-contract";
import { formatPrecisePixelValue } from "../../lib/format-pixel-value";
import { z } from "zod";

function optionalText(maxLength: number) {
  return z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(maxLength).nullable().optional(),
  );
}

export const taskLinkFieldsSchema = z.object({
  sourceSystem: z.string().trim().min(1).max(80).optional().default("External tool"),
  externalTaskId: optionalText(500),
  externalUrl: optionalText(2000).pipe(z.string().url().nullable().optional()),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(6000).optional().default(""),
  frameId: optionalText(500),
  sourceNodeId: optionalText(500),
});

function validateTaskLinkFields(
  value: z.infer<typeof taskLinkFieldsSchema>,
  context: z.RefinementCtx,
) {
  if (!value.externalTaskId && !value.externalUrl) {
    context.addIssue({
      code: "custom",
      message: "Provide an external task ID or URL.",
      path: ["externalUrl"],
    });
  }
  if (value.externalUrl) {
    const url = new URL(value.externalUrl);
    const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "Use an HTTPS task URL without embedded credentials.",
        path: ["externalUrl"],
      });
    }
  }
  if (value.sourceNodeId && !value.frameId) {
    context.addIssue({
      code: "custom",
      message: "Choose a screen before linking an element.",
      path: ["sourceNodeId"],
    });
  }
}

export const taskLinkSchema = taskLinkFieldsSchema.superRefine(validateTaskLinkFields);
export const taskLinkRequestSchema = taskLinkFieldsSchema
  .extend({ versionId: z.string().uuid() })
  .superRefine(validateTaskLinkFields);
export type TaskLinkInput = z.infer<typeof taskLinkSchema>;

type TaskDesignElement = Pick<
  SnapshotNode,
  | "sourceNodeId"
  | "name"
  | "type"
  | "bounds"
  | "layoutBounds"
  | "layout"
  | "padding"
  | "margins"
  | "spacing"
  | "fills"
  | "strokes"
  | "styleReferences"
  | "typography"
  | "tokens"
>;

export type TaskDesignContext = {
  frame: {
    sourceFrameId: string;
    name: string;
    bounds: SnapshotFrame["bounds"] | null;
  };
  element: TaskDesignElement | null;
};

type TaskSnapshot = SnapshotEnvelope | VisualOnlySnapshot;

export class TaskDesignContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskDesignContextError";
  }
}

export function resolveTaskDesignContext(
  snapshot: TaskSnapshot,
  frameId?: string | null,
  sourceNodeId?: string | null,
): TaskDesignContext | null {
  if (!frameId) {
    if (sourceNodeId) throw new TaskDesignContextError("Choose a screen before linking an element.");
    return null;
  }

  const frame = snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId);
  if (!frame) throw new TaskDesignContextError("The selected screen is not in this snapshot version.");
  const frameBounds = "visualOnly" in snapshot
    ? null
    : snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId)?.bounds ?? null;

  const frameEvidence = {
    sourceFrameId: frame.sourceFrameId,
    name: frame.name,
    bounds: frameBounds,
  };

  if (!sourceNodeId) return { frame: frameEvidence, element: null };
  if ("visualOnly" in snapshot && snapshot.visualOnly) {
    throw new TaskDesignContextError("This visual-only screen has no captured element data.");
  }

  const structuredSnapshot = snapshot as SnapshotEnvelope;
  const node = structuredSnapshot.frames
    .find((candidate) => candidate.sourceFrameId === frameId)
    ?.nodes.find((candidate) => candidate.sourceNodeId === sourceNodeId);
  if (!node) throw new TaskDesignContextError("The selected element is not on this screen in the snapshot version.");

  return {
    frame: frameEvidence,
    element: {
      sourceNodeId: node.sourceNodeId,
      name: node.name,
      type: node.type,
      bounds: node.bounds,
      ...(node.layoutBounds ? { layoutBounds: node.layoutBounds } : {}),
      layout: node.layout,
      padding: node.padding,
      margins: node.margins,
      spacing: node.spacing,
      fills: node.fills,
      strokes: node.strokes,
      styleReferences: node.styleReferences,
      typography: typographyFromTextSegments(node.typography, node.sourcePayload),
      tokens: node.tokens,
    },
  };
}

export function taskCanvasHref(handoffUrl: string | null, context: TaskDesignContext | null) {
  if (!handoffUrl || !context) return handoffUrl;
  const url = new URL(handoffUrl);
  const fragment = new URLSearchParams({ screen: context.frame.sourceFrameId });
  if (context.element) fragment.set("element", context.element.sourceNodeId);
  url.hash = fragment.toString();
  return url.toString();
}

function formatMeasurement(measurement: Measurement | null | undefined) {
  if (!measurement || measurement.value === null) return "unavailable";
  const value = measurement.unit === "px" ? formatPrecisePixelValue(measurement.value) : String(measurement.value);
  return `${value} ${measurement.unit}`;
}

function formatSides(sides: SnapshotNode["padding"]) {
  return [
    `top ${formatMeasurement(sides.top)}`,
    `right ${formatMeasurement(sides.right)}`,
    `bottom ${formatMeasurement(sides.bottom)}`,
    `left ${formatMeasurement(sides.left)}`,
  ].join(", ");
}

function tokenValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function formatTaskDesignContext(
  context: TaskDesignContext | null,
  canvasUrl: string | null = null,
) {
  if (!context) return "";

  const lines = [
    "Design reference:",
    `Screen: ${context.frame.name} (frame ID: ${context.frame.sourceFrameId})`,
  ];
  if (canvasUrl) lines.push(`Canvas: ${canvasUrl}`);
  if (!context.element) return lines.join("\n");

  const element = context.element;
  lines.push(`Element: ${element.name || element.type} (${element.type}; node ID: ${element.sourceNodeId})`);
  if (element.layoutBounds) {
    lines.push(
      `Figma node geometry (x/y relative to parent): x ${formatMeasurement(element.layoutBounds.x)}, y ${formatMeasurement(element.layoutBounds.y)}, width ${formatMeasurement(element.layoutBounds.width)}, height ${formatMeasurement(element.layoutBounds.height)}`,
      `Canvas bounds: x ${formatMeasurement(element.bounds.x)}, y ${formatMeasurement(element.bounds.y)}, width ${formatMeasurement(element.bounds.width)}, height ${formatMeasurement(element.bounds.height)}`,
    );
  } else {
    lines.push(`Bounds: x ${formatMeasurement(element.bounds.x)}, y ${formatMeasurement(element.bounds.y)}, width ${formatMeasurement(element.bounds.width)}, height ${formatMeasurement(element.bounds.height)}`);
  }
  lines.push(
    `Padding: ${formatSides(element.padding)}`,
    `Margins: ${formatSides(element.margins)}`,
    `Spacing: row ${formatMeasurement(element.spacing.rowGap)}, column ${formatMeasurement(element.spacing.columnGap)}, item ${formatMeasurement(element.spacing.itemGap)}`,
  );

  const fillColors = element.fills.map((paint) => paint.color).filter((color): color is string => Boolean(color));
  const strokeColors = element.strokes.map((paint) => paint.color).filter((color): color is string => Boolean(color));
  if (fillColors.length) lines.push(`Fill colors: ${[...new Set(fillColors)].join(", ")}`);
  if (strokeColors.length) lines.push(`Stroke colors: ${[...new Set(strokeColors)].join(", ")}`);

  const typography = element.typography;
  if (typography) {
    const typeDetails = [
      typography.fontFamily,
      typography.fontSize.value === null ? null : `size ${formatMeasurement(typography.fontSize)}`,
      typography.fontWeight === null ? null : `weight ${typography.fontWeight}`,
      typography.lineHeight.value === null ? null : `line height ${formatMeasurement(typography.lineHeight)}`,
      typography.letterSpacing.value === null ? null : `letter spacing ${formatMeasurement(typography.letterSpacing)}`,
    ].filter(Boolean);
    if (typeDetails.length) lines.push(`Typography: ${typeDetails.join(", ")}`);
  }

  if (element.styleReferences.length) {
    lines.push(`Styles: ${element.styleReferences.map((style) => style.name ?? style.sourceStyleId).join(", ")}`);
  }
  if (element.tokens.length) {
    lines.push(`Tokens: ${element.tokens.map((token) => `${token.name} = ${tokenValue(token.value)}`).join(", ")}`);
  }
  return lines.join("\n");
}
