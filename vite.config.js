import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { SITE_URL } from './src/spec.js'
import { NAME, TILES } from './src/content.js'

// Renders src/content.js into the monitor's screen (#card) and /llms.txt.
const GRID = { columns: 3, rows: 2 }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const icon = (name) => readFileSync(`node_modules/bootstrap-icons/icons/${name}.svg`, 'utf8').replace(/ width="16" height="16"| class="[^"]*"/g, '').replace('<svg', '<svg aria-hidden="true"')
// Out of the page in a new tab, so the visitor keeps their place in the TARDIS.
const out = (href) => `href="${esc(href)}" target="_blank" rel="noopener"`
const face = (t) => `${icon(t.icon)}<span>${esc(t.label)}</span>`

// A thing's anchor on the site. Marked with data-anchor, never id: the browser would scroll the page to an element whose
// id is the hash, which rewinds the scroll-driven camera. main.js routes the hash instead.
const anchor = (id) => `${SITE_URL}#${id}`

// Per kind of list item: its entry on the page, and how it reads as text. A link says what it was built to solve, then
// what it is, with a # link to its own anchor beside the title; an email opens the mail app, no tab.
const ITEMS = {
  link: {
    li: (i) =>
      `<li data-anchor="${esc(i.id)}"><a ${out(i.href)}>${esc(i.title)}</a> <a class="anchor" href="#${esc(i.id)}" aria-label="Link to ${esc(i.title)}">#</a>` +
      `<p><b>Built to solve:</b> ${esc(i.solve)}</p><p><b>What:</b> ${esc(i.what)}</p></li>`,
    text: (i) => `- [${i.title}](${i.href}), here: ${anchor(i.id)}\n  - Built to solve: ${i.solve}\n  - What: ${i.what}`,
  },
  email: {
    li: (i) => `<li><a href="mailto:${esc(i.address)}">${esc(i.address)}</a><p>Email</p></li>`,
    text: (i) => `- Email: [${i.address}](mailto:${i.address})`,
  },
}

// Per kind of tile: its cell on the grid, the page it opens (if any), and how it reads as text.
const KINDS = {
  link: {
    tile: (t) => `<a class="tile" data-anchor="${esc(t.id)}" ${out(t.href)}>${face(t)}</a>`,
    page: () => '',
    text: (t) => `- [${t.label}](${t.href}), here: ${anchor(t.id)}`,
  },
  page: {
    tile: (t) => `<a class="tile" href="#${esc(t.id)}">${face(t)}</a>`,
    page: (t) =>
      `<section data-page="${esc(t.id)}" hidden><a class="back" href="#home">&lt; back</a>` +
      `<h2>${esc(t.label)}</h2><ul>${t.items.map((i) => ITEMS[i.kind].li(i)).join('')}</ul></section>`,
    text: (t) => `## ${t.label} (${anchor(t.id)})\n\n${t.items.map((i) => ITEMS[i.kind].text(i)).join('\n')}`,
  },
}
const empty = GRID.columns * GRID.rows - TILES.length
if (empty < 0) throw new Error(`${TILES.length} tiles do not fit a ${GRID.columns}x${GRID.rows} grid`)

const card = () =>
  `<section data-page="home"><h1>${esc(NAME)}</h1><nav><div class="grid" style="--columns: ${GRID.columns}; --rows: ${GRID.rows}">` +
  TILES.map((t) => KINDS[t.kind].tile(t)).join('') +
  '<span class="tile empty"></span>'.repeat(empty) +
  '</div></nav></section>' +
  TILES.map((t) => KINDS[t.kind].page(t)).join('')

function agentContent() {
  const read = () => {
    const note = readFileSync('agent-note.md', 'utf8').trim()
    const content = [`# ${NAME}`, ...TILES.map((t) => KINDS[t.kind].text(t))].join('\n\n')
    return { hello: note.split('\n\n')[0], llms: `${note}\n\n---\n\n${content}\n` }
  }
  // JSON-LD lives in a <script>, where HTML entities are not decoded: build it as JSON and only neutralise '<'.
  const person = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Person', name: NAME, url: SITE_URL }).replace(/</g, '\\u003c')
  return {
    name: 'agent-content',
    transformIndexHtml(html) {
      const c = read()
      // Replacement functions, not strings: a string replacement would read `$&`, `$'` or `$$` in the content as patterns.
      const fill = { PERSON: person, NAME: esc(NAME), HELLO: esc(c.hello), LLMS: esc(c.llms), URL: esc(SITE_URL), CARD: card() }
      return html.replace(/%(PERSON|NAME|HELLO|LLMS|URL|CARD)%/g, (_, key) => fill[key])
    },
    // src/content.js is imported by this config, so Vite restarts the server when it changes.
    configureServer(server) {
      server.watcher.add('agent-note.md')
      server.watcher.on('change', (f) => f.endsWith('agent-note.md') && server.ws.send({ type: 'full-reload' }))
      server.middlewares.use('/llms.txt', (_, res) => res.setHeader('content-type', 'text/plain; charset=utf-8').end(read().llms))
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: read().llms })
    },
  }
}

export default defineConfig({ plugins: [agentContent()] })
