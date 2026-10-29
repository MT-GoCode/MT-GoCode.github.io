// Checks the monitor's screen at the end of the scroll, per device, as a visitor uses it, against what was asked for
// (EXPECTED, written here, not read from the site's content):
//   1. the grid: 2 rows of 3 cells, every one square on screen and inside the screen, labelled as asked; the cells
//      with nothing are greyed and do nothing when clicked;
//   2. hover (laptop): the cell's border turns neon blue on screen and its label comes up, only that cell's;
//      touch (phone): the labels are up without hovering;
//   3. keyboard (Chrome laptop; Safari does not Tab to links by default): Tab walks the cells in order, Enter opens a
//      page, Tab reaches its back button, Enter comes back;
//   4. a link cell opens its URL in a new tab; a page cell opens its page alone, listing exactly what was asked, with
//      a back button top left that comes back to the grid; each item's link opens its URL in a new tab, and the
//      email link is clicked through to a mailto: of the address in this tab (caught before it leaves the page: a
//      real mailto: launches the machine's mail app);
//   5. none of it moves the page's scroll: the visitor keeps their place in the TARDIS;
//   6. /llms.txt carries everything the screen shows: every link and every title;
//   7. anchors: a link to each thing (#pacemaker, #linkedin, #projects, ...) opened fresh lands at the monitor with that
//      page up and that thing, alone, lit and on screen (neon in pixels); in a session, the screen's links set the hash
//      and the browser's back and forward walk the screens, the page's scroll never moving.
// Exits non-zero on any failure. usage: node scripts/card.mjs [outDir] [chrome | webkit (Safari's engine)]
import { chromium, webkit } from 'playwright'
import { preview } from 'vite'
import { mkdirSync } from 'node:fs'
import { SCRUB } from '../src/spec.js'

