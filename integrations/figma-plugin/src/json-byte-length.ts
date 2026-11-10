function quotedStringByteLength(value: string): number {
  if (!/["\\\u0000-\u001f]|[^\u0000-\u007f]/.test(value)) return value.length + 2;

  let byteLength = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      byteLength += 2;
    } else if (codeUnit <= 0x1f) {
      byteLength += codeUnit === 0x08 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0c || codeUnit === 0x0d ? 2 : 6;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      byteLength += 6;
    } else if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else {
      byteLength += 3;
    }
  }
  return byteLength;
}

function jsonValueByteLength(value: unknown, inArray = false): number {
  if (value === null) return 4;
  if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  if (typeof value !== "object" && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return inArray ? 4 : 0;
  }
  if (typeof value === "string") return quotedStringByteLength(value);
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 4;

  if (Array.isArray(value)) {
    let byteLength = 2;
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) byteLength += 1;
      byteLength += jsonValueByteLength(value[index], true);
    }
    return byteLength;
  }

  const record = value as Record<string, unknown>;
  let byteLength = 2;
  let propertyCount = 0;
  for (const [key, entry] of Object.entries(record)) {
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
    if (propertyCount > 0) byteLength += 1;
    byteLength += quotedStringByteLength(key) + 1 + jsonValueByteLength(entry);
    propertyCount += 1;
  }
  return byteLength;
}

/** Counts JSON's UTF-8 bytes without allocating the serialized JSON string. */
export function jsonByteLength(value: unknown): number {
  return jsonValueByteLength(value);
}
