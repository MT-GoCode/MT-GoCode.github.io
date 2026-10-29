// Time until the visitor sees the scene (the loader lifts) on a throttled phone profile, against ./dist served gzipped
// (as GitHub Pages does). Fails over BUDGET. usage: node scripts/loadtime.mjs
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join } from 'node:path'

// Time from navigation to the loader lifting, on this throttled phone, the visitor may wait. Minh's bar: nobody on a
// mobile connection waits anything like half a minute; measured 2.1 s for the first frame before the warm-up existed.
const BUDGET = 5000
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' }
const server = createServer((req, res) => {
  let f = join('dist', decodeURIComponent(req.url.split('?')[0]))
  if (f.endsWith('/')) f += 'index.html'
  if (!existsSync(f)) return res.writeHead(404).end()
  const body = gzipSync(readFileSync(f))
  res.writeHead(200, { 'content-length': body.length, 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', 'content-encoding': 'gzip' }).end(body)
}).listen(4174)

// Lighthouse "slow 4G" mobile profile: 1.6 Mbps down, 150 ms RTT, 4x CPU slowdown.
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 })
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
const t0 = Date.now()
await page.goto('http://localhost:4174/', { waitUntil: 'commit' })
await page.waitForSelector('#for-agents', { state: 'attached' })
const text = Date.now() - t0
// The moment the visitor sees the scene: the loader gone, everything warmed up behind it.
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 120000, polling: 50 })
const frame = Date.now() - t0
const res = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => [e.name.split('/').pop(), Math.round(e.transferSize / 1024), Math.round(e.responseEnd)]))
for (const [n, kb, end] of res) console.log(`  ${n}: ${kb} KB, done at ${end} ms`)
console.log(`html+text ${text} ms | scene shown ${frame} ms | ${res.reduce((a, r) => a + r[1], 0)} KB transferred`)
console.log(`${frame <= BUDGET ? 'PASS' : 'FAIL'} scene shown within ${BUDGET} ms`)
await browser.close()
server.close()
process.exit(frame <= BUDGET ? 0 : 1)
