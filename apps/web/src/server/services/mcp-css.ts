import type { SnapshotNode } from "@asbir/snapshot-contract";

/**
 * Turns a captured Figma layer into CSS a developer (or their AI) can paste: flexbox for auto
 * layout, gradients, shadows, blur, radii, typography with "auto" line height as `normal`, and the
 * design token behind each value as a CSS variable. Figma float noise (9.998px) is snapped.
 */

type Json = Record<string, unknown>;
type Rgba = { r: number; g: number; b: number; a?: number };

export type CodeStyle = {
  css: Record<string, string>;
  /** CSS property → the design token bound to it. */
  tokens: Record<string, { token: string; cssVar: string; value: string | number | null }>;
  /** Things CSS can't say exactly, or choices the developer should know about. */
  notes: string[];
  /** Runs of text with their own styles, when one text layer mixes styles. */
  textRuns?: Array<{ text: string; css: Record<string, string> }>;
  /** Component properties and variant values, for instances and components. */
  props?: Record<string, string | number | boolean>;
};

const record = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {});
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** 9.998 → 10, 10.0069 → 10, 12.345 → 12.35. */
export function snap(value: number) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.02) return rounded;
  return Math.round(value * 100) / 100;
}

const px = (value: number) => `${snap(value)}px`;

function measurementValue(value: unknown) {
  return number(record(value).value);
}

