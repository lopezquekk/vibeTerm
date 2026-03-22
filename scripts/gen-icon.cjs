#!/usr/bin/env node
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * (1 + w * 4) + 1 + x * 4;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
    }
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (lo, hi, t) => { const x = clamp((t - lo) / (hi - lo), 0, 1); return x * x * (3 - 2 * x); };

function sdfRRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.sqrt(Math.max(qx,0)**2 + Math.max(qy,0)**2) + Math.min(Math.max(qx,qy),0) - r;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay;
  const t = clamp(((px-ax)*dx + (py-ay)*dy) / (dx*dx+dy*dy), 0, 1);
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}

function blend(buf, w, x, y, r, g, b, a) {
  const xi = x|0, yi = y|0;
  if (xi < 0 || xi >= w || yi < 0) return;
  const h = buf.length / (w * 4);
  if (yi >= h) return;
  const i = (yi * w + xi) * 4;
  const sa = a/255, da = buf[i+3]/255;
  const oa = sa + da*(1-sa);
  if (oa < 1e-6) return;
  buf[i]   = (r*sa + buf[i]  *da*(1-sa))/oa + 0.5 | 0;
  buf[i+1] = (g*sa + buf[i+1]*da*(1-sa))/oa + 0.5 | 0;
  buf[i+2] = (b*sa + buf[i+2]*da*(1-sa))/oa + 0.5 | 0;
  buf[i+3] = oa*255 + 0.5 | 0;
}

function drawIcon(W, H) {
  const buf = new Uint8Array(W * H * 4);
  const cx = W/2, cy = H/2, hw = W/2, hh = H/2, r = W*0.215;

  // Background gradient (dark navy → pure dark)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sdf = sdfRRect(x+0.5, y+0.5, cx, cy, hw-0.5, hh-0.5, r);
      if (sdf > 1.5) continue;
      const t = y/H;
      const bgR = lerp(0x11, 0x07, t)|0;
      const bgG = lerp(0x13, 0x08, t)|0;
      const bgB = lerp(0x26, 0x0d, t)|0;
      const alpha = smooth(1.5, -0.5, sdf) * 255;
      blend(buf, W, x, y, bgR, bgG, bgB, alpha);
    }
  }

  // ">_" layout proportions
  const pad = 0.135;
  const iL = pad*W, iT = pad*H, iW = (1-2*pad)*W, iH = (1-2*pad)*H;

  // ">" chevron
  const cTx = iL + iW*0.04,  cTy = iT + iH*0.18;
  const cMx = iL + iW*0.50,  cMy = iT + iH*0.50;
  const cBx = iL + iW*0.04,  cBy = iT + iH*0.82;

  // "_" underscore
  const uX1 = iL + iW*0.60, uX2 = iL + iW*0.96;
  const uY  = iT + iH*0.715;

  const thick = W * 0.074;

  // Accent: #3b82f6 / highlight: #93c5fd
  const aR=0x3b, aG=0x82, aB=0xf6;
  const hR=0x93, hG=0xc5, hB=0xfd;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sdf = sdfRRect(x+0.5, y+0.5, cx, cy, hw-0.5, hh-0.5, r);
      if (sdf > 0) continue;

      const px = x+0.5, py = y+0.5;
      const d1 = distSeg(px, py, cTx, cTy, cMx, cMy);
      const d2 = distSeg(px, py, cMx, cMy, cBx, cBy);
      const dC = Math.min(d1, d2);
      const dU = distSeg(px, py, uX1, uY, uX2, uY);
      const d  = Math.min(dC, dU);

      // Outer glow
      const gR = thick * 4.8;
      if (d < gR) {
        const ga = (1 - d/gR)**1.8 * 0.52;
        blend(buf, W, x, y, aR, aG, aB, ga*255);
      }

      // Stroke
      if (d < thick + 1.5) {
        const sa = smooth(thick+1.5, thick-1, d);
        const t2 = Math.max(0, 1 - d/Math.max(thick-1, 0.1));
        const sr = lerp(aR, hR, t2*0.6)|0;
        const sg = lerp(aG, hG, t2*0.6)|0;
        const sb = lerp(aB, hB, t2*0.6)|0;
        blend(buf, W, x, y, sr, sg, sb, sa*255);
      }
    }
  }

  // Subtle top-edge highlight
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sdf = sdfRRect(x+0.5, y+0.5, cx, cy, hw-0.5, hh-0.5, r);
      if (sdf < -3 || sdf > 0) continue;
      const a = smooth(0, -2.5, sdf) * 0.15;
      const yf = 1 - clamp((y+0.5)/(H*0.35), 0, 1);
      blend(buf, W, x, y, 255, 255, 255, a*yf*255);
    }
  }

  return buf;
}

// Render all sizes
const ICON_DIR = path.join(__dirname, '../src-tauri/icons');
const ICONSET  = path.join(__dirname, '../src-tauri/icon.iconset');
fs.mkdirSync(ICONSET, { recursive: true });
fs.mkdirSync(ICON_DIR, { recursive: true });

const cache = {};
function png(size) {
  if (!cache[size]) {
    process.stdout.write(`  ${size}x${size}... `);
    const t = Date.now();
    cache[size] = encodePNG(size, size, drawIcon(size, size));
    console.log(`${Date.now()-t}ms`);
  }
  return cache[size];
}

console.log('Rendering vibeTerm icon:');

const ICONSET_MAP = [
  ['icon_16x16.png',       16],
  ['icon_16x16@2x.png',    32],
  ['icon_32x32.png',       32],
  ['icon_32x32@2x.png',    64],
  ['icon_128x128.png',    128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png',    256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png',    512],
  ['icon_512x512@2x.png',1024],
];

for (const [name, size] of ICONSET_MAP) {
  fs.writeFileSync(path.join(ICONSET, name), png(size));
}

execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', path.join(ICON_DIR, 'icon.icns')]);
console.log('icon.icns done');

fs.writeFileSync(path.join(ICON_DIR, '32x32.png'),      png(32));
fs.writeFileSync(path.join(ICON_DIR, '128x128.png'),    png(128));
fs.writeFileSync(path.join(ICON_DIR, '128x128@2x.png'), png(256));
console.log('PNG icons done');

// ICO (PNG-embedded, Windows Vista+)
function buildICO(sizes) {
  const frames = sizes.map(sz => png(sz));
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(sizes.length,4);
  const dir = Buffer.alloc(sizes.length * 16);
  let off = 6 + sizes.length * 16;
  for (let i = 0; i < sizes.length; i++) {
    const sz = sizes[i];
    dir[i*16]   = sz >= 256 ? 0 : sz;
    dir[i*16+1] = sz >= 256 ? 0 : sz;
    dir.writeUInt16LE(1,  i*16+4);
    dir.writeUInt16LE(32, i*16+6);
    dir.writeUInt32LE(frames[i].length, i*16+8);
    dir.writeUInt32LE(off, i*16+12);
    off += frames[i].length;
  }
  return Buffer.concat([hdr, dir, ...frames]);
}
fs.writeFileSync(path.join(ICON_DIR, 'icon.ico'), buildICO([16, 32, 48, 256]));
console.log('icon.ico done');

fs.rmSync(ICONSET, { recursive: true });
console.log('\nAll icons generated in src-tauri/icons/');
