import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// Original code-drawn app mark: three strokes matching the existing navigation brand.
const n = 256;
const pixels = Buffer.alloc(n * n * 4);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const i = ((n - y - 1) * n + x) * 4;
  const rounded = (left, top, width, height, radius) => {
    const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
    const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
    return x >= left && x < left + width && y >= top && y < top + height && dx * dx + dy * dy <= radius * radius;
  };
  let color = [0, 0, 0, 0];
  if (rounded(8, 8, 240, 240, 48)) color = [244, 240, 229, 255];
  if ([67, 116, 165].some(top => rounded(55, top, 146, 23, 6))) color = [42, 74, 63, 255];
  pixels[i] = color[2]; pixels[i + 1] = color[1]; pixels[i + 2] = color[0]; pixels[i + 3] = color[3];
}
const dib = Buffer.alloc(40); dib.writeUInt32LE(40); dib.writeInt32LE(n, 4); dib.writeInt32LE(n * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels.length, 20);
const mask = Buffer.alloc(n * n / 8);
const payload = Buffer.concat([dib, pixels, mask]);
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(payload.length, 14); header.writeUInt32LE(22, 18);
const directory = fileURLToPath(new URL('./assets/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(new URL('./assets/icon.ico', import.meta.url), Buffer.concat([header, payload]));
