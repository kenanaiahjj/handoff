import type { SnapshotNode } from "@asbir/snapshot-contract";

/**
 * CSS for one layer, built only from values Figma itself stores (auto layout, padding, radius, paints,
 * text styles, effects). Sizes Figma measured from geometry are left out, so every line can be typed
 * into code as is. Colour tokens bound to a paint are named in a comment.
 */
export type CssDeclaration = { property: string; value: string; comment?: string };

type Measurement = SnapshotNode["bounds"]["x"];

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function px(value: number) {
  return value === 0 ? "0" : `${round(value)}px`;
}

function sourceValue(measurement: Measurement | undefined) {
  return measurement && measurement.provenance === "source" ? measurement.value : null;
}

function withAlpha(color: string, alpha: number) {
  if (alpha >= 0.999) return color;
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const channels = [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16));
  return `rgba(${channels.join(", ")}, ${round(alpha)})`;
}

function rgba(color: unknown) {
  if (typeof color !== "object" || color === null) return null;
  const { r, g, b, a } = color as Record<string, unknown>;
  if (num(r) === null || num(g) === null || num(b) === null) return null;
  const channels = [r, g, b].map((channel) => Math.round((channel as number) * 255));
  const alpha = num(a) ?? 1;
  return alpha >= 0.999
    ? `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`
    : `rgba(${channels.join(", ")}, ${round(alpha)})`;
}

function colorTokenFor(node: SnapshotNode, kind: "fills" | "strokes") {
  return node.tokens.find((token) => token.category === "color" && (token.bindingPath ?? "").toLowerCase().startsWith(kind))?.name;
}

const justify: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
const align: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline", STRETCH: "stretch" };
const textAlign: Record<string, string> = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };

