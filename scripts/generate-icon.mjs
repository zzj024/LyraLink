import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const size = 256;
const pixels = Buffer.alloc(size * size * 4);

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width - 1;
  const bottom = top + height - 1;
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return x >= left && x <= right && y >= top && y <= bottom &&
    dx * dx + dy * dy <= radius * radius;
}

function paint(x, y, red, green, blue, alpha = 255) {
  const bottomUpY = size - 1 - y;
  const offset = (bottomUpY * size + x) * 4;
  pixels[offset] = blue;
  pixels[offset + 1] = green;
  pixels[offset + 2] = red;
  pixels[offset + 3] = alpha;
}

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    if (insideRoundedRect(x, y, 10, 10, 236, 236, 52)) {
      paint(x, y, 32, 33, 30);
    }
    if (insideRoundedRect(x, y, 52, 52, 152, 152, 38)) {
      paint(x, y, 231, 255, 87);
    }
    if ((x >= 98 && x < 120 && y >= 82 && y < 168) ||
        (x >= 98 && x < 165 && y >= 148 && y < 168)) {
      paint(x, y, 24, 25, 22);
    }
  }
}

const maskStride = Math.ceil(size / 32) * 4;
const mask = Buffer.alloc(maskStride * size);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const pixelOffset = ((size - 1 - y) * size + x) * 4;
    if (pixels[pixelOffset + 3] !== 0) continue;
    const maskOffset = y * maskStride + Math.floor(x / 8);
    mask[maskOffset] |= 1 << (7 - (x % 8));
  }
}

const bitmapHeader = Buffer.alloc(40);
bitmapHeader.writeUInt32LE(40, 0);
bitmapHeader.writeInt32LE(size, 4);
bitmapHeader.writeInt32LE(size * 2, 8);
bitmapHeader.writeUInt16LE(1, 12);
bitmapHeader.writeUInt16LE(32, 14);
bitmapHeader.writeUInt32LE(0, 16);
bitmapHeader.writeUInt32LE(pixels.length, 20);

const image = Buffer.concat([bitmapHeader, pixels, mask]);
const iconHeader = Buffer.alloc(6);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(1, 4);
const directoryEntry = Buffer.alloc(16);
directoryEntry[0] = 0;
directoryEntry[1] = 0;
directoryEntry.writeUInt16LE(1, 4);
directoryEntry.writeUInt16LE(32, 6);
directoryEntry.writeUInt32LE(image.length, 8);
directoryEntry.writeUInt32LE(iconHeader.length + directoryEntry.length, 12);

const output = path.resolve("resources", "icon.ico");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([iconHeader, directoryEntry, image]));
console.log(`Generated ${output}`);
