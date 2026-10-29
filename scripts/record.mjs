// Records a human-paced wheel scroll from top to bottom of the built site, for reviewing the cinematic by eye. A report,
// not a test: its spike list includes real fast motion (doors sweeping past), so it never fails; smooth.mjs is the test.
// usage: node scripts/record.mjs [outDir]   -> outDir/scroll.webm (+ scroll.mp4, contact.png via ffmpeg)
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const out = process.argv[2] ?? 'artifacts'
mkdirSync(out, { recursive: true })
const server = await preview({ preview: { port: 4173, strictPort: true } })
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${out}/video-tmp`, size: { width: 1280, height: 800 } } })
const page = await ctx.newPage()
await page.goto('http://localhost:4173/')
await page.waitForTimeout(3000)
await page.mouse.move(640, 400)
const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
for (let y = 0; y < total; y += 14) {
  await page.mouse.wheel(0, 14)
  await page.waitForTimeout(16)
}
await page.waitForTimeout(3000)
await ctx.close()
await browser.close()
server.httpServer.close()
const [webm] = readdirSync(`${out}/video-tmp`)
renameSync(`${out}/video-tmp/${webm}`, `${out}/scroll.webm`)
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${out}/scroll.webm`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${out}/scroll.mp4`])
// 30 evenly spaced frames across the whole recording.
const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${out}/scroll.mp4`]))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${out}/scroll.mp4`, '-vf', `fps=30/${seconds},scale=320:-1,tile=6x5`, '-frames:v', '1', `${out}/contact.png`])
console.log('wrote', `${out}/scroll.mp4`, `${out}/contact.png`)

// Discontinuity report: a frame whose change from the previous one is far above its neighbours' is a snap.
execFileSync('ffmpeg', ['-loglevel', 'error', '-i', `${out}/scroll.mp4`, '-vf', `scale=160:-1,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${out}/diff.txt`, '-f', 'null', '-'])
const diffs = [...readFileSync(`${out}/diff.txt`, 'utf8').matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const W = 12 // half a second either side at 25 fps
const spikes = diffs
  .map((d, i) => [i / 25, d, median(diffs.slice(Math.max(0, i - W), i).concat(diffs.slice(i + 1, i + 1 + W)))])
  .filter(([t, d, m]) => t > 1 && d > 1 && d > 5 * Math.max(m, 0.05))
console.log(spikes.length ? `SPIKES (t, diff, local median): ${spikes.map(([t, d, m]) => `${t.toFixed(2)}s ${d.toFixed(2)}/${m.toFixed(2)}`).join(', ')}` : 'no discontinuities')
