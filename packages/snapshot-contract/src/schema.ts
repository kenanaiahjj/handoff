import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);
const finiteNumberSchema = z.number().finite();
const jsonValueSchema = z.json();
const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

export const snapshotSourceSchema = z.enum(["figma", "paper", "bundle"]);
export const measurementProvenanceSchema = z.enum([
  "source",
  "measured",
  "unavailable",
]);

export const measurementSchema = z
  .object({
    value: finiteNumberSchema.nullable(),
    unit: nonEmptyStringSchema,
    provenance: measurementProvenanceSchema,
    sourceProperty: nonEmptyStringSchema.nullable(),
  })
  .superRefine((measurement, context) => {
    const hasValue = measurement.value !== null;
    const isUnavailable = measurement.provenance === "unavailable";

    if (hasValue === isUnavailable) {
      context.addIssue({
        code: "custom",
        message:
          "Unavailable measurements must have a null value; source and measured values must be numeric.",
        path: ["value"],
      });
    }
  });

export const boundsSchema = z
  .object({
    x: measurementSchema,
    y: measurementSchema,
    width: measurementSchema,
    height: measurementSchema,
  })
  .superRefine((bounds, context) => {
    for (const key of ["width", "height"] as const) {
      const measurement = bounds[key];
      if (measurement.value !== null && measurement.value < 0) {
        context.addIssue({
          code: "custom",
          message: `${key} cannot be negative.`,
          path: [key, "value"],
        });
      }
    }
  });

const fourSidedMeasurementsSchema = z.object({
  top: measurementSchema,
  right: measurementSchema,
  bottom: measurementSchema,
  left: measurementSchema,
});

const spacingSchema = z.object({
  rowGap: measurementSchema,
  columnGap: measurementSchema,
  itemGap: measurementSchema,
});

const layoutSchema = z.object({
  mode: z.string().nullable(),
  direction: z.string().nullable(),
  primaryAxisAlign: z.string().nullable(),
  counterAxisAlign: z.string().nullable(),
  wrap: z.boolean().nullable(),
  constraints: jsonRecordSchema,
});

const paintSchema = z.object({
  color: z.string().nullable(),
  opacity: measurementSchema,
  sourceStyleId: z.string().nullable(),
});

const styleReferenceSchema = z.object({
  kind: nonEmptyStringSchema,
  sourceStyleId: nonEmptyStringSchema,
  name: z.string().nullable(),
});

const tokenBindingSchema = z.object({
  sourceId: nonEmptyStringSchema,
  bindingPath: nonEmptyStringSchema.optional(),
  category: z.enum(["color", "typography", "spacing", "effect", "other"]).optional(),
  name: nonEmptyStringSchema,
  collectionId: z.string().nullable(),
  collectionName: z.string().nullable(),
  mode: z.string().nullable(),
  value: jsonValueSchema,
});

const typographySchema = z.object({
  fontFamily: z.string().nullable(),
  fontSize: measurementSchema,
  fontWeight: z.union([z.string(), finiteNumberSchema]).nullable(),
  lineHeight: measurementSchema,
  letterSpacing: measurementSchema,
  textAlign: z.string().nullable(),
  content: z.string().nullable(),
});

export const snapshotNodeSchema = z.object({
  sourceNodeId: nonEmptyStringSchema,
  parentSourceNodeId: z.string().nullable(),
  sourceFrameId: nonEmptyStringSchema,
  name: z.string(),
  type: nonEmptyStringSchema,
  visible: z.boolean(),
  // Figma's native x/y/width/height values; bounds remains screen-space geometry for canvas overlays.
  layoutBounds: boundsSchema.optional(),
  bounds: boundsSchema,
  layout: layoutSchema,
  padding: fourSidedMeasurementsSchema,
  margins: fourSidedMeasurementsSchema,
  spacing: spacingSchema,
  fills: z.array(paintSchema),
  strokes: z.array(paintSchema),
  styleReferences: z.array(styleReferenceSchema),
  typography: typographySchema.nullable(),
  tokens: z.array(tokenBindingSchema),
  sourcePayload: jsonRecordSchema,
});

export const snapshotFrameSchema = z.object({
  sourceFrameId: nonEmptyStringSchema,
  sourcePageId: z.string().nullable(),
  name: z.string(),
  bounds: boundsSchema,
  renderBounds: boundsSchema.optional(),
  renderAssetKey: nonEmptyStringSchema,
  vectorAssetKey: nonEmptyStringSchema.optional(),
  nodes: z.array(snapshotNodeSchema),
});

