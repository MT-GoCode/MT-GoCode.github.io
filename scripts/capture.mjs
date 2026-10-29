// Renders the built site in real Chrome: the page before scripts, each scroll progress point, and the automation view.
// Fails if the agent text shows on screen before scripts run, or automation does not see its banner on top.
// usage: [VIEW=phone] [PROGRESS=0,0.5,...] node scripts/capture.mjs [outDir] [url]   (default: vite preview of ./dist)
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync } from 'node:fs'
import { SCRUB } from '../src/spec.js'

const out = process.argv[2] ?? 'artifacts'
// Laptop by default; VIEW=phone is a portrait iPhone-sized touch screen.
const VIEW = { laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } }[process.env.VIEW ?? 'laptop']
if (!VIEW) throw new Error(`VIEW must be laptop or phone, got ${process.env.VIEW}`)
mkdirSync(out, { recursive: true })
let url = process.argv[3]
const server = url ? null : await preview({ preview: { port: 4173, strictPort: true } })
url ??= 'http://localhost:4173/'

// AutomationControlled off = what a human's browser reports (navigator.webdriver false).
const human = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled', '--use-angle=metal', '--enable-gpu'] })
const page = await human.newPage(VIEW)
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()))
page.on('pageerror', (e) => console.log('page error:', e.message))
// Before any script runs: only the loader may be visible.
const nojs = await human.newPage({ ...VIEW, javaScriptEnabled: false })
await nojs.goto(url)
await nojs.screenshot({ path: `${out}/before-scripts.png` })
const agentTextShows = await nojs.evaluate(() => { const r = document.getElementById('for-agents').getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight })
console.log(`${agentTextShows ? 'FAIL' : 'PASS'} agent text kept off screen before scripts run`)
await nojs.close()
await page.goto(url)
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 })
console.log('loader removed')
await page.waitForTimeout(1500)
const progress = (process.env.PROGRESS ?? '0,0.15,0.3,0.45,0.55,0.62,0.7,0.78,0.86,0.93,1').split(',').map(Number)
for (const p of progress) {
  await page.evaluate((p) => scrollTo(0, p * (document.documentElement.scrollHeight - innerHeight)), p)
  await page.waitForTimeout(SCRUB * 1000 + 1400) // the scrub catching up, then a margin
  await page.screenshot({ path: `${out}/scroll-${p.toFixed(2)}.png` })
  console.log('shot', p)
}
await human.close()

// Default automation flags = what an agent's Playwright reports.
const bot = await chromium.launch({ channel: 'chrome' })
const bp = await bot.newPage({ viewport: { width: 1440, height: 900 } })
await bp.goto(url)
await bp.waitForTimeout(1500)
// On top, not merely present: the topmost element at the banner's centre must be the banner.
const bannerOnTop = await bp.evaluate(() => { const r = document.getElementById('robot').getBoundingClientRect(); return r.height > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id === 'robot' })
console.log(`${bannerOnTop ? 'PASS' : 'FAIL'} automation sees the banner on top`)
console.log('aria snapshot of agent section:\n' + (await bp.locator('#for-agents').ariaSnapshot()))
await bp.screenshot({ path: `${out}/robot.png` })
await bot.close()
server?.httpServer.close()
process.exit(agentTextShows || !bannerOnTop ? 1 : 0)
