export function encodeUtf8(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 16_384, value.length);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
    const encoded = encodeURIComponent(value.slice(start, end));
    const bytes = new Uint8Array(encoded.length);
    let length = 0;
    for (let index = 0; index < encoded.length;) {
      if (encoded[index] === "%") {
        bytes[length++] = Number.parseInt(encoded.slice(index + 1, index + 3), 16);
        index += 3;
      } else {
        bytes[length++] = encoded.charCodeAt(index++);
      }
    }
    chunks.push(bytes.subarray(0, length));
    total += length;
    start = end;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
