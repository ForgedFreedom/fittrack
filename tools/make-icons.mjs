// Generates the app icons (PNG) with no dependencies: a white dumbbell on teal.
// Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [15, 118, 110];
const FG = [255, 255, 255];

// Shapes in a 0..1 coordinate space: [x0, y0, x1, y1, cornerRadius]
const SHAPES = [
  [0.22, 0.47, 0.78, 0.53, 0.02],  // bar
  [0.27, 0.33, 0.35, 0.67, 0.03],  // inner plates
  [0.65, 0.33, 0.73, 0.67, 0.03],
  [0.18, 0.39, 0.26, 0.61, 0.03],  // outer plates
  [0.74, 0.39, 0.82, 0.61, 0.03],
];

function inside(x, y) {
  for (const [x0, y0, x1, y1, r] of SHAPES) {
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  }
  return false;
}

function png(size) {
  const SS = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inside((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hits++;
      }
      const a = hits / (SS * SS);
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', png(192));
writeFileSync('icons/icon-512.png', png(512));
writeFileSync('icons/apple-touch-icon.png', png(180));
console.log('icons written');