export function cssDeclarationsForNode(node: SnapshotNode): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  const payload = node.sourcePayload;
  const isText = node.type === "TEXT";
  const sizeBounds = node.layoutBounds ?? node.bounds;

  // Size: fixed sizes only. Fill and hug follow the parent or the content, as in Figma.
  for (const [axis, property] of [["Horizontal", "width"], ["Vertical", "height"]] as const) {
    const sizing = payload[`layoutSizing${axis}`];
    if (sizing === "FILL") out.push(property === "width" ? { property: "width", value: "100%" } : { property: "align-self", value: "stretch" });
    else if (sizing === "HUG") continue;
    else {
      const value = sourceValue(sizeBounds[property]);
      if (value !== null && !(isText && property === "height")) out.push({ property, value: px(value) });
    }
  }

  // Auto layout.
  const mode = node.layout.mode;
  if (mode === "HORIZONTAL" || mode === "VERTICAL") {
    out.push({ property: "display", value: "flex" });
    out.push({ property: "flex-direction", value: mode === "HORIZONTAL" ? "row" : "column" });
    if (node.layout.wrap) out.push({ property: "flex-wrap", value: "wrap" });
    const main = node.layout.primaryAxisAlign ? justify[node.layout.primaryAxisAlign] : undefined;
    const cross = node.layout.counterAxisAlign ? align[node.layout.counterAxisAlign] : undefined;
    if (main && main !== "flex-start") out.push({ property: "justify-content", value: main });
    if (cross && cross !== "flex-start") out.push({ property: "align-items", value: cross });
    const gap = main === "space-between" ? null : sourceValue(node.spacing.itemGap);
    if (gap) out.push({ property: "gap", value: px(gap) });
  }
  const sides = (["top", "right", "bottom", "left"] as const).map((side) => sourceValue(node.padding[side]));
  if (sides.some((value) => value)) {
    const [top, right, bottom, left] = sides.map((value) => value ?? 0);
    out.push({
      property: "padding",
      value: top === bottom && right === left ? (top === right ? px(top) : `${px(top)} ${px(right)}`) : `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`,
    });
  }
  const grow = num(payload.layoutGrow);
  if (grow) out.push({ property: "flex", value: `${grow} 1 0` });

  // Corners.
  const uniform = num(payload.cornerRadius);
  const corners = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"].map((key) => num(payload[key]) ?? uniform ?? 0);
  if (corners.some((value) => value > 0)) {
    out.push({ property: "border-radius", value: corners.every((value) => value === corners[0]) ? px(corners[0]) : corners.map(px).join(" ") });
  }

  // Paints. Figma lists paints bottom to top, so the last one with a colour is what shows.
  const fill = [...node.fills].reverse().find((paint) => paint.color);
  if (fill?.color) {
    const color = withAlpha(fill.color, sourceValue(fill.opacity) ?? 1);
    const extra = node.fills.filter((paint) => paint.color).length > 1 ? "top fill of several" : undefined;
    const token = colorTokenFor(node, "fills");
    out.push({ property: isText ? "color" : "background", value: color, comment: [token, extra].filter(Boolean).join(" · ") || undefined });
  }
  const stroke = [...node.strokes].reverse().find((paint) => paint.color);
  const strokeWeight = num(payload.strokeWeight);
  if (stroke?.color && strokeWeight) {
    const color = withAlpha(stroke.color, sourceValue(stroke.opacity) ?? 1);
    const strokeAlign = payload.strokeAlign;
    out.push({
      property: "border",
      value: `${px(strokeWeight)} solid ${color}`,
      comment: [colorTokenFor(node, "strokes"), strokeAlign === "INSIDE" ? "inside stroke" : strokeAlign === "OUTSIDE" ? "outside stroke" : null].filter(Boolean).join(" · ") || undefined,
    });
  }
  const opacity = num(payload.opacity);
  if (opacity !== null && opacity < 0.999) out.push({ property: "opacity", value: String(round(opacity)) });

  // Effects.
  const shadows: string[] = [];
  for (const effect of Array.isArray(payload.effects) ? payload.effects : []) {
    if (typeof effect !== "object" || effect === null || Array.isArray(effect)) continue;
    const entry = effect as Record<string, unknown>;
    if (entry.visible === false) continue;
    const radius = num(entry.radius) ?? 0;
    if (entry.type === "DROP_SHADOW" || entry.type === "INNER_SHADOW") {
      const offset = (entry.offset ?? {}) as Record<string, unknown>;
      const color = rgba(entry.color) ?? "rgba(0, 0, 0, 0.25)";
      shadows.push(`${entry.type === "INNER_SHADOW" ? "inset " : ""}${px(num(offset.x) ?? 0)} ${px(num(offset.y) ?? 0)} ${px(radius)} ${px(num(entry.spread) ?? 0)} ${color}`);
    } else if (entry.type === "LAYER_BLUR") out.push({ property: "filter", value: `blur(${px(radius / 2)})` });
    else if (entry.type === "BACKGROUND_BLUR") out.push({ property: "backdrop-filter", value: `blur(${px(radius / 2)})` });
  }
  if (shadows.length) out.push({ property: "box-shadow", value: shadows.join(", ") });

  // Text.
  const type = node.typography;
  if (type) {
    if (type.fontFamily) out.push({ property: "font-family", value: /\s/.test(type.fontFamily) ? `"${type.fontFamily}"` : type.fontFamily });
    const size = type.fontSize.value;
    if (size !== null) out.push({ property: "font-size", value: px(size) });
    if (type.fontWeight !== null) out.push({ property: "font-weight", value: String(type.fontWeight) });
    const lineHeight = type.lineHeight.value;
    if (lineHeight !== null) {
      const unit = type.lineHeight.unit.toLowerCase();
      out.push({ property: "line-height", value: unit === "percent" || unit === "%" ? `${round(lineHeight)}%` : px(lineHeight) });
    }
    const spacing = type.letterSpacing.value;
    if (spacing) {
      const unit = type.letterSpacing.unit.toLowerCase();
      out.push({ property: "letter-spacing", value: unit === "percent" || unit === "%" ? `${round(spacing / 100)}em` : px(spacing) });
    }
    const alignment = type.textAlign ? textAlign[type.textAlign] : undefined;
    if (alignment && alignment !== "left") out.push({ property: "text-align", value: alignment });
  }
  return out;
}

export function cssTextForNode(node: SnapshotNode) {
  return cssDeclarationsForNode(node)
    .map(({ property, value, comment }) => `${property}: ${value};${comment ? ` /* ${comment} */` : ""}`)
    .join("\n");
}

/** Property-by-property comparison of two layers' CSS; only rows where they differ. */
export function cssDifferences(first: SnapshotNode, second: SnapshotNode) {
  const a = new Map(cssDeclarationsForNode(first).map((entry) => [entry.property, entry.value]));
  const b = new Map(cssDeclarationsForNode(second).map((entry) => [entry.property, entry.value]));
  const properties = [...new Set([...a.keys(), ...b.keys()])];
  return properties
    .filter((property) => a.get(property) !== b.get(property))
    .map((property) => ({ property, first: a.get(property) ?? null, second: b.get(property) ?? null }));
}
