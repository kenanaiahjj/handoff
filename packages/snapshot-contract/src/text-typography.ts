import type { SnapshotNode } from "./schema.ts";

type Typography = NonNullable<SnapshotNode["typography"]>;
type Measurement = Typography["fontSize"];
type TextStyleMeasure = { value: number | null; unit: string };
type Resolution<T> = { kind: "missing" } | { kind: "mixed" } | { kind: "uniform"; value: T };
type JsonObject = Record<string, unknown>;

function recordOf(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function textSegmentsFrom(sourcePayload: SnapshotNode["sourcePayload"]) {
  const segments = recordOf(sourcePayload)?.textSegments;
  return Array.isArray(segments) ? segments : [];
}

function resolveUniform<T>(segments: unknown[], read: (segment: JsonObject) => T | null, equal: (left: T, right: T) => boolean): Resolution<T> {
  const values = segments.map((segment) => {
    const record = recordOf(segment);
    return record ? read(record) : null;
  });
  if (!values.length || values.every((value) => value === null)) return { kind: "missing" };
  if (values.some((value) => value === null)) return { kind: "mixed" };

  const first = values[0] as T;
  return values.every((value) => equal(first, value as T))
    ? { kind: "uniform", value: first }
    : { kind: "mixed" };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function measurementValue(segment: JsonObject, field: "lineHeight" | "letterSpacing"): TextStyleMeasure | null {
  const source = recordOf(segment[field]);
  const unit = stringValue(source?.unit)?.toUpperCase();
  if (!source || !unit) return null;
  if (unit === "AUTO") return { value: null, unit: "auto" };
  const value = finiteNumber(source.value);
  return value === null ? null : { value, unit: unit.toLowerCase() };
}

function applyMeasurement(
  fallback: Measurement,
  result: Resolution<TextStyleMeasure>,
  sourceProperty: "lineHeight" | "letterSpacing",
): Measurement {
  if (result.kind === "missing") return fallback;
  if (result.kind === "mixed") {
    return {
      ...fallback,
      value: null,
      unit: "mixed",
      provenance: "unavailable",
      sourceProperty: null,
    };
  }

  return {
    ...fallback,
    value: result.value.value,
    unit: result.value.unit,
    provenance: result.value.value === null ? "unavailable" : "source",
    sourceProperty: result.value.value === null ? null : sourceProperty,
  };
}

function applyNumberMeasurement(fallback: Measurement, result: Resolution<number>, sourceProperty: string): Measurement {
  if (result.kind === "missing") return fallback;
  if (result.kind === "mixed") {
    return { ...fallback, value: null, provenance: "unavailable", sourceProperty: null };
  }
  return { ...fallback, value: result.value, provenance: "source", sourceProperty };
}

function applyScalar<T extends string | number>(fallback: T | null, result: Resolution<T>): T | null {
  if (result.kind === "missing") return fallback;
  return result.kind === "uniform" ? result.value : null;
}

export function typographyFromTextSegments(
  fallback: SnapshotNode["typography"],
  sourcePayload: SnapshotNode["sourcePayload"],
): SnapshotNode["typography"] {
  if (!fallback) return fallback;
  const segments = textSegmentsFrom(sourcePayload);
  if (!segments.length) return fallback;

  const fontFamily = resolveUniform(
    segments,
    (segment) => stringValue(recordOf(segment.fontName)?.family),
    (left, right) => left === right,
  );
  const fontSize = resolveUniform(segments, (segment) => finiteNumber(segment.fontSize), (left, right) => left === right);
  const fontWeight = resolveUniform(
    segments,
    (segment) => typeof segment.fontWeight === "string" && segment.fontWeight.length > 0
      ? segment.fontWeight
      : finiteNumber(segment.fontWeight),
    (left, right) => left === right,
  );
  const lineHeight = resolveUniform(segments, (segment) => measurementValue(segment, "lineHeight"), (left, right) => left.value === right.value && left.unit === right.unit);
  const letterSpacing = resolveUniform(segments, (segment) => measurementValue(segment, "letterSpacing"), (left, right) => left.value === right.value && left.unit === right.unit);

  return {
    ...fallback,
    fontFamily: applyScalar(fallback.fontFamily, fontFamily),
    fontSize: applyNumberMeasurement(fallback.fontSize, fontSize, "fontSize"),
    fontWeight: applyScalar(fallback.fontWeight, fontWeight),
    lineHeight: applyMeasurement(fallback.lineHeight, lineHeight, "lineHeight"),
    letterSpacing: applyMeasurement(fallback.letterSpacing, letterSpacing, "letterSpacing"),
  };
}