const out = process.argv[2] ?? 'artifacts/card'
mkdirSync(out, { recursive: true })
const server = await preview({ preview: { port: 4173, strictPort: true } })
const engine = process.argv[3] ?? 'chrome'
const browser = await { chrome: () => chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] }), webkit: () => webkit.launch() }[engine]()
const CASES = [
  { name: `${engine}-laptop`, touch: false, opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: `${engine}-phone`, touch: true, opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
]

const QOL = 'https://github.com/MT-GoCode/minh-qol-utilities/tree/main'
const EXPECTED = {
  tiles: ['LinkedIn', 'GitHub', 'Side projects', 'Contact'],
  links: ['https://www.linkedin.com/in/minh-trinh-26744a1b0/', 'https://github.com/MT-GoCode'],
  // per page: its items' [link text, href]
  pages: {
    projects: [['irreproachable', `${QOL}/irreproachable`], ['pacemaker', `${QOL}/pacemaker`], ['elucidate-8B', 'https://huggingface.co/freshminttt/elucidate']],
    contact: [['minhtr@g.ucla.edu', 'mailto:minhtr@g.ucla.edu']],
  },
  // anchor: the page it shows, and what it lights (a grid cell, a list entry, or nothing)
  anchors: {
    linkedin: ['home', 'cell'],
    github: ['home', 'cell'],
    projects: ['projects', null],
    contact: ['contact', null],
    irreproachable: ['projects', 'entry'],
    pacemaker: ['projects', 'entry'],
    'elucidate-8b': ['projects', 'entry'],
  },
}

let failed = false
const check = (ok, what) => {
  failed ||= !ok
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
}

for (const { name, touch, opts } of CASES) {
  const context = await browser.newContext(opts)
  // As a visitor's browser, not an automated one (Chrome: the launch flag): no agent banner over the screen.
  await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }))
  // Every click on a mailto: link is recorded and stopped here, so no mail app is ever launched.
  await context.addInitScript(() =>
    addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href^="mailto:"]')
      if (!a) return
      e.preventDefault()
      window.__mailto = { href: a.getAttribute('href'), newTab: a.target === '_blank' }
    }),
  )
  // Outside pages answered locally: the test is that the tab opens on the right URL, not that the site is up.
  await context.route(/^https:\/\/(www\.linkedin\.com|github\.com|huggingface\.co)\//, (r) => r.fulfill({ body: 'ok', contentType: 'text/plain' }))
  const page = await context.newPage()
  await page.goto('http://localhost:4173/')
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 })
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(SCRUB * 1000 + 2300) // the scrub catching up, then a margin
  const scrollAtEnd = await page.evaluate(() => scrollY)

  // 1. The grid, as laid out on screen.
  const cells = await page.$$eval('#card .tile', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height, empty: e.classList.contains('empty'), tag: e.tagName }
    }),
  )
  const screen = await page.evaluate(() => {
    const r = document.getElementById('card').getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }
  })
  const rows = [...new Set(cells.map((c) => Math.round(c.y)))]
  const columns = [...new Set(cells.map((c) => Math.round(c.x)))]
  check(cells.length === 6 && rows.length === 2 && columns.length === 3, `${name} grid is 2 rows of 3: ${cells.length} cells, ${rows.length} rows, ${columns.length} columns`)
  const worst = Math.max(...cells.map((c) => Math.abs(c.w - c.h)))
  check(worst <= 1, `${name} every cell square on screen: worst |w - h| ${worst.toFixed(2)} px (cells ${cells[0].w.toFixed(0)} px)`)
  const inside = cells.every((c) => c.x >= screen.left && c.y >= screen.top && c.x + c.w <= screen.right && c.y + c.h <= screen.bottom)
  check(inside, `${name} every cell inside the screen`)
  const empties = cells.filter((c) => c.empty)
  check(empties.length === 2 && empties.every((c) => c.tag === 'SPAN'), `${name} two greyed cells, neither a link nor a button`)
  const labels = await page.$$eval('#card .tile:not(.empty) span', (els) => els.map((e) => e.textContent))
  check(labels.join() === EXPECTED.tiles.join(), `${name} cells labelled ${labels.join(', ')}`)
  const tiles = cells.flatMap((c, i) => (c.empty ? [] : [i])) // indices of the cells with something
  await page.screenshot({ path: `${out}/${name}-grid.png` })

  // The share of points along a box's edges (all four sides, or the left one only; corners skipped) where it is neon:
  // the hover and lit colour, #38b6ff. At each point a 3 px band across the edge is scanned: edges fall on fractional
  // pixels.
  const neonOnEdges = async (pg, c, leftOnly = false) => {
    const shot = await pg.screenshot({ clip: { x: c.x - 2, y: c.y - 2, width: c.w + 4, height: c.h + 4 } })
    return pg.evaluate(
      async ({ b64, w, h, leftOnly }) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const g = new OffscreenCanvas(img.width, img.height).getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, img.width, img.height).data
        const k = img.width / (w + 4)
        const at = (x, y) => {
          const i = (Math.round(y * k) * img.width + Math.round(x * k)) * 4
          return [d[i], d[i + 1], d[i + 2]]
        }
        const isNeon = ([r, gr, b]) => r < 120 && gr > 140 && b > 200
        const across = [-1, -0.5, 0, 0.5, 1, 1.5, 2] // px inward from the edge
        // [x, y] of the edge at t along each side, and the inward direction
        const all = [(t) => [[2, 2 + t], [1, 0]], (t) => [[2 + t, 2], [0, 1]], (t) => [[2 + t, h + 2], [0, -1]], (t) => [[w + 2, 2 + t], [-1, 0]]]
        const sides = leftOnly ? all.slice(0, 1) : all
        let points = 0
        let neon = 0
        for (let t = 8; t < (leftOnly ? h : Math.min(w, h)) - 8; t++)
          for (const side of sides) {
            const [[x, y], [dx, dy]] = side(t)
            points++
            if (across.some((d) => isNeon(at(x + dx * d, y + dy * d)))) neon++
          }
        return neon / points
      },
      { b64: shot.toString('base64'), w: c.w, h: c.h, leftOnly },
    )
  }
  const labelUp = (i) => page.$$eval('#card .tile', (els, i) => getComputedStyle(els[i].querySelector('span')).opacity === '1', i)

  // 2. Hover, or always-up labels on touch.
  if (touch) {
    const up = await Promise.all(tiles.map(labelUp))
    check(up.every(Boolean), `${name} every label up without hovering`)
  } else {
    const before = await neonOnEdges(page, cells[0])
    const upBefore = await labelUp(0)
    await page.hover('#card .tile >> nth=0')
    await page.waitForTimeout(400) // the transition
    const after = await neonOnEdges(page, cells[0])
    const othersDown = !(await labelUp(1)) && !(await labelUp(2))
    check(before === 0 && after > 0.9, `${name} hover turns the border neon: ${(before * 100).toFixed(0)}% -> ${(after * 100).toFixed(0)}% of its pixels`)
    check(!upBefore && (await labelUp(0)) && othersDown, `${name} hover brings up that cell's label, only that one`)
    await page.screenshot({ path: `${out}/${name}-hover.png` })
    await page.hover('#card .tile.empty >> nth=0')
    await page.waitForTimeout(400)
    check((await neonOnEdges(page, cells[4])) === 0, `${name} a greyed cell does not light up`)
  }

  const visible = () => page.$$eval('#card [data-page]', (els) => els.filter((e) => !e.hidden && e.getBoundingClientRect().height > 0).map((e) => e.dataset.page))
  const focused = () => page.evaluate(() => document.activeElement.closest('.tile')?.textContent.trim() ?? document.activeElement.className)
  // Following a link (or history) changes the hash, and the screen follows on the hashchange event a moment later:
  // wait for that screen (its page up, and what is lit), or time out, which the check after it then fails.
  const arrive = (hash, pageId, litId = '') =>
    page
      .waitForFunction(
        ([h, p, l]) => location.hash === h && !document.querySelector(`#card [data-page="${p}"]`).hidden && [...document.querySelectorAll('#card .lit')].map((e) => e.dataset.anchor).join() === l,
        [hash, pageId, litId],
        { timeout: 5000 },
      )
      .catch(() => {})

  // 3. The keyboard.
  if (engine === 'chrome' && !touch) {
    const order = []
    for (const _ of EXPECTED.tiles) await page.keyboard.press('Tab'), order.push(await focused())
    check(order.join() === EXPECTED.tiles.join(), `${name} Tab walks the cells: ${order.join(', ')}`)
    await page.keyboard.press('Shift+Tab') // from Contact back to Side projects
    await page.keyboard.press('Enter')
    await arrive('#projects', 'projects')
    const opened = await visible()
    await page.keyboard.press('Tab')
    const onBack = await focused()
    await page.keyboard.press('Enter')
    await arrive('#home', 'home')
    check(opened.join() === 'projects' && onBack === 'back' && (await visible()).join() === 'home', `${name} Enter opens a page (${opened}), Tab reaches ${onBack}, Enter comes back`)
  }

  // 4. Clicking. Tap on touch. A click that should open nothing is given this long to open a tab or a page anyway.
  const NOTHING_MS = 800
  const press = (selector) => (touch ? page.tap(selector) : page.click(selector))
  const opensTab = async (selector) => {
    const [tab] = await Promise.all([context.waitForEvent('page'), press(selector)])
    await tab.waitForLoadState()
    const url = tab.url()
    await tab.close()
    return url
  }
  const opensNothing = async (selector) => {
    const tabs = context.pages().length
    const at = page.url()
    await press(selector)
    await page.waitForTimeout(NOTHING_MS)
    return context.pages().length === tabs && page.url() === at
  }
  for (const [i, href] of EXPECTED.links.entries()) {
    const url = await opensTab(`#card a.tile >> nth=${i}`)
    check(url === href, `${name} ${EXPECTED.tiles[i]} cell opens ${url} in a new tab`)
  }
  check((await opensNothing('#card .tile.empty >> nth=0')) && (await visible()).join() === 'home', `${name} clicking a greyed cell does nothing`)
  for (const [id, items] of Object.entries(EXPECTED.pages)) {
    await press(`#card a.tile[href="#${id}"]`)
    await arrive(`#${id}`, id)
    const shown = await visible()
    const list = await page.$$eval(`#card [data-page="${id}"] li a:not(.anchor)`, (els) => els.map((e) => [e.textContent, e.getAttribute('href')]))
    check(shown.join() === id && JSON.stringify(list) === JSON.stringify(items), `${name} ${id} cell opens its page alone, listing ${list.map(([t]) => t).join(', ')}`)
    const back = await page.$eval(`#card [data-page="${id}"] .back`, (e) => {
      const r = e.getBoundingClientRect()
      return { x: r.left, y: r.top }
    })
    check(back.x - screen.left < 0.15 * screen.w && back.y - screen.top < 0.15 * screen.h, `${name} ${id} back button top left of the screen`)
    await page.screenshot({ path: `${out}/${name}-${id}.png` })
    for (const [k, [title, href]] of items.entries()) {
      const item = `#card [data-page="${id}"] li a:not(.anchor) >> nth=${k}`
      if (href.startsWith('mailto:')) {
        await press(item)
        const mail = await page.evaluate(() => window.__mailto)
        check(mail?.href === href && !mail.newTab, `${name} ${title} clicks through to ${mail?.href} in this tab (no blank tab)`)
      } else {
        const url = await opensTab(item)
        check(url === href, `${name} ${title} opens ${url} in a new tab`)
      }
    }
    await press(`#card [data-page="${id}"] .back`)
    await arrive('#home', 'home')
    check((await visible()).join() === 'home', `${name} ${id} back returns to the grid`)
  }

  // 5. The visitor's place.
  const scrollNow = await page.evaluate(() => scrollY)
  check(scrollNow === scrollAtEnd, `${name} page scroll unmoved by all of it: ${scrollAtEnd} -> ${scrollNow}`)

  // 6. Everything on the screen is in /llms.txt.
  const llms = await (await page.request.get('http://localhost:4173/llms.txt')).text()
  const shown = await page.$$eval('#card a[href]:not([href^="#"])', (els) => els.flatMap((e) => [e.getAttribute('href'), e.textContent.trim()]))
  const missing = shown.filter((s) => !llms.includes(s))
  check(missing.length === 0, `${name} /llms.txt carries all ${shown.length / 2} links on the screen${missing.length ? `; missing: ${missing.join(', ')}` : ''}`)

  // 7. Anchors, in this session: links set the hash; back and forward walk the screens; the scroll never moves.
  const hash = () => page.evaluate(() => location.hash)
  const lit = () => page.$$eval('#card .lit', (els) => els.map((e) => e.dataset.anchor))
  await press('#card a.tile[href="#projects"]')
  await arrive('#projects', 'projects')
  if (!touch) await page.hover('#card [data-anchor="pacemaker"]') // the # shows on hover; touch shows it always
  await press('#card [data-anchor="pacemaker"] .anchor')
  await arrive('#pacemaker', 'projects', 'pacemaker')
  const atAnchor = [await hash(), (await lit()).join(), (await visible()).join()]
  await page.goBack()
  await arrive('#projects', 'projects')
  const back1 = [await hash(), (await lit()).join(), (await visible()).join()]
  await page.goBack() // the screen before Side projects: the grid, reached last by a "< back" link
  await arrive('#home', 'home')
  const back2 = [await hash(), (await visible()).join()]
  await page.goForward()
  await arrive('#projects', 'projects')
  const fwd = [await hash(), (await visible()).join()]
  check(
    atAnchor.join() === '#pacemaker,pacemaker,projects' && back1.join() === '#projects,,projects' && back2.join() === '#home,home' && fwd.join() === '#projects,projects',
    `${name} links set the hash, history walks it: # link ${atAnchor}; back ${back1}; back ${back2}; forward ${fwd}`,
  )
  check((await page.evaluate(() => scrollY)) === scrollAtEnd, `${name} page scroll unmoved by anchors and history`)
  await context.close()

  // 7. Anchors, opened fresh: each lands at the monitor with its page up and its thing alone lit and on screen.
  for (const [id, [pageId, what]] of Object.entries(EXPECTED.anchors)) {
    const ctx = await browser.newContext(opts)
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }))
    const p = await ctx.newPage()
    await p.goto(`http://localhost:4173/#${id}`)
    await p.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 })
    await p.waitForTimeout(1000) // a frame or two after the lift
    const at = await p.evaluate(() => ({
      landed: scrollY === document.documentElement.scrollHeight - innerHeight && document.getElementById('card').style.visibility === 'visible',
      shown: [...document.querySelectorAll('#card [data-page]')].filter((e) => !e.hidden).map((e) => e.dataset.page).join(),
      lit: [...document.querySelectorAll('#card .lit')].map((e) => e.dataset.anchor).join(),
    }))
    let onScreen = true
    let neon = 1
    if (what && at.landed) { // not landed fails below already; there is nothing on screen to sample
      const r = await p.$eval(`#card [data-anchor="${id}"]`, (e) => {
        const b = e.getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      })
      const s = await p.$eval('#card', (e) => e.getBoundingClientRect().toJSON())
      // Scrolled to: its top (an entry's title) on screen. An entry can be taller than a phone's screen, so only the
      // part on screen is sampled for the lit edge.
      onScreen = r.y >= s.top && r.y < s.bottom
      neon = await neonOnEdges(p, { ...r, h: Math.min(r.h, s.bottom - r.y - 2) }, what === 'entry')
      await p.screenshot({ path: `${out}/${name}-anchor-${id}.png` })
    }
    check(
      at.landed && at.shown === pageId && at.lit === (what ? id : '') && onScreen && neon > 0.9,
      `${name} #${id} lands at the monitor on ${at.shown}${what ? `, ${id} alone lit (${at.lit}), on screen, ${(neon * 100).toFixed(0)}% neon edge` : ''}`,
    )
    await ctx.close()
  }
}
await browser.close()
server.httpServer.close()
process.exit(failed ? 1 : 0)