export const snapshotAssetSchema = z.object({
  key: nonEmptyStringSchema,
  fileName: nonEmptyStringSchema,
  contentType: nonEmptyStringSchema,
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

const snapshotPayloadObjectSchema = z.object({
  schemaVersion: z.literal(1),
  source: snapshotSourceSchema,
  sourceFileId: nonEmptyStringSchema,
  sourceRevisionId: z.string().nullable(),
  sourceFileName: z.string().nullable(),
  capturedAt: z.iso.datetime(),
  overviewAssetKey: nonEmptyStringSchema,
  canvasBounds: boundsSchema.optional(),
  frames: z.array(snapshotFrameSchema).min(1),
  assets: z.array(snapshotAssetSchema).min(1),
  sourceMetadata: jsonRecordSchema,
});

function addReferenceIssues(
  snapshot: z.infer<typeof snapshotPayloadObjectSchema>,
  context: z.RefinementCtx,
) {
  const assetKeys = new Set<string>();
  snapshot.assets.forEach((asset, index) => {
    if (assetKeys.has(asset.key)) {
      context.addIssue({
        code: "custom",
        message: `Asset key "${asset.key}" is duplicated.`,
        path: ["assets", index, "key"],
      });
    }
    assetKeys.add(asset.key);
  });

  if (!assetKeys.has(snapshot.overviewAssetKey)) {
    context.addIssue({
      code: "custom",
      message: "The overview asset key must refer to an asset in the snapshot.",
      path: ["overviewAssetKey"],
    });
  }

  const frameIds = new Set<string>();
  snapshot.frames.forEach((frame, frameIndex) => {
    if (frameIds.has(frame.sourceFrameId)) {
      context.addIssue({
        code: "custom",
        message: `Frame ID "${frame.sourceFrameId}" is duplicated.`,
        path: ["frames", frameIndex, "sourceFrameId"],
      });
    }
    frameIds.add(frame.sourceFrameId);

    if (!assetKeys.has(frame.renderAssetKey)) {
      context.addIssue({
        code: "custom",
        message: `Render asset "${frame.renderAssetKey}" is missing from the snapshot assets.`,
        path: ["frames", frameIndex, "renderAssetKey"],
      });
    }
    if (frame.vectorAssetKey && !assetKeys.has(frame.vectorAssetKey)) {
      context.addIssue({
        code: "custom",
        message: `Vector source asset "${frame.vectorAssetKey}" is missing from the snapshot assets.`,
        path: ["frames", frameIndex, "vectorAssetKey"],
      });
    }

    const nodeIds = new Set<string>();
    frame.nodes.forEach((node, nodeIndex) => {
      if (nodeIds.has(node.sourceNodeId)) {
        context.addIssue({
          code: "custom",
          message: `Node ID "${node.sourceNodeId}" is duplicated in frame "${frame.sourceFrameId}".`,
          path: ["frames", frameIndex, "nodes", nodeIndex, "sourceNodeId"],
        });
      }
      nodeIds.add(node.sourceNodeId);

      if (node.sourceFrameId !== frame.sourceFrameId) {
        context.addIssue({
          code: "custom",
          message: "A node must reference the frame that contains it.",
          path: ["frames", frameIndex, "nodes", nodeIndex, "sourceFrameId"],
        });
      }
    });
  });
}

export const snapshotPayloadSchema = snapshotPayloadObjectSchema.superRefine(
  addReferenceIssues,
);

export const snapshotEnvelopeSchema = snapshotPayloadObjectSchema
  .extend({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine(addReferenceIssues);

export const visualOnlySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.literal("bundle"),
    sourceFileId: nonEmptyStringSchema,
    sourceRevisionId: z.string().nullable(),
    sourceFileName: z.string().nullable(),
    capturedAt: z.iso.datetime(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    visualOnly: z.literal(true),
    overviewAssetKey: nonEmptyStringSchema,
    frames: z
      .array(
        z.object({
          sourceFrameId: nonEmptyStringSchema,
          name: nonEmptyStringSchema,
          renderAssetKey: nonEmptyStringSchema,
        }),
      )
      .min(1),
    assets: z.array(snapshotAssetSchema).min(1),
    sourceMetadata: jsonRecordSchema,
  })
  .superRefine((snapshot, context) => {
    const assetKeys = new Set<string>();
    snapshot.assets.forEach((asset, index) => {
      if (assetKeys.has(asset.key)) {
        context.addIssue({
          code: "custom",
          message: `Asset key "${asset.key}" is duplicated.`,
          path: ["assets", index, "key"],
        });
      }
      assetKeys.add(asset.key);
    });

    if (!assetKeys.has(snapshot.overviewAssetKey)) {
      context.addIssue({
        code: "custom",
        message: "The overview asset key must refer to an asset in the snapshot.",
        path: ["overviewAssetKey"],
      });
    }

    const frameIds = new Set<string>();
    snapshot.frames.forEach((frame, index) => {
      if (frameIds.has(frame.sourceFrameId)) {
        context.addIssue({
          code: "custom",
          message: `Frame ID "${frame.sourceFrameId}" is duplicated.`,
          path: ["frames", index, "sourceFrameId"],
        });
      }
      frameIds.add(frame.sourceFrameId);

      if (!assetKeys.has(frame.renderAssetKey)) {
        context.addIssue({
          code: "custom",
          message: `Render asset "${frame.renderAssetKey}" is missing from the snapshot assets.`,
          path: ["frames", index, "renderAssetKey"],
        });
      }
    });
  });

export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;
export type MeasurementProvenance = z.infer<
  typeof measurementProvenanceSchema
>;
export type Measurement = z.infer<typeof measurementSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type SnapshotNode = z.infer<typeof snapshotNodeSchema>;
export type SnapshotFrame = z.infer<typeof snapshotFrameSchema>;
export type SnapshotAsset = z.infer<typeof snapshotAssetSchema>;
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;
export type SnapshotEnvelope = z.infer<typeof snapshotEnvelopeSchema>;
export type VisualOnlySnapshot = z.infer<typeof visualOnlySnapshotSchema>;
