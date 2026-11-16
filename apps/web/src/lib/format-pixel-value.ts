const pixelValueFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: false,
});

export function formatPixelValue(value: number) {
  if (!Number.isFinite(value)) return "—";

  const formatted = pixelValueFormatter.format(value);
  return Number(formatted) === 0 ? "0" : formatted;
}

export function formatPrecisePixelValue(value: number) {
  return formatPixelValue(value);
}

export function formatWholeNumber(value: number) {
  if (!Number.isFinite(value)) return "—";

  const rounded = Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
