// Checks the whole scroll is smooth, from the camera actually rendered on every animation frame (read from the
// page's 3D placement, src/pages.js: its layer's perspective is the lens in px, the first matrix of its transform the
// camera's inverse world matrix, in CSS px: the page's scene is drawn at px per metre, the frame's height filling the
// window)
// while the page is scrolled top to bottom by the same amount every frame. The page's clock is Playwright's, stepped
// one animation frame (16 ms: its fake requestAnimationFrame's period) at a time, so every frame is exactly that whatever the machine's scheduler does
// (a locked or busy machine throttles a real clock to ~10 fps); any unevenness measured is the shot's, not the input's
// nor the machine's:
//   1. no jump, no jolt, no hitch: no frame's step in camera position or lens, nor the change in that step
//      (a sudden change of speed), nor the real time the page took to run it, is far above those around it;
//   2. no step back: once the camera is square to the doors, it never moves away from them and the lens never
//      narrows (the doorway, then the monitor, only grow);
//   3. the page itself never scrolls backwards while it is scrolled forwards (nothing yanks it back);
//   4. nothing new reaches the GPU after the loader lifts: no shader, program, buffer or texture is created during
//      the scroll (each would stall the frame it happens in). Counted by wrapping WebGL itself, outside the app.
// Exits non-zero on any. Writes every sample to artifacts/smooth-WxH.json. usage: node scripts/smooth.mjs [viewport WxH]
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { MONITOR } from '../src/spec.js'

const [W, H] = (process.argv[2] ?? '1280x800').split('x').map(Number)
const PX_PER_M = H / (MONITOR.diagonal / Math.hypot(1, W / H))
const STEP = 6 // px scrolled per rendered frame: ~360 px/s at 60 fps, an unhurried scroll
// Spike detection, set against two broken builds (a lens hitting its last key at full rate; shaders compiling
// mid-scroll), which scored 10-50x their neighbours on lens jolt and frame time. A loaded machine also spikes frame
// times (it drops frames for everyone), so run this on an otherwise idle machine.
const SPIKE = 6 // a value this many times its neighbours' median is a spike...
// ...if it is also at least this big: per frame, m and px (steps) and m and px (change of step), and frame ms (3 frames)
const FLOOR = { move: 0.01, lens: 1, moveJolt: 0.005, lensJolt: 0.5, ms: 50 }
const WINDOW = 10 // frames either side for the neighbours' median: about a third of a second
const SQUARE = 1e-3 // |camera x| below this (m) = square to the doors, after the orbit

