'use strict';
// Secure image handling (sections 25, 59).
// Real users upload compressed WebP/JPEG produced client-side via canvas;
// the server validates magic bytes (never trusts the browser MIME), enforces
// size limits and stores outside any executable-served path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ALLOWED = {
  jpg: { magic: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
  png: { magic: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png', ext: 'png' },
  webp: { magicCheck: (b) => b.slice(0, 4).toString('binary') === 'RIFF' && b.slice(8, 12).toString('binary') === 'WEBP', mime: 'image/webp', ext: 'webp' },
};

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  for (const type of Object.values(ALLOWED)) {
    if (type.magicCheck ? type.magicCheck(buf) : type.magic.every((v, i) => buf[i] === v)) return type;
  }
  return null;
}

function saveImage(buf, { root, kind = 'users', maxBytes = 8 * 1024 * 1024 } = {}) {
  const type = sniffImage(buf);
  if (!type) {
    const e = new Error('Only JPEG, PNG or WebP images are accepted');
    e.statusCode = 400;
    throw e;
  }
  if (buf.length > maxBytes) {
    const e = new Error('Image is larger than the allowed file size');
    e.statusCode = 400;
    throw e;
  }
  const ym = new Date().toISOString().slice(0, 7).replace('-', '/');
  const dir = path.join(root, kind, ym);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + type.ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/${kind}/${ym}/${name}`;
}

/** Decode a browser-compressed data URL (from canvas WebP/JPEG) and persist it. */
function saveDataUrl(dataUrl, opts) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) {
    const e = new Error('Invalid image data');
    e.statusCode = 400;
    throw e;
  }
  const buf = Buffer.from(m[2], 'base64');
  return saveImage(buf, opts);
}

module.exports = { sniffImage, saveImage, saveDataUrl, ALLOWED };