function channel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Figma colour (0–1 channels) and paint opacity → #RRGGBB or rgba(). */
export function cssColor(color: unknown, opacity = 1) {
  const c = record(color) as Partial<Rgba>;
  if (number(c.r) === null || number(c.g) === null || number(c.b) === null) return null;
  const alpha = Math.round((number(c.a) ?? 1) * opacity * 1000) / 1000;
  const [r, g, b] = [channel(c.r!), channel(c.g!), channel(c.b!)];
  if (alpha >= 1) return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS angle of a Figma linear gradient, from its gradient transform and the layer's size. */
function linearGradientAngle(transform: unknown, width: number, height: number) {
  const t = Array.isArray(transform) ? transform as number[][] : null;
  if (!t || t.length < 2 || t[0].length < 3) return 180;
  const [[a, b, c], [d, e, f]] = t;
  const det = a * e - b * d;
  if (!det) return 180;
  // Invert the 2×3 affine transform, then map the gradient's start (0, .5) and end (1, .5) into the layer.
  const inverse = (x: number, y: number) => [(e * (x - c) - b * (y - f)) / det, (-d * (x - c) + a * (y - f)) / det];
  const [sx, sy] = inverse(0, 0.5);
  const [ex, ey] = inverse(1, 0.5);
  const dx = (ex - sx) * width;
  const dy = (ey - sy) * height;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(((angle % 360) + 360) % 360);
}

function gradientStops(paint: Json, opacity: number) {
  const stops = Array.isArray(paint.gradientStops) ? paint.gradientStops as Json[] : [];
  return stops.map((stop) => `${cssColor(stop.color, opacity) ?? "transparent"} ${Math.round((number(stop.position) ?? 0) * 1000) / 10}%`).join(", ");
}

/** One Figma paint as a CSS background layer or colour. */
function paintCss(paint: Json, width: number, height: number, notes: string[]) {
  if (paint.visible === false) return null;
  const opacity = number(paint.opacity) ?? 1;
  switch (paint.type) {
    case "SOLID":
      return cssColor(paint.color, opacity);
    case "GRADIENT_LINEAR":
      return `linear-gradient(${linearGradientAngle(paint.gradientTransform, width, height)}deg, ${gradientStops(paint, opacity)})`;
    case "GRADIENT_RADIAL":
      notes.push("Radial gradient: the centre and size are approximate; compare with the screenshot.");
      return `radial-gradient(${gradientStops(paint, opacity)})`;
    case "GRADIENT_ANGULAR":
      return `conic-gradient(${gradientStops(paint, opacity)})`;
    case "GRADIENT_DIAMOND":
      notes.push("Diamond gradient has no CSS equivalent; approximated as radial.");
      return `radial-gradient(${gradientStops(paint, opacity)})`;
    case "IMAGE":
      notes.push(`Image fill (${String(paint.scaleMode ?? "FILL").toLowerCase()}): download it with get_element_image.`);
      return "url(<image from get_element_image>)";
    default:
      return null;
  }
}

const justify: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
const align: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline", STRETCH: "stretch" };
const textAlign: Record<string, string> = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
const textCase: Record<string, string> = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize", SMALL_CAPS: "small-caps" };
const textDecoration: Record<string, string> = { UNDERLINE: "underline", STRIKETHROUGH: "line-through" };
const blend: Record<string, string> = {
  MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay", DARKEN: "darken", LIGHTEN: "lighten",
  COLOR_DODGE: "color-dodge", COLOR_BURN: "color-burn", HARD_LIGHT: "hard-light", SOFT_LIGHT: "soft-light",
  DIFFERENCE: "difference", EXCLUSION: "exclusion", HUE: "hue", SATURATION: "saturation", COLOR: "color", LUMINOSITY: "luminosity",
};

function gridTracks(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  return (value as Json[]).map((track) => {
    const size = number(track.value);
    if (track.type === "FLEX") return `${size ?? 1}fr`;
    if (track.type === "FIXED" && size !== null) return px(size);
    return "auto";
  }).join(" ");
}

function lineHeightCss(lineHeight: unknown) {
  const value = record(lineHeight);
  const unit = String(value.unit ?? "").toUpperCase();
  const amount = number(value.value);
  if (unit === "AUTO" || amount === null) return "normal";
  if (unit === "PERCENT") return String(snap(amount / 100));
  return px(amount);
}

function letterSpacingCss(letterSpacing: unknown) {
  const value = record(letterSpacing);
  const amount = number(value.value);
  if (amount === null || amount === 0) return null;
  return String(value.unit ?? "").toUpperCase() === "PERCENT" ? `${snap(amount / 100)}em` : px(amount);
}

function fontWeight(segment: Json) {
  const weight = number(segment.fontWeight);
  if (weight !== null) return String(weight);
  const style = String(record(segment.fontName).style ?? "").toLowerCase();
  const named: Array<[RegExp, number]> = [[/thin|hairline/, 100], [/extra ?light|ultra ?light/, 200], [/light/, 300], [/medium/, 500], [/semi ?bold|demi ?bold/, 600], [/extra ?bold|ultra ?bold/, 800], [/black|heavy/, 900], [/bold/, 700]];
  return String(named.find(([pattern]) => pattern.test(style))?.[1] ?? 400);
}

function textRunCss(segment: Json, notes: string[]) {
  const css: Record<string, string> = {};
  const font = record(segment.fontName);
  if (typeof font.family === "string") css["font-family"] = `"${font.family}"`;
  const size = number(segment.fontSize);
  if (size !== null) css["font-size"] = px(size);
  css["font-weight"] = fontWeight(segment);
  if (/italic|oblique/i.test(String(font.style ?? ""))) css["font-style"] = "italic";
  css["line-height"] = lineHeightCss(segment.lineHeight);
  const spacing = letterSpacingCss(segment.letterSpacing);
  if (spacing) css["letter-spacing"] = spacing;
  const transform = textCase[String(segment.textCase)];
  if (transform === "small-caps") css["font-variant"] = "small-caps";
  else if (transform) css["text-transform"] = transform;
  const decoration = textDecoration[String(segment.textDecoration)];
  if (decoration) css["text-decoration"] = decoration;
  const fills = Array.isArray(segment.fills) ? (segment.fills as Json[]).filter((paint) => paint.visible !== false) : [];
  const top = fills.at(-1);
  if (top?.type === "SOLID") css.color = cssColor(top.color, number(top.opacity) ?? 1) ?? "inherit";
  else if (top && String(top.type).startsWith("GRADIENT")) {
    css.background = paintCss(top, 100, 100, notes) ?? "";
    css["-webkit-background-clip"] = "text";
    css.color = "transparent";
  }
  return css;
}

function shadow(effect: Json, inset: boolean) {
  const offset = record(effect.offset);
  const color = cssColor(effect.color) ?? "rgba(0, 0, 0, 0.25)";
  return `${inset ? "inset " : ""}${px(number(offset.x) ?? 0)} ${px(number(offset.y) ?? 0)} ${px(number(effect.radius) ?? 0)} ${px(number(effect.spread) ?? 0)} ${color}`;
}

/** Figma binding path → the CSS property it sets on this layer. */
function cssPropertyForBinding(path: string, isText: boolean) {
  const tail = path.replace(/^textSegments\[[^\]]*\]\.boundVariables\./, "").replace(/^boundVariables\./, "");
  const stop = tail.match(/gradientStops\[(\d+)\]/);
  if (stop) return `gradient stop ${Number(stop[1]) + 1}`;
  if (/^(fills|textRangeFills)/.test(tail)) return isText ? "color" : "background";
  if (/^strokes/.test(tail)) return "border-color";
  if (/^effects/.test(tail)) return "box-shadow";
  const map: Record<string, string> = {
    paddingTop: "padding-top", paddingRight: "padding-right", paddingBottom: "padding-bottom", paddingLeft: "padding-left",
    itemSpacing: "gap", counterAxisSpacing: "row-gap", gridRowGap: "row-gap", gridColumnGap: "column-gap",
    topLeftRadius: "border-top-left-radius", topRightRadius: "border-top-right-radius",
    bottomLeftRadius: "border-bottom-left-radius", bottomRightRadius: "border-bottom-right-radius", cornerRadius: "border-radius",
    width: "width", height: "height", minWidth: "min-width", maxWidth: "max-width", minHeight: "min-height", maxHeight: "max-height",
    fontSize: "font-size", fontFamily: "font-family", fontWeight: "font-weight", fontStyle: "font-weight",
    lineHeight: "line-height", letterSpacing: "letter-spacing", opacity: "opacity", strokeWeight: "border-width",
    strokeTopWeight: "border-top-width", strokeRightWeight: "border-right-width", strokeBottomWeight: "border-bottom-width", strokeLeftWeight: "border-left-width",
    paragraphSpacing: "margin-bottom", visible: "display",
  };
  const key = tail.split(/[.[]/)[0];
  return map[key] ?? key;
}

/** "color/primary" → "--color-primary"; "Spacing / 4" → "--spacing-4". */
export function tokenCssVar(name: string) {
  return `--${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function tokenValue(value: unknown): string | number | null {
  if (typeof value === "number") return snap(value);
  if (typeof value === "string") return value;
  return cssColor(value);
}

/**
 * Code-ready style for one layer. `parent` decides flex child sizing (fill/hug) and absolute
 * positioning; without it the layer is described on its own.
 */
export function codeStyle(node: SnapshotNode, parent?: SnapshotNode | null): CodeStyle {
  const payload = record(node.sourcePayload);
  const css: Record<string, string> = {};
  const notes: string[] = [];
  const isText = node.type === "TEXT";
  const width = measurementValue(node.layoutBounds?.width) ?? measurementValue(node.bounds?.width) ?? 0;
  const height = measurementValue(node.layoutBounds?.height) ?? measurementValue(node.bounds?.height) ?? 0;

  // Place in the parent: flex child, or absolutely positioned.
  const parentPayload = record(parent?.sourcePayload);
  const parentMode = parent?.layout?.mode ?? (typeof parentPayload.layoutMode === "string" ? parentPayload.layoutMode : null);
  const parentIsAutoLayout = parentMode === "HORIZONTAL" || parentMode === "VERTICAL" || parentMode === "GRID";
  const absolute = payload.layoutPositioning === "ABSOLUTE" || (parent && !parentIsAutoLayout);
  const sizingH = String(payload.layoutSizingHorizontal ?? node.layout?.constraints?.layoutSizingHorizontal ?? "FIXED");
  const sizingV = String(payload.layoutSizingVertical ?? node.layout?.constraints?.layoutSizingVertical ?? "FIXED");
  if (absolute && parent) {
    css.position = "absolute";
    css.left = px(measurementValue(node.layoutBounds?.x) ?? 0);
    css.top = px(measurementValue(node.layoutBounds?.y) ?? 0);
    const constraints = record(payload.constraints);
    if (constraints.horizontal && constraints.horizontal !== "MIN") notes.push(`Horizontal constraint is ${String(constraints.horizontal).toLowerCase()} (pinned ${constraints.horizontal === "MAX" ? "right" : constraints.horizontal === "STRETCH" ? "left and right" : String(constraints.horizontal).toLowerCase()}).`);
    if (constraints.vertical && constraints.vertical !== "MIN") notes.push(`Vertical constraint is ${String(constraints.vertical).toLowerCase()} (pinned ${constraints.vertical === "MAX" ? "bottom" : constraints.vertical === "STRETCH" ? "top and bottom" : String(constraints.vertical).toLowerCase()}).`);
  }
  const primaryIsHorizontal = parentMode === "HORIZONTAL";
  const sizeCss = (axis: "width" | "height", sizing: string, value: number) => {
    const onPrimary = parentIsAutoLayout && parentMode !== "GRID" && (axis === "width") === primaryIsHorizontal;
    if (sizing === "FILL" && parentIsAutoLayout && !absolute) {
      if (onPrimary) css.flex = "1 1 0";
      else css["align-self"] = "stretch";
      return;
    }
    if (sizing === "HUG") return; // auto: sized by content
    css[axis] = px(value);
  };
  sizeCss("width", sizingH, width);
  sizeCss("height", sizingV, height);
  if (isText && payload.textAutoResize === "WIDTH_AND_HEIGHT") {
    delete css.width;
    css["white-space"] = "nowrap";
  } else if (isText && payload.textAutoResize === "HEIGHT") delete css.height;
  for (const [field, property] of [["minWidth", "min-width"], ["maxWidth", "max-width"], ["minHeight", "min-height"], ["maxHeight", "max-height"]] as const) {
    const value = number(payload[field]);
    if (value !== null) css[property] = px(value);
  }

  // This layer as a container.
  const mode = node.layout?.mode;
  if (mode === "HORIZONTAL" || mode === "VERTICAL") {
    css.display = "flex";
    css["flex-direction"] = mode === "HORIZONTAL" ? "row" : "column";
    if (payload.itemReverseZIndex === true) notes.push("Earlier children are drawn on top (reverse z-index).");
    const primary = node.layout?.primaryAxisAlign ?? "MIN";
    const counter = node.layout?.counterAxisAlign ?? "MIN";
    if (primary !== "MIN") css["justify-content"] = justify[primary] ?? primary.toLowerCase();
    if (counter !== "MIN") css["align-items"] = align[counter] ?? counter.toLowerCase();
    if (node.layout?.wrap) css["flex-wrap"] = "wrap";
    const gap = number(payload.itemSpacing) ?? measurementValue(node.spacing?.itemGap);
    if (primary !== "SPACE_BETWEEN" && gap) css.gap = px(gap);
    const counterGap = number(payload.counterAxisSpacing);
    if (node.layout?.wrap && counterGap) css["row-gap"] = px(counterGap);
  } else if (mode === "GRID") {
    css.display = "grid";
    const columns = gridTracks(payload.gridColumnSizes);
    const rows = gridTracks(payload.gridRowSizes);
    if (columns) css["grid-template-columns"] = columns;
    if (rows) css["grid-template-rows"] = rows;
    const rowGap = number(payload.gridRowGap);
    const columnGap = number(payload.gridColumnGap);
    if (rowGap) css["row-gap"] = px(rowGap);
    if (columnGap) css["column-gap"] = px(columnGap);
  }
  if (mode && mode !== "NONE") {
    const sides = (["top", "right", "bottom", "left"] as const).map((side) => snap(measurementValue(node.padding?.[side]) ?? 0));
    if (sides.some(Boolean)) {
      const [top, right, bottom, left] = sides;
      css.padding = top === bottom && right === left
        ? top === right ? `${top}px` : `${top}px ${right}px`
        : `${top}px ${right}px ${bottom}px ${left}px`;
    }
  }
  if (parentMode === "GRID") {
    const columnSpan = number(payload.gridColumnSpan);
    const rowSpan = number(payload.gridRowSpan);
    if (columnSpan && columnSpan > 1) css["grid-column"] = `span ${columnSpan}`;
    if (rowSpan && rowSpan > 1) css["grid-row"] = `span ${rowSpan}`;
  }
  if (payload.clipsContent === true && !isText) css.overflow = "hidden";

  // Shape.
  const corners = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"].map((field) => number(payload[field]));
  if (corners.every((value) => value !== null) && corners.some(Boolean)) {
    const values = corners.map((value) => `${snap(value!)}px`);
    css["border-radius"] = values.every((value) => value === values[0]) ? values[0] : values.join(" ");
  } else if (number(payload.cornerRadius)) css["border-radius"] = px(number(payload.cornerRadius)!);
  if (node.type === "ELLIPSE") css["border-radius"] = "50%";

  // Paint.
  const fills = Array.isArray(payload.fillPaintDetails) ? (payload.fillPaintDetails as Json[]) : [];
  if (isText) {
    const segments = Array.isArray(payload.textSegments) ? (payload.textSegments as Json[]) : [];
    const runs = segments.map((segment) => ({ text: String(segment.characters ?? ""), css: textRunCss(segment, notes) }));
    if (runs.length) Object.assign(css, runs[0].css);
    else if (node.typography) {
      if (node.typography.fontFamily) css["font-family"] = `"${node.typography.fontFamily}"`;
      const size = measurementValue(node.typography.fontSize);
      if (size !== null) css["font-size"] = px(size);
      if (node.typography.fontWeight !== null) css["font-weight"] = String(node.typography.fontWeight);
      css["line-height"] = lineHeightCss({ unit: node.typography.lineHeight.unit === "pixels" ? "PIXELS" : String(node.typography.lineHeight.unit).toUpperCase(), value: node.typography.lineHeight.value });
      const spacing = letterSpacingCss({ unit: String(node.typography.letterSpacing.unit).toUpperCase(), value: node.typography.letterSpacing.value });
      if (spacing) css["letter-spacing"] = spacing;
      const top = fills.filter((paint) => paint.visible !== false).at(-1);
      if (top?.type === "SOLID") css.color = cssColor(top.color, number(top.opacity) ?? 1) ?? "inherit";
    }
    const alignment = textAlign[String(node.typography?.textAlign ?? "LEFT")];
    if (alignment && alignment !== "left") css["text-align"] = alignment;
    if (payload.textAlignVertical && payload.textAlignVertical !== "TOP") notes.push(`Text is vertically aligned ${String(payload.textAlignVertical).toLowerCase()} inside its box.`);
    if (payload.textTruncation === "ENDING") {
      const lines = number(payload.maxLines);
      if (lines && lines > 1) Object.assign(css, { display: "-webkit-box", "-webkit-line-clamp": String(lines), "-webkit-box-orient": "vertical", overflow: "hidden" });
      else Object.assign(css, { overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" });
    }
    if (runs.length > 1) {
      const distinct = runs.filter((run) => JSON.stringify(run.css) !== JSON.stringify(runs[0].css));
      if (distinct.length) {
        notes.push("This text mixes styles; see textRuns.");
        return finish({ textRuns: runs });
      }
    }
  } else {
    const layers = fills.map((paint) => paintCss(paint, width, height, notes)).filter((value): value is string => Boolean(value)).reverse();
    if (layers.length === 1 && !layers[0].includes("(")) css["background-color"] = layers[0];
    else if (layers.length) css.background = layers.join(", ");
  }
  const strokes = (Array.isArray(payload.strokePaintDetails) ? (payload.strokePaintDetails as Json[]) : []).filter((paint) => paint.visible !== false);
  const strokeWeight = number(payload.strokeWeight);
  if (strokes.length && strokeWeight) {
    const color = strokes.at(-1)?.type === "SOLID" ? cssColor(strokes.at(-1)!.color, number(strokes.at(-1)!.opacity) ?? 1) : null;
    const dashed = Array.isArray(payload.dashPattern) && (payload.dashPattern as unknown[]).length ? "dashed" : "solid";
    const value = `${px(strokeWeight)} ${dashed} ${color ?? "currentColor"}`;
    const strokeAlign = String(payload.strokeAlign ?? "INSIDE");
    if (isText) css["-webkit-text-stroke"] = `${px(strokeWeight)} ${color ?? "currentColor"}`;
    else if (strokeAlign === "OUTSIDE") css.outline = value;
    else {
      css.border = value;
      if (strokeAlign === "INSIDE") css["box-sizing"] = "border-box";
      if (strokeAlign === "CENTER") notes.push("Stroke is centred on the edge in Figma; a CSS border sits inside it.");
    }
    if (!color) notes.push("Stroke uses a gradient or image; CSS border shows currentColor.");
  }

  // Effects.
  const effects = (Array.isArray(payload.effects) ? (payload.effects as Json[]) : []).filter((effect) => effect.visible !== false);
  const shadows = effects.filter((effect) => effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW");
  if (shadows.length) {
    if (isText) css["text-shadow"] = shadows.filter((effect) => effect.type === "DROP_SHADOW").map((effect) => {
      const offset = record(effect.offset);
      return `${px(number(offset.x) ?? 0)} ${px(number(offset.y) ?? 0)} ${px(number(effect.radius) ?? 0)} ${cssColor(effect.color) ?? "rgba(0, 0, 0, 0.25)"}`;
    }).join(", ");
    else css["box-shadow"] = shadows.map((effect) => shadow(effect, effect.type === "INNER_SHADOW")).join(", ");
  }
  for (const effect of effects) {
    const radius = number(effect.radius) ?? 0;
    if (effect.type === "LAYER_BLUR") css.filter = `blur(${snap(radius / 2)}px)`;
    else if (effect.type === "BACKGROUND_BLUR") css["backdrop-filter"] = `blur(${snap(radius / 2)}px)`;
    else if (effect.type === "GLASS") {
      css["backdrop-filter"] = `blur(${snap(radius / 2)}px)`;
      notes.push("Figma glass effect (refraction and light) has no CSS equivalent; approximated with backdrop blur.");
    } else if (effect.type === "NOISE" || effect.type === "TEXTURE") notes.push(`Figma ${String(effect.type).toLowerCase()} effect has no CSS equivalent.`);
  }

  // Layer.
  const opacity = number(payload.opacity);
  if (opacity !== null && opacity < 1) css.opacity = String(Math.round(opacity * 100) / 100);
  const rotation = number(payload.rotation);
  if (rotation && Math.abs(rotation) > 0.01) {
    css.transform = `rotate(${snap(-rotation)}deg)`;
    notes.push("Rotated: width and height are before rotation; position uses the rotated layer's top-left.");
  }
  const blendMode = blend[String(payload.blendMode)];
  if (blendMode) css["mix-blend-mode"] = blendMode;
  if (!node.visible) css.display = "none";
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "STAR" || node.type === "POLYGON" || node.type === "LINE") {
    notes.push("Vector shape: use the SVG from get_element_image rather than CSS.");
  }

  return finish({});

  function finish(extra: Partial<CodeStyle>): CodeStyle {
    const tokens: CodeStyle["tokens"] = {};
    for (const token of node.tokens ?? []) {
      let property = cssPropertyForBinding(String((token as { bindingPath?: string }).bindingPath ?? token.category), isText);
      if (property === "background" && css["background-color"]) property = "background-color";
      const cssVar = tokenCssVar(token.name);
      tokens[property] = { token: token.name, cssVar, value: tokenValue(token.value) };
    }
    const props: Record<string, string | number | boolean> = {};
    for (const [key, entry] of Object.entries(record(payload.componentProperties))) {
      const value = record(entry).value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") props[key.replace(/#[^#]*$/, "")] = value;
    }
    for (const [key, value] of Object.entries(record(payload.variantProperties))) {
      if (typeof value === "string") props[key] = value;
    }
    return {
      css,
      tokens,
      notes: [...new Set(notes)],
      ...(Object.keys(props).length ? { props } : {}),
      ...extra,
    };
  }
}

/** A CSS declaration block, with token variables where the design binds one. */
export function cssText(style: CodeStyle) {
  return Object.entries(style.css).map(([property, value]) => {
    const token = style.tokens[property];
    // A colour token can't stand in for a gradient or image; keep the literal value then.
    const usable = token && !/gradient\(|url\(/.test(value);
    return `${property}: ${usable ? `var(${token.cssVar}, ${value})` : value};`;
  }).join("\n");
}
