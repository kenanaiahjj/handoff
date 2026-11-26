import sharp from "sharp";

/**
 * Pixel work for the developer MCP tools: crop one layer out of a screen render, and compare a
 * screenshot of the built screen with the design so an AI can see where they differ and which
 * layers sit there. Screen renders are already cropped to the frame, so frame px × scale = render px.
 */

export type Box = { x: number; y: number; width: number; height: number };

export type LayerBox = Box & { id: string; name: string; type: string; visible: boolean };

/** Crop one layer (bounds relative to the screen, in design px) from a screen render. */
export async function cropLayer(render: Uint8Array, frameWidth: number, box: Box, pad = 0) {
  const image = sharp(render);
  const meta = await image.metadata();
  const scale = (meta.width ?? frameWidth) / frameWidth;
  const left = Math.max(0, Math.floor((box.x - pad) * scale));
  const top = Math.max(0, Math.floor((box.y - pad) * scale));
  const right = Math.min(meta.width ?? 0, Math.ceil((box.x + box.width + pad) * scale));
  const bottom = Math.min(meta.height ?? 0, Math.ceil((box.y + box.height + pad) * scale));
  if (right - left < 1 || bottom - top < 1) throw new Error("This layer is outside the screen's render.");
  const bytes = await image.extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
  return { bytes, width: right - left, height: bottom - top, scale };
}

async function rgba(input: Uint8Array | Buffer, width: number, height?: number) {
  const { data, info } = await sharp(input)
    .flatten({ background: "#ffffff" })
    .resize({ width, height, fit: height ? "fill" : "inside", kernel: "lanczos3" })
    .blur(0.6)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Vertical shift of the build against the design (a missing status bar, a taller header), in design px. */
function bestVerticalShift(design: { data: Buffer; width: number; height: number }, built: { data: Buffer; width: number; height: number }, maxShift: number) {
  const rowStep = 2;
  let best = { shift: 0, score: Number.POSITIVE_INFINITY };
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    let total = 0;
    let count = 0;
    for (let y = Math.max(0, -shift); y < design.height && y + shift < built.height; y += rowStep) {
      for (let x = 0; x < design.width; x += 4) {
        const a = (y * design.width + x) * 3;
        const b = ((y + shift) * built.width + x) * 3;
        total += Math.abs(design.data[a] - built.data[b]) + Math.abs(design.data[a + 1] - built.data[b + 1]) + Math.abs(design.data[a + 2] - built.data[b + 2]);
        count += 1;
      }
    }
    const score = count ? total / count : Number.POSITIVE_INFINITY;
    if (score < best.score - 0.5 || (Math.abs(score - best.score) <= 0.5 && Math.abs(shift) < Math.abs(best.shift))) best = { shift, score };
  }
  return best.shift;
}

export type ImplementationCheck = {
  matchPercent: number;
  design: { width: number; height: number };
  built: { originalWidth: number; originalHeight: number; scaledHeight: number };
  verticalShift: number;
  regions: Array<Box & { number: number; mismatchPercent: number; layers: Array<{ id: string; name: string; type: string; bounds: Box }> }>;
  notes: string[];
  /** Design (left) and build (right) side by side with numbered boxes on each difference. */
  overlay: Buffer;
};

const cell = 8;

/**
 * Compare a screenshot of the built screen with the design render. The build is scaled to the
 * design's width; each 8×8 design-px cell is a mismatch when over 18% of its pixels differ by more
 * than a small tolerance (antialiasing and font rendering differ between Figma and browsers).
 */
