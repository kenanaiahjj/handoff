export function encodeUtf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];

  for (let index = 0; index < encoded.length;) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 3;
    } else {
      bytes.push(encoded.charCodeAt(index));
      index += 1;
    }
  }

  return Uint8Array.from(bytes);
}
