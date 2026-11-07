export function formatPixelValue(value: number) {
  if (!Number.isFinite(value)) return "—";

  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 2) / 2;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
