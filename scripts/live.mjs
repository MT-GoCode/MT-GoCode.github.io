// Checks the deployed site, https://mt-gocode.github.io/: every file it needs serves, the scene loads (the loader lifts),
// and a deep link lands at the monitor with its thing lit. Exits non-zero on any failure. usage: node scripts/live.mjs
import { chromium } from 'playwright'
import { SITE_URL } from '../src/spec.js'

let failed = false
const check = (ok, what) => {
  failed ||= !ok
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
}
for (const path of ['', 'llms.txt', 'stars.bin', 'favicon.svg', 'google98ba5361df0e8071.html']) {
  const res = await fetch(SITE_URL + path, { cache: 'no-store' })
  check(res.ok, `${SITE_URL}${path} serves (${res.status})`)
}
const html = await (await fetch(SITE_URL, { cache: 'no-store' })).text()
check(html.includes('data-anchor="pacemaker"') && !html.includes('%CARD%'), 'the served page is the built site, screen rendered in')
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${SITE_URL}#pacemaker`)
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 })
await page.waitForTimeout(1000)
const at = await page.evaluate(() => ({
  landed: scrollY === document.documentElement.scrollHeight - innerHeight && document.getElementById('card').style.visibility === 'visible',
  lit: [...document.querySelectorAll('#card .lit')].map((e) => e.dataset.anchor).join(),
}))
check(at.landed && at.lit === 'pacemaker', `#pacemaker lands at the monitor, ${at.lit} lit`)
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
await page.screenshot({ path: '../artifacts/live-pacemaker.png' })
await browser.close()
process.exit(failed ? 1 : 0)
