// Checks the end of the scroll, per device: (1) the page sits exactly on the monitor's screen: with it hidden,
// the monitor's black glass is found in a screenshot and must match the page's rectangle; (2) the monitor's frame
// exactly fills the window: the bezel showing at all four edges must be exactly its known width, and between the glass and the
// window's edge there must be only frame: no dark pixel of its ink outline or of the room behind. Also after a resize.
// Exits non-zero on any failure.
// usage: node scripts/monitor.mjs [outDir]
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync } from 'node:fs'
import { MONITOR, SCRUB } from '../src/spec.js'

const out = process.argv[2] ?? 'artifacts/monitor'
mkdirSync(out, { recursive: true })
const server = await preview({ preview: { port: 4173, strictPort: true } })
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] })

const CASES = [
  { name: 'laptop', opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: 'phone', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'laptop-resized', opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, resize: { width: 1000, height: 1000 } },
]
const TOLERANCE = 1 // CSS px: the glass and the page are each rasterised to whole device pixels

let failed = false
for (const { name, opts, resize } of CASES) {
  const page = await browser.newPage(opts)
  await page.goto('http://localhost:4173/')
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 })
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(SCRUB * 1000 + 2300) // the scrub catching up, then a margin
  if (resize) {
    await page.setViewportSize(resize)
    await page.waitForTimeout(SCRUB * 1000 + 2300) // the refresh, then the scrub catching up
  }
  const card = await page.evaluate(() => {
    const r = document.getElementById('card').getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  })
  await page.addStyleTag({ content: '#card { visibility: hidden !important }' })
  await page.waitForTimeout(200)
  const shot = await page.screenshot({ path: `${out}/${name}-glass.png` })
  // The glass is the black rectangle around the window's centre: walk out from the centre to where black ends.
  const glass = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(img.width, img.height)
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const black = (x, y) => {
      const i = (y * img.width + x) * 4
      return d[i] + d[i + 1] + d[i + 2] < 24
    }
    const cx = img.width >> 1
    const cy = img.height >> 1
    const walk = (dx, dy) => {
      let x = cx
      let y = cy
      while (x + dx >= 0 && x + dx < img.width && y + dy >= 0 && y + dy < img.height && black(x + dx, y + dy)) {
        x += dx
        y += dy
      }
      return dx ? x : y
    }
    const k = img.width / innerWidth // device px per CSS px
    const l = walk(-1, 0)
    const r = walk(1, 0)
    const t = walk(0, -1)
    const b = walk(0, 1)
    // Dark pixels in the bezel band along each side's midline (skipping 2 px of antialiased glass edge).
    let dark = 0
    const band = (x0, x1, y0, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (black(x, y)) dark++
    }
    band(0, l - 3, cy, cy)
    band(r + 3, img.width - 1, cy, cy)
    band(cx, cx, 0, t - 3)
    band(cx, cx, b + 3, img.height - 1)
    return { left: l / k, right: (r + 1) / k, top: t / k, bottom: (b + 1) / k, width: innerWidth, height: innerHeight, dark }
  }, shot.toString('base64'))
  const onScreen = ['left', 'top', 'right', 'bottom'].map((s) => Math.abs(card[s] - glass[s]))
  const bezel = [glass.left, glass.top, glass.width - glass.right, glass.height - glass.bottom]
  // The bezel's width is known exactly: the frame's height spans the window, so bezel px = bezel m * window px / frame m.
  const frameH = MONITOR.diagonal / Math.hypot(1, glass.width / glass.height)
  const expected = (MONITOR.bezel * glass.height) / frameH
  const fills = bezel.every((b) => Math.abs(b - expected) <= TOLERANCE) && glass.dark === 0
  const sits = Math.max(...onScreen) <= TOLERANCE
  failed ||= !(fills && sits)
  console.log(`${sits ? 'PASS' : 'FAIL'} ${name} page on screen: worst edge off by ${Math.max(...onScreen).toFixed(2)} px`)
  console.log(`${fills ? 'PASS' : 'FAIL'} ${name} frame fills window: bezel ${bezel.map((b) => b.toFixed(1)).join(' / ')} px (l/t/r/b; expected ${expected.toFixed(1)}), ${glass.dark} dark px in it`)
  await page.close()
}
await browser.close()
server.httpServer.close()
process.exit(failed ? 1 : 0)