export async function compareImplementation(input: {
  designRender: Uint8Array;
  built: Uint8Array;
  frameWidth: number;
  frameHeight: number;
  layers: LayerBox[];
  maxRegions?: number;
}): Promise<ImplementationCheck> {
  const width = Math.max(1, Math.round(input.frameWidth));
  const height = Math.max(1, Math.round(input.frameHeight));
  const builtMeta = await sharp(input.built).metadata();
  if (!builtMeta.width || !builtMeta.height) throw new Error("The screenshot could not be read. Send a PNG, JPEG or WebP.");
  const design = await rgba(input.designRender, width, height);
  const built = await rgba(input.built, width);
  const notes: string[] = [];
  const ratio = (builtMeta.width / width);
  if (Math.abs(ratio - Math.round(ratio)) > 0.05 && Math.abs(ratio - 1) > 0.05) notes.push(`The screenshot is ${builtMeta.width}px wide and the design is ${width}px; it was scaled to compare. Capture at the design width (or an exact 2× / 3×) for the most accurate result.`);
  const verticalShift = bestVerticalShift(design, built, Math.min(60, Math.round(height / 8)));
  if (verticalShift) notes.push(`The build is shifted ${Math.abs(verticalShift)}px ${verticalShift > 0 ? "down" : "up"} from the design overall (for example a different status bar or header height). Differences are measured after lining them up; fix the shift first if it isn't intended.`);
  if (Math.abs(built.height - height) > 4) notes.push(`The build is ${built.height}px tall at design width; the design is ${height}px. Only the overlapping part was compared.`);

  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const mismatched = new Uint8Array(columns * rows);
  const cellShare = new Float32Array(columns * rows);
  let comparedPixels = 0;
  let differentPixels = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let different = 0;
      let total = 0;
      for (let y = row * cell; y < Math.min(height, (row + 1) * cell); y += 1) {
        const by = y + verticalShift;
        if (by < 0 || by >= built.height) continue;
        for (let x = column * cell; x < Math.min(width, (column + 1) * cell); x += 1) {
          const a = (y * width + x) * 3;
          const b = (by * built.width + x) * 3;
          const delta = Math.max(Math.abs(design.data[a] - built.data[b]), Math.abs(design.data[a + 1] - built.data[b + 1]), Math.abs(design.data[a + 2] - built.data[b + 2]));
          total += 1;
          if (delta > 40) different += 1;
        }
      }
      comparedPixels += total;
      differentPixels += different;
      const share = total ? different / total : 0;
      cellShare[row * columns + column] = share;
      if (total && share > 0.18) mismatched[row * columns + column] = 1;
    }
  }

  // Group neighbouring mismatched cells (with a one-cell gap) into regions.
  const seen = new Uint8Array(columns * rows);
  const regions: ImplementationCheck["regions"] = [];
  for (let start = 0; start < mismatched.length; start += 1) {
    if (!mismatched[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let [minC, minR, maxC, maxR] = [columns, rows, 0, 0];
    let shareSum = 0;
    let cells = 0;
    while (queue.length) {
      const index = queue.pop()!;
      const c = index % columns;
      const r = Math.floor(index / columns);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      shareSum += cellShare[index];
      cells += 1;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
          const next = nr * columns + nc;
          if (mismatched[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
        }
      }
    }
    const box = { x: minC * cell, y: minR * cell, width: Math.min(width, (maxC + 1) * cell) - minC * cell, height: Math.min(height, (maxR + 1) * cell) - minR * cell };
    regions.push({ ...box, number: 0, mismatchPercent: Math.round((shareSum / cells) * 100), layers: layersAt(box, input.layers) });
  }
  regions.sort((a, b) => b.width * b.height * b.mismatchPercent - a.width * a.height * a.mismatchPercent);
  const shown = regions.slice(0, input.maxRegions ?? 12).map((region, index) => ({ ...region, number: index + 1 }));
  if (regions.length > shown.length) notes.push(`${regions.length - shown.length} smaller differences are not listed.`);

  return {
    matchPercent: comparedPixels ? Math.round((1 - differentPixels / comparedPixels) * 1000) / 10 : 0,
    design: { width, height },
    built: { originalWidth: builtMeta.width, originalHeight: builtMeta.height, scaledHeight: built.height },
    verticalShift,
    regions: shown,
    notes,
    overlay: await sideBySide(input.designRender, input.built, width, height, built.height, verticalShift, shown),
  };
}

/** The most specific visible layers under a region: those mostly inside it, smallest first. */
function layersAt(region: Box, layers: LayerBox[]) {
  const overlap = (layer: Box) => {
    const w = Math.min(region.x + region.width, layer.x + layer.width) - Math.max(region.x, layer.x);
    const h = Math.min(region.y + region.height, layer.y + layer.height) - Math.max(region.y, layer.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  return layers
    .filter((layer) => layer.visible && layer.width > 0 && layer.height > 0)
    .map((layer) => ({ layer, inside: overlap(layer) / (layer.width * layer.height), covers: overlap(layer) / Math.max(1, region.width * region.height) }))
    .filter(({ inside, covers }) => inside >= 0.5 || covers >= 0.6)
    .sort((a, b) => a.layer.width * a.layer.height - b.layer.width * b.layer.height)
    .slice(0, 5)
    .map(({ layer }) => ({ id: layer.id, name: layer.name, type: layer.type, bounds: { x: layer.x, y: layer.y, width: layer.width, height: layer.height } }));
}

async function sideBySide(designRender: Uint8Array, built: Uint8Array, width: number, height: number, builtHeight: number, shift: number, regions: ImplementationCheck["regions"]) {
  const gap = 16;
  const label = 28;
  const panelHeight = Math.max(height, builtHeight);
  const canvasWidth = width * 2 + gap;
  const canvasHeight = panelHeight + label;
  const designPanel = await sharp(designRender).resize({ width, height, fit: "fill" }).png().toBuffer();
  const builtPanel = await sharp(built).flatten({ background: "#ffffff" }).resize({ width }).png().toBuffer();
  const boxes = regions.map((region) => {
    const rect = (offsetX: number, offsetY: number) => `<rect x="${region.x + offsetX}" y="${region.y + offsetY + label}" width="${region.width}" height="${region.height}" fill="rgba(239,68,68,0.12)" stroke="#EF4444" stroke-width="2"/>`;
    const tag = (offsetX: number, offsetY: number) => `<rect x="${region.x + offsetX}" y="${Math.max(label, region.y + offsetY + label - 16)}" width="20" height="16" fill="#EF4444"/><text x="${region.x + offsetX + 10}" y="${Math.max(label, region.y + offsetY + label - 16) + 12}" font-family="Arial" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${region.number}</text>`;
    return rect(0, 0) + tag(0, 0) + rect(width + gap, shift) + tag(width + gap, shift);
  }).join("");
  const svg = Buffer.from(`<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg"><text x="4" y="19" font-family="Arial" font-size="14" font-weight="700" fill="#111">Design</text><text x="${width + gap + 4}" y="19" font-family="Arial" font-size="14" font-weight="700" fill="#111">Build</text>${boxes}</svg>`);
  let image = sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#F4F4F5" } })
    .composite([
      { input: designPanel, left: 0, top: label },
      { input: builtPanel, left: width + gap, top: label },
      { input: svg, left: 0, top: 0 },
    ])
    .png();
  // Keep the picture readable but light for the AI's context.
  const bytes = await image.toBuffer();
  if (canvasWidth > 1600) image = sharp(bytes).resize({ width: 1600 }).png({ compressionLevel: 9 });
  else image = sharp(bytes).png({ compressionLevel: 9 });
  return image.toBuffer();
}
