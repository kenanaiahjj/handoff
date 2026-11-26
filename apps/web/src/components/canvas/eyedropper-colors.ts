/** 0–255 channels and 0–1 alpha. */
export type Rgba = { r: number; g: number; b: number; a: number };

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Reads the colours captures and tokens hold: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), and
 * Figma's { r, g, b, a } with 0–1 channels. Anything else is null.
 */
export function parseColor(value: unknown): Rgba | null {
  if (value && typeof value === "object") {
    const { r, g, b, a } = value as Record<string, unknown>;
    if ([r, g, b].every((channel) => typeof channel === "number" && Number.isFinite(channel))) {
      const scale = [r, g, b].every((channel) => (channel as number) <= 1) ? 255 : 1;
      return { r: clampByte((r as number) * scale), g: clampByte((g as number) * scale), b: clampByte((b as number) * scale), a: typeof a === "number" ? Math.max(0, Math.min(1, a)) : 1 };
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: clampByte(+rgb[1]), g: clampByte(+rgb[2]), b: clampByte(+rgb[3]), a: Math.max(0, Math.min(1, alpha)) };
  }
  return null;
}

export function toHex({ r, g, b, a }: Rgba) {
  const byte = (value: number) => clampByte(value).toString(16).padStart(2, "0");
  return ("#" + byte(r) + byte(g) + byte(b) + (a < 1 ? byte(a * 255) : "")).toUpperCase();
}

/** OKLab, so "nearest" matches what people see rather than raw RGB distance. */
function toOklab({ r, g, b }: Rgba) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceived difference, scaled so about 1 is just noticeable and under 2.5 reads as the same colour. */
export function colorDistance(left: Rgba, right: Rgba) {
  const [l1, a1, b1] = toOklab(left);
  const [l2, a2, b2] = toOklab(right);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

export type PaletteEntry = { hex: string; rgba: Rgba; tokenName: string | null };

type PaletteNode = {
  fills: Array<{ color: string | null }>;
  strokes: Array<{ color: string | null }>;
  tokens: Array<{ name: string; value: unknown }>;
};

/** The colours a screen's layers use, each with the token bound to it when the capture has one. */
export function screenPalette(nodes: readonly PaletteNode[]): PaletteEntry[] {
  const byKey = new Map<string, PaletteEntry>();
  const add = (value: unknown, tokenName: string | null) => {
    const rgba = parseColor(value);
    if (!rgba) return;
    const hex = toHex(rgba);
    const key = hex + "|" + (tokenName ?? "");
    if (!byKey.has(key)) byKey.set(key, { hex, rgba, tokenName });
  };
  for (const node of nodes) {
    const colorTokens = node.tokens.filter((token) => parseColor(token.value));
    for (const token of colorTokens) add(token.value, token.name);
    for (const paint of [...node.fills, ...node.strokes]) {
      // A paint whose colour equals one of the layer's colour tokens is that token.
      const match = colorTokens.find((token) => paint.color && colorDistance(parseColor(token.value)!, parseColor(paint.color) ?? { r: -999, g: 0, b: 0, a: 1 }) < 0.5);
      add(paint.color, match?.name ?? null);
    }
  }
  return [...byKey.values()];
}

/** The closest token and the closest captured colour (which may be the same entry). */
export function nearestColors(sample: Rgba, palette: readonly PaletteEntry[]) {
  let token: { entry: PaletteEntry; distance: number } | null = null;
  let color: { entry: PaletteEntry; distance: number } | null = null;
  for (const entry of palette) {
    const distance = colorDistance(sample, entry.rgba);
    if (!color || distance < color.distance) color = { entry, distance };
    if (entry.tokenName && (!token || distance < token.distance)) token = { entry, distance };
  }
  return { token, color };
}

/** "#FF6A00 · brand/primary" or "#FF6A00 · near brand/primary (#FF7000)". */
export function describePick(sample: Rgba, palette: readonly PaletteEntry[]) {
  const hex = toHex({ ...sample, a: 1 });
  const { token, color } = nearestColors(sample, palette);
  if (token && token.distance < 1) return { hex, detail: `token ${token.entry.tokenName}` };
  if (token && token.distance < 6) return { hex, detail: `near token ${token.entry.tokenName} (${token.entry.hex})` };
  if (color && color.distance < 1) return { hex, detail: "a captured colour with no token" };
  if (color && color.distance < 6) return { hex, detail: `near ${color.entry.hex}, no token` };
  return { hex, detail: "not a colour the layers use (likely an image or a blend)" };
}
