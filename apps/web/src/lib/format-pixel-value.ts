export function formatPixelValue(value: number) {
  if (!Number.isFinite(value)) return "—";

  return String(Object.is(value, -0) ? 0 : value);
}

export function formatPrecisePixelValue(value: number) {
  return formatPixelValue(value);
}

export function formatWholeNumber(value: number) {
  if (!Number.isFinite(value)) return "—";

  const rounded = Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
