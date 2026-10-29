// Draws the cel-shaded 12th Doctor's sonic screwdriver cursor and writes public/cursor/sonic{,-lit}{,@2x}.png.
// The only difference between the two states is the emitter glass: smoked grey vs lit blue.
// usage: node scripts/cursor.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SIZE = 64 // CSS px; the 2x image is 128 px, the largest cursor browsers accept
const TIP = 5 // hotspot (x = y), must match the hotspot in style.css
const ANGLE = -40 // degrees: the body runs down-right from the tip

// Cel bands across each part's width: shadow, mid, lit, highlight, lit.
const PALETTE = {
  blue: ['#18339a', '#2a52d8', '#5f86f0', '#cdd9ff'],
  silver: ['#737a85', '#b4bbc5', '#e2e6eb', '#ffffff'],
  gold: ['#80591f', '#c09040', '#e8c27a', '#fff1cc'],
  glass: ['#191c21', '#2b2f36', '#3c424b', '#68707b'],
  lit: ['#4f8cff', '#9fd0ff', '#e2f3ff', '#ffffff'],
}
const STOPS = [0, 0.3, 0.3, 0.72, 0.72, 0.86, 0.86, 0.92, 0.92, 1]
const BAND = [0, 0, 1, 1, 2, 2, 3, 3, 2, 2]

// Parts drawn tip-first along +y (0 = emitter tip), centred on x = 0: [y, height, width, material].
const PARTS = [
  [0, 3.5, 5.2, 'blue'],
  [3.5, 12, 5.4, 'GLASS'],
  [6.2, 1.3, 7, 'blue'],
  [12, 1.3, 7, 'blue'],
  [15.5, 1.5, 7.8, 'gold'],
  [17, 2, 8.3, 'silver'],
  [19, 12, 6.8, 'blue'],
  [31, 1.5, 8.4, 'gold'],
  [33, 1.5, 8.4, 'gold'],
  [34.5, 2, 7.4, 'silver'],
  [36.5, 15, 6, 'blue'],
  [51.5, 2.5, 7.4, 'silver'],
  [54, 6.5, 5.2, 'silver'],
  [60.5, 3, 5, 'blue'],
  [63.5, 2, 5.2, 'gold'],
  [65.5, 4.5, 5, 'silver'],
]

function svg(lit) {
  const glass = lit ? 'lit' : 'glass'
  const grads = Object.entries(PALETTE)
    .map(([k, c]) => `<linearGradient id="${k}" x1="0" x2="1">${STOPS.map((o, i) => `<stop offset="${o}" stop-color="${c[BAND[i]]}"/>`).join('')}</linearGradient>`)
    .join('')
  const rect = (y, h, w, m, extra = '') => `<rect x="${-w / 2}" y="${y}" width="${w}" height="${h}" rx="${Math.min(1, w / 6)}" fill="url(#${m === 'GLASS' ? glass : m})" ${extra}/>`
  const body = PARTS.map(([y, h, w, m]) => rect(y, h, w, m)).join('')
  // Blue cage ribs over the glass, silver slider plate and claws, the silver grip cage, gold slot, knurling.
  const ribs = [-1.75, 1.75].map((x) => `<rect x="${x - 0.3}" y="3.5" width="0.6" height="12" fill="url(#blue)"/>`).join('')
  const cage = [-1, 1]
    .map((s) => `<path d="M ${s * 3} 37 L ${s * 4.6} 39.5 L ${s * 4.6} 48.5 L ${s * 3} 51" fill="none" stroke="url(#silver)" stroke-width="1.4"/>`)
    .join('')
  const plate = `<rect x="-1.4" y="21" width="2.8" height="6.5" rx="0.6" fill="url(#silver)"/>`
  const claws = [-1, 1].map((s) => `<rect x="${s > 0 ? 3.2 : -5.4}" y="19.5" width="2.2" height="3.5" rx="0.6" fill="url(#silver)"/>`).join('')
  const slot = `<rect x="-0.75" y="40" width="1.5" height="8" rx="0.5" fill="url(#gold)"/>`
  const knurl = Array.from({ length: 5 }, (_, i) => `<line x1="-2.6" x2="2.6" y1="${55.2 + i * 1.1}" y2="${55.2 + i * 1.1}" stroke="#4b515a" stroke-width="0.45"/>`).join('')
  const lens = `<ellipse cx="0" cy="0.4" rx="1.6" ry="0.9" fill="url(#${glass})"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>${grads}</defs>
<g transform="translate(${TIP} ${TIP}) rotate(${ANGLE})" stroke="#05070c" stroke-width="0.9" stroke-linejoin="round" paint-order="stroke">
${body}${ribs}${plate}${claws}${cage}${slot}${knurl}${lens}
</g></svg>`
}

mkdirSync('public/cursor', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
for (const scale of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: scale })
  for (const lit of [false, true]) {
    await page.setContent(`<body style="margin:0;background:transparent">${svg(lit)}</body>`)
    const name = `sonic${lit ? '-lit' : ''}${scale === 2 ? '@2x' : ''}.png`
    await page.screenshot({ path: `public/cursor/${name}`, omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } })
    console.log('wrote', name)
  }
  await page.close()
}
await browser.close()
