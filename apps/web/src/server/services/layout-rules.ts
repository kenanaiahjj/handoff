import { z } from "zod";
import type { SnapshotNode } from "@asbir/snapshot-contract";
import type { VersionSnapshot } from "./diff";
import { isStructuredSnapshot } from "./diff";

export const tokenCategorySchema = z.enum(["color", "typography", "spacing"]);

export const projectRulesSchema = z.object({
  allowedSpacing: z.array(z.number().finite().nonnegative()).max(100),
  requireTokenCategories: z.array(tokenCategorySchema).max(3),
  frameBounds: z.object({
    minWidth: z.number().finite().positive().nullable(),
    maxWidth: z.number().finite().positive().nullable(),
    minHeight: z.number().finite().positive().nullable(),
    maxHeight: z.number().finite().positive().nullable(),
  }).nullable(),
}).superRefine((rules, context) => {
  if (rules.frameBounds) {
    for (const [minimum, maximum] of [["minWidth", "maxWidth"], ["minHeight", "maxHeight"]] as const) {
      const low = rules.frameBounds[minimum];
      const high = rules.frameBounds[maximum];
      if (low !== null && high !== null && low > high) {
        context.addIssue({ code: "custom", message: `${minimum} must not exceed ${maximum}.`, path: ["frameBounds", minimum] });
      }
    }
  }
});

export type ProjectRules = z.infer<typeof projectRulesSchema>;
export type FindingStatus = "open" | "resolved";

export type LayoutFinding = {
  findingKey: string;
  ruleId: string;
  frameId: string;
  frameName: string;
  sourceNodeId: string | null;
  nodeName: string | null;
  path: string;
  category: "layout" | "token" | "frame";
  actual: unknown;
  expected: unknown[];
  summary: string;
};

function keyFor(ruleId: string, frameId: string, nodeId: string | null, path: string) {
  return [ruleId, frameId, nodeId ?? "frame", path].map(encodeURIComponent).join(":");
}

function addFinding(
  findings: LayoutFinding[],
  input: Omit<LayoutFinding, "findingKey">,
) {
  findings.push({ ...input, findingKey: keyFor(input.ruleId, input.frameId, input.sourceNodeId, input.path) });
}

function nodeHasDataForTokenCategory(node: SnapshotNode, category: "color" | "typography" | "spacing") {
  if (category === "color") return [...node.fills, ...node.strokes].some((paint) => paint.color !== null);
  if (category === "typography") return node.typography !== null;
  return [
    ...Object.values(node.padding),
    ...Object.values(node.spacing),
  ].some((measurement) => measurement.value !== null);
}

export function evaluateLayoutRules(snapshot: VersionSnapshot, rules: ProjectRules) {
  const findings: LayoutFinding[] = [];
  if (!isStructuredSnapshot(snapshot)) {
    return { findings, unsupportedReason: "Layout checks need structured source attributes; this snapshot contains pixels only." };
  }

  for (const frame of snapshot.frames) {
    const frameWidth = frame.bounds.width.value;
    const frameHeight = frame.bounds.height.value;
    const bounds = rules.frameBounds;
    if (bounds) {
      for (const [dimension, actual, minimum, maximum] of [
        ["width", frameWidth, bounds.minWidth, bounds.maxWidth],
        ["height", frameHeight, bounds.minHeight, bounds.maxHeight],
      ] as const) {
        if (actual === null) continue;
        if (minimum !== null && actual < minimum) {
          addFinding(findings, {
            ruleId: `frame.minimum-${dimension}`,
            frameId: frame.sourceFrameId,
            frameName: frame.name,
            sourceNodeId: null,
            nodeName: null,
            path: `bounds.${dimension}`,
            category: "frame",
            actual: { value: actual, unit: frame.bounds[dimension].unit },
            expected: [{ min: minimum }],
            summary: `Frame ${dimension} is ${actual} ${frame.bounds[dimension].unit}; the project minimum is ${minimum}.`,
          });
        }
        if (maximum !== null && actual > maximum) {
          addFinding(findings, {
            ruleId: `frame.maximum-${dimension}`,
            frameId: frame.sourceFrameId,
            frameName: frame.name,
            sourceNodeId: null,
            nodeName: null,
            path: `bounds.${dimension}`,
            category: "frame",
            actual: { value: actual, unit: frame.bounds[dimension].unit },
            expected: [{ max: maximum }],
            summary: `Frame ${dimension} is ${actual} ${frame.bounds[dimension].unit}; the project maximum is ${maximum}.`,
          });
        }
      }
    }

    for (const node of frame.nodes) {
      if (rules.allowedSpacing.length) {
        const spacingValues = [
          ...Object.entries(node.padding).map(([property, value]) => [`padding.${property}`, value] as const),
          ...Object.entries(node.spacing).map(([property, value]) => [`spacing.${property}`, value] as const),
          ...Object.entries(node.margins).map(([property, value]) => [`margins.${property}`, value] as const),
        ];
        for (const [path, measurement] of spacingValues) {
          if (measurement.value === null) continue;
          const matches = rules.allowedSpacing.some((value) => Math.abs(value - measurement.value!) < 0.000001);
          if (matches) continue;
          addFinding(findings, {
            ruleId: "spacing.allowed-values",
            frameId: frame.sourceFrameId,
            frameName: frame.name,
            sourceNodeId: node.sourceNodeId,
            nodeName: node.name,
            path,
            category: "layout",
            actual: { value: measurement.value, unit: measurement.unit, provenance: measurement.provenance },
            expected: rules.allowedSpacing.map((value) => ({ value, unit: measurement.unit })),
            summary: `${node.name || "Unnamed element"} has ${measurement.value} ${measurement.unit} for ${path.replace(/^margins\./, "measured margin ")}; the value is outside the approved spacing scale.`,
          });
        }
      }

      for (const category of rules.requireTokenCategories) {
        if (!nodeHasDataForTokenCategory(node, category)) continue;
        const hasToken = node.tokens.some((token) => token.category === category);
        if (hasToken) continue;
        addFinding(findings, {
          ruleId: `token.required.${category}`,
          frameId: frame.sourceFrameId,
          frameName: frame.name,
          sourceNodeId: node.sourceNodeId,
          nodeName: node.name,
          path: `tokens.${category}`,
          category: "token",
          actual: null,
          expected: [category],
          summary: `${node.name || "Unnamed element"} has ${category} values without an explicit ${category} token binding.`,
        });
      }
    }
  }

  return { findings, unsupportedReason: null };
}
