import type { SnapshotNode } from "@asbir/snapshot-contract";

export function inspectionMeasurementEntries<T>(values: Record<string, T>) {
  return Object.entries(values);
}

export function formatPixelValue(value: number) {
  if (!Number.isFinite(value)) return "—";

  const rounded = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function formatFrameSize(width: number, height: number) {
  return `${formatPixelValue(width)} × ${formatPixelValue(height)} px`;
}

export function inspectionMargins(node: Pick<SnapshotNode, "sourceNodeId" | "sourceFrameId" | "margins">): SnapshotNode["margins"] {
  if (node.sourceNodeId !== node.sourceFrameId) return node.margins;

  const unavailable = { value: null, unit: "px", provenance: "unavailable" as const, sourceProperty: null };
  return { top: unavailable, right: unavailable, bottom: unavailable, left: unavailable };
}

function roundMeasurementValues(value: unknown, forceMeasurement = false): unknown {
  if (typeof value === "number") {
    if (!forceMeasurement) return value;

    const formatted = formatPixelValue(value);
    return formatted === "—" ? formatted : Number(formatted);
  }

  if (Array.isArray(value)) {
    return value.map((item) => roundMeasurementValues(item, forceMeasurement));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    const unit = entries.find(([key]) => key === "unit")?.[1];
    const unitName = typeof unit === "string" ? unit.trim().toLowerCase() : "";
    const hasPixelUnit = unitName === "px" || unitName === "pixel" || unitName === "pixels";
    const nestedMeasurement = unitName ? hasPixelUnit : forceMeasurement;

    return Object.fromEntries(
      entries.map(([key, item]) => [
        key,
        key === "value" && hasPixelUnit && typeof item === "number"
          ? roundMeasurementValues(item, true)
          : roundMeasurementValues(item, nestedMeasurement),
      ]),
    );
  }

  return value;
}

export function formatComparisonValue(value: unknown, category: string) {
  if (value === undefined) return "Not present";
  if (value === null) return "Unavailable";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);

  const isMeasurement = category === "geometry" || category === "layout";
  if (typeof value === "number") {
    return isMeasurement ? formatPixelValue(value) : String(value);
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).value === "number" &&
    typeof (value as Record<string, unknown>).unit === "string"
  ) {
    const measurement = roundMeasurementValues(value) as Record<string, unknown>;
    return `${measurement.value} ${measurement.unit}`;
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const paint = value as Record<string, unknown>;
    if (typeof paint.color === "string") {
      const opacity = paint.opacity;
      if (typeof opacity === "number") return `${paint.color} · ${formatPixelValue(opacity * 100)}% opacity`;
      if (opacity !== null && typeof opacity === "object" && typeof (opacity as Record<string, unknown>).value === "number") {
        const opacityValue = (opacity as Record<string, unknown>).value as number;
        const opacityUnit = (opacity as Record<string, unknown>).unit;
        const percentage = opacityUnit === "ratio" ? opacityValue * 100 : opacityValue;
        return `${paint.color} · ${formatPixelValue(percentage)}% opacity`;
      }
      return paint.color;
    }
  }

  return JSON.stringify(roundMeasurementValues(value, isMeasurement));
}
