'use strict';
// Generates license-clean SVG "photos" for seeded demo listings only.
// Real user uploads are raster images processed client-side.
const fs = require('node:fs');
const path = require('node:path');

const PALETTES = {
  camera: ['#16324a', '#0d1f30'],
  lens: ['#2a2440', '#15111f'],
  action: ['#3a2a17', '#1d150c'],
  drone: ['#15302a', '#0c1a16'],
  accessory: ['#33251c', '#1a130e'],
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function glyph(group) {
  const common = 'fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.55)" stroke-width="3"';
  if (group === 'lens') {
    return `<circle cx="600" cy="430" r="210" ${common}/>
      <circle cx="600" cy="430" r="150" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3"/>
      <circle cx="600" cy="430" r="92" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.6)" stroke-width="3"/>
      <circle cx="600" cy="430" r="40" fill="rgba(230,165,70,0.35)"/>`;
  }
  if (group === 'action') {
    return `<rect x="430" y="300" width="340" height="240" rx="34" ${common}/>
      <rect x="470" y="340" width="260" height="150" rx="14" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
      <circle cx="600" cy="415" r="46" fill="rgba(230,165,70,0.30)" stroke="rgba(255,255,255,0.55)" stroke-width="3"/>`;
  }
  if (group === 'drone') {
    return `<line x1="380" y1="300" x2="540" y2="420" stroke="rgba(255,255,255,0.5)" stroke-width="6"/>
      <line x1="820" y1="300" x2="660" y2="420" stroke="rgba(255,255,255,0.5)" stroke-width="6"/>
      <circle cx="350" cy="280" r="64" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="5"/>
      <circle cx="850" cy="280" r="64" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="5"/>
      <rect x="520" y="390" width="160" height="110" rx="26" ${common}/>
      <circle cx="600" cy="445" r="30" fill="rgba(230,165,70,0.30)"/>`;
  }
  if (group === 'accessory') {
    return `<line x1="600" y1="250" x2="600" y2="560" stroke="rgba(255,255,255,0.55)" stroke-width="8"/>
      <line x1="470" y1="560" x2="730" y2="560" stroke="rgba(255,255,255,0.55)" stroke-width="8"/>
      <rect x="470" y="210" width="260" height="80" rx="18" ${common}/>`;
  }
  // camera body
  return `<rect x="350" y="330" width="500" height="250" rx="38" ${common}/>
    <rect x="470" y="275" width="150" height="80" rx="18" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.55)" stroke-width="3"/>
    <circle cx="600" cy="455" r="120" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.6)" stroke-width="4"/>
    <circle cx="600" cy="455" r="72" fill="rgba(230,165,70,0.28)" stroke="rgba(255,255,255,0.55)" stroke-width="3"/>
    <circle cx="785" cy="385" r="16" fill="rgba(255,255,255,0.5)"/>`;
}

function generate({ group, title, angle, file }) {
  const [c1, c2] = PALETTES[group] || PALETTES.camera;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="1200" height="900" fill="url(#g)"/>
  ${glyph(group)}
  <text x="60" y="110" font-family="Arial, sans-serif" font-size="26" fill="rgba(255,255,255,0.65)" letter-spacing="4">LANKA LENS · DEMO IMAGE</text>
  <text x="1140" y="110" text-anchor="end" font-family="Arial, sans-serif" font-size="26" fill="rgba(230,165,70,0.95)">${esc(angle || '')}</text>
  <text x="60" y="800" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="#ffffff">${esc(title)}</text>
  <text x="60" y="845" font-family="Arial, sans-serif" font-size="24" fill="rgba(255,255,255,0.7)">Sri Lanka camera marketplace — sample photo</text>
</svg>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
}

const ANGLES = ['Front view', 'Back / LCD', 'Top plate', 'Lens mount', 'Side view', 'Accessories', 'Original box'];

/** Create a stable set of demo photos; returns public URLs. */
function demoPhotoSet(root, group, key, count = 6) {
  const dir = path.join(root, 'seed');
  const urls = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `${key}-${i}.svg`);
    if (!fs.existsSync(file)) {
      generate({ group, title: key.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), angle: ANGLES[i] || `Photo ${i + 1}`, file });
    }
    urls.push(`/uploads/seed/${key}-${i}.svg`);
  }
  return urls;
}

module.exports = { demoPhotoSet, generate };