const server = await preview({ preview: { port: 4173, strictPort: true } })
// GPU on, as for a visitor: shaders, buffers and draws are the real ones.
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.addInitScript(() => {
  window.__gpu = { createShader: 0, createProgram: 0, createBuffer: 0, createTexture: 0 }
  for (const name of Object.keys(window.__gpu)) {
    const real = WebGL2RenderingContext.prototype[name]
    WebGL2RenderingContext.prototype[name] = function (...args) {
      window.__gpu[name]++
      return real.apply(this, args)
    }
  }
})
await page.clock.install() // before the page's scripts, so GSAP's ticker takes the controlled requestAnimationFrame
await page.goto('http://localhost:4173/')
await page.waitForFunction(() => !document.getElementById('loader')) // time flows normally while loading
await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
const gpuAtLift = await page.evaluate(() => ({ ...window.__gpu }))
await page.evaluate((pxPerM) => {
  window.__cam = []
  const tick = () => {
    const lens = parseFloat(document.getElementById('pages').style.perspective)
    const css = document.getElementById('card').style.transform
    const m = css.match(/matrix3d\(([^)]+)\)/)[1].split(',').map(Number)
    // The inverse world matrix is written with its y row negated (CSS y points down); undo that, then position = -Rᵀ t.
    const R = [[m[0], -m[1], m[2]], [m[4], -m[5], m[6]], [m[8], -m[9], m[10]]]
    const t = [m[12], -m[13], m[14]]
    window.__cam.push([lens, ...[0, 1, 2].map((i) => -(R[i][0] * t[0] + R[i][1] * t[1] + R[i][2] * t[2]) / pxPerM), 0, scrollY]) // real ms filled in below
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}, PX_PER_M)
// Each frame: scroll by STEP and fire the scroll event the browser would (ScrollTrigger and the app listen on the
// document), then advance the clock one frame, running GSAP's tick, the render and the sampler. The frame's real
// duration is what the page took to run it.
const FRAME = 16
const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
const realMs = []
const drive = async (y) => {
  await page.evaluate((y) => (scrollTo(0, y), document.dispatchEvent(new Event('scroll', { bubbles: true }))), y)
  const t0 = performance.now()
  await page.clock.runFor(FRAME)
  realMs.push(performance.now() - t0)
}
for (let y = STEP; y < max + STEP; y += STEP) await drive(Math.min(max, y))
for (let i = 0; i < 3 * 60; i++) await drive(max) // three seconds for the scrub to settle
const cam = await page.evaluate(() => window.__cam)
if (cam.length !== realMs.length) throw new Error(`${cam.length} frames sampled for ${realMs.length} clock steps: not one frame per step`)
cam.forEach((c, i) => (c[4] = realMs[i]))
const gpuAtEnd = await page.evaluate(() => ({ ...window.__gpu }))
mkdirSync('artifacts', { recursive: true })
writeFileSync(`artifacts/smooth-${W}x${H}.json`, JSON.stringify({ columns: ['lens px', 'x', 'y', 'z', 'real ms', 'scrollY'], cam }))
await browser.close()
server.httpServer.close()

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
// Per frame (each frame scrolls the same amount): the camera's and the lens's step, the change in that step (a
// sudden change of speed is a jolt), and the real time the page took to run the frame (a hitch).
const vel = cam.slice(1).map((c, i) => [c[1] - cam[i][1], c[2] - cam[i][2], c[3] - cam[i][3], c[0] - cam[i][0]]) // x y z lens
const acc = vel.slice(1).map((v, i) => v.map((x, k) => x - vel[i][k]))
const series = {
  move: vel.map((v) => Math.hypot(v[0], v[1], v[2])),
  lens: vel.map((v) => Math.abs(v[3])),
  moveJolt: acc.map((a) => Math.hypot(a[0], a[1], a[2])),
  lensJolt: acc.map((a) => Math.abs(a[3])),
  ms: cam.slice(1).map((c) => c[4]),
}
const jumps = []
for (const [key, values] of Object.entries(series))
  values.forEach((v, i) => {
    const around = values.slice(Math.max(0, i - WINDOW), i).concat(values.slice(i + 1, i + 1 + WINDOW))
    const m = median(around)
    if (v >= FLOOR[key] && v > SPIKE * Math.max(m, 1e-6)) jumps.push(`${key} at frame ${i + 1} (camera z ${cam[i + 1][3].toFixed(2)} m): ${v.toFixed(2)} vs ~${m.toFixed(2)}`)
  })
const backs = []
for (let i = 1; i < cam.length; i++) {
  const [lens, x, , z] = cam[i]
  const [plens, px, , pz] = cam[i - 1]
  if (Math.abs(x) > SQUARE || Math.abs(px) > SQUARE) continue
  if (z > pz + 1e-3) backs.push(`camera backs off at frame ${i}: z ${pz.toFixed(3)} -> ${z.toFixed(3)}`)
  if (lens > plens + 0.5) backs.push(`lens narrows at frame ${i}: ${plens.toFixed(1)} -> ${lens.toFixed(1)} px`)
}
const rewinds = cam.slice(1).flatMap((c, i) => (c[5] < cam[i][5] - 0.5 ? [`frame ${i + 1}: scrollY ${cam[i][5]} -> ${c[5]}`] : []))
console.log(`${cam.length} rendered frames over the scroll (${W}x${H})`)
console.log(jumps.length ? `FAIL spikes:\n  ${jumps.join('\n  ')}` : 'PASS no jumps, jolts or hitches in camera or lens')
console.log(backs.length ? `FAIL steps back:\n  ${backs.slice(0, 12).join('\n  ')}` : 'PASS never steps back once square to the doors')
const late = Object.keys(gpuAtLift).filter((k) => gpuAtEnd[k] !== gpuAtLift[k]).map((k) => `${k} ${gpuAtLift[k]} -> ${gpuAtEnd[k]}`)
console.log(late.length ? `FAIL created on the GPU during the scroll: ${late.join(', ')}` : `PASS nothing new reached the GPU during the scroll (${Object.entries(gpuAtLift).map(([k, v]) => `${v} ${k.slice(6).toLowerCase()}s`).join(', ')} at load)`)
console.log(rewinds.length ? `FAIL page scrolled backwards:\n  ${rewinds.slice(0, 12).join('\n  ')}` : 'PASS page only ever scrolled forwards')
process.exit(jumps.length || backs.length || rewinds.length || late.length ? 1 : 0)
