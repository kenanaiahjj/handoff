export function formatPixelValue(value: number) {
  if (!Number.isFinite(value)) return "—";

  const rounded = Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
