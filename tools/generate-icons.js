const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc(height * (1 + stride));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + stride)] = 0;
        rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}
function sdBox(px, py, cx, cy, hw, hh) {
    const dx = Math.abs(px - cx) - hw;
    const dy = Math.abs(py - cy) - hh;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
    const qx = Math.abs(px - cx) - (hw - r);
    const qy = Math.abs(py - cy) - (hh - r);
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function sdAnnulus(px, py, cx, cy, rOuter, rInner) {
    const d = Math.hypot(px - cx, py - cy);
    const rMid = (rOuter + rInner) / 2;
    return Math.abs(d - rMid) - (rOuter - rInner) / 2;
}

function drawIcon(size, rounded) {
    const buf = Buffer.alloc(size * size * 4);
    const bg = [10, 10, 10];
    const fg = [255, 255, 255];
    const aa = 1.5;
    const cornerR = 0.195 * size;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const px = x + 0.5, py = y + 0.5;
            const rectD = sdRoundedRect(px, py, size / 2, size / 2, size / 2, size / 2, cornerR);
            const mask = rounded ? smoothstep(0, aa, -rectD) : 1;
            if (mask <= 0) { buf.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 4); continue; }

            const stemD = sdBox(px, py, 0.245 * size, 0.5 * size, 0.055 * size, 0.33 * size);
            const topD = sdAnnulus(px, py, 0.44 * size, 0.335 * size, 0.135 * size, 0.065 * size);
            const botD = sdAnnulus(px, py, 0.44 * size, 0.665 * size, 0.135 * size, 0.065 * size);
            const letterD = Math.min(stemD, topD, botD);
            const cov = smoothstep(0, aa, -letterD) * mask;

            const i = (y * size + x) * 4;
            buf[i] = Math.round(bg[0] + (fg[0] - bg[0]) * cov);
            buf[i + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * cov);
            buf[i + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * cov);
            buf[i + 3] = 255;
        }
    }
    return buf;
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'icon-192.png'), encodePNG(192, 192, drawIcon(192, true)));
fs.writeFileSync(path.join(root, 'icon-512.png'), encodePNG(512, 512, drawIcon(512, true)));
fs.writeFileSync(path.join(root, 'icon-512-maskable.png'), encodePNG(512, 512, drawIcon(512, false)));
console.log('OK: icon-192.png, icon-512.png, icon-512-maskable.png');
