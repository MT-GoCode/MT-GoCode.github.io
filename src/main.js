import * as THREE from 'three'
import gsap from 'gsap'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { createPages } from './pages'
import { createTardis } from './tardis'
import { createSky } from './sky'
import { createShot, openingDirection, aim, cues, checkLens, scrollTimeline, NEAR } from './shot'
import './style.css'

// WebDriver-controlled browsers (Playwright, Puppeteer, Selenium) set this flag by spec.
if (navigator.webdriver) document.getElementById('robot').hidden = false

// The monitor's screen is routed by the URL's hash, its only state: #<page> shows that page; #<thing> shows the page
// holding it, lit and scrolled to. Anything else is the grid. Links set the hash, so history, back and forward, and
// copied links all work as on any page. Things are marked data-page / data-anchor, never id (see vite.config.js).
const card = document.getElementById('card')
function route() {
  const id = CSS.escape(decodeURIComponent(location.hash.slice(1)))
  const page = card.querySelector(`[data-page="${id}"]`)
  const thing = card.querySelector(`[data-anchor="${id}"]`)
  const shown = page ?? thing?.closest('[data-page]') ?? card.querySelector('[data-page="home"]')
  for (const p of card.querySelectorAll('[data-page]')) p.hidden = p !== shown
  for (const t of card.querySelectorAll('[data-anchor]')) t.classList.toggle('lit', t === thing)
  card.scrollTop = thing ? thing.offsetTop - parseFloat(getComputedStyle(card).paddingTop) : 0
  return Boolean(page ?? thing)
}

const PHONE = matchMedia('(pointer: coarse)').matches
const DOOR_OPEN = 1.5 // radians, swung inward to just short of the side walls

const host = document.getElementById('scene')
// No stencil on the canvas: all stencil work happens in the composer's target below.
const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' })
renderer.toneMapping = THREE.AgXToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
host.appendChild(renderer.domElement)
// The page itself, placed in the 3D scene on the monitor's screen, drawn over the canvas.
const pages = createPages(host, card)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#04060b')
const camera = new THREE.PerspectiveCamera() // fov and pose come from the shot every frame
camera.near = NEAR
camera.far = 200

scene.add(new THREE.AmbientLight('#9fb4ff', 0.06))
const moon = new THREE.SpotLight('#dbe6ff', 2.6, 0, 0.32, 0.6, 0)
moon.position.set(-4, 7, 5)
moon.castShadow = true
// Shadow map: 2048 keeps the box's shadow edge crisp at laptop size; phones take a quarter of the pixels (fill rate).
moon.shadow.mapSize.setScalar(PHONE ? 1024 : 2048)
moon.shadow.bias = -0.0004
moon.shadow.normalBias = 0.02
moon.shadow.camera.far = 40
// Back light for the cel rim; it would also light the room, so the timeline fades it as the doors open.
const rim = new THREE.SpotLight('#6f9cff', 2.4, 0, 0.35, 1, 0)
rim.position.set(5, 2.5, -5)
scene.add(moon, rim)

const tardis = createTardis(card)
scene.fog = tardis.fog
const float = new THREE.Group()
float.add(tardis.group)
scene.add(float)
const sky = createSky(renderer, openingDirection())
scene.add(sky.group)

// Multisampled, stencil-carrying HDR target: the portal needs stencil; OutputPass tone-maps (AgX) the > 1.0 values.
const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true })
const composer = new EffectComposer(renderer, target)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new OutputPass())

// Drawn from GSAP's own ticker, straight after it advances the shot, so a frame never draws the shot a tick stale.
// It runs once the GPU is warm and the stars are in, and not while the camera has arrived (nothing moves then).
let ready = false
let arrived = false
const drawing = () => ready && !arrived
const sync = () => (drawing() ? gsap.ticker.add(frame) : gsap.ticker.remove(frame))

// Sized from #scene (100lvh), not the window, so a phone's toolbar sliding in and out does not reallocate
// the multisampled target mid-scroll. Pixel ratio is re-read for zoom and monitor changes.
function resize() {
  const w = host.clientWidth
  const h = host.clientHeight
  // Phones draw at up to 1.5x, not their 3x: a decision for fill rate, the GPU cost that grows with pixel count.
  const ratio = Math.min(devicePixelRatio, PHONE ? 1.5 : 2)
  renderer.setPixelRatio(ratio)
  composer.setPixelRatio(ratio)
  renderer.setSize(w, h)
  composer.setSize(w, h)
  pages.setSize(w, h)
  camera.aspect = w / h
  checkLens(camera.aspect)
  // The monitor takes the window's shape, and its screen content the pixel size it has on arrival.
  tardis.fitMonitor(w / h, h)
  if (ready && arrived) frame() // nothing is ticking, so draw the new shape once
}
new ResizeObserver(resize).observe(host)
function watchRatio() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => (resize(), watchRatio()), { once: true })
}
watchRatio()
resize()
// After the first resize: the screen has its size then, so a linked thing far down a list can be scrolled to.
addEventListener('hashchange', route)
// A link to something on the screen lands at the monitor, skipping the walk in.
const deepLink = route()

const shot = createShot()
function frame() {
  const t = performance.now() / 1000
  // Float only, no rocking: with hard toon bands a face near a band edge would flicker as it tilts.
  float.position.y = Math.sin(t * 0.9) * 0.08 * shot.bob
  rim.intensity = 2.4 * shot.rim
  const at = aim(camera, shot, tardis.screen)
  const { moon: key, swivel } = cues(at)
  moon.intensity = 2.6 * key
  renderer.shadowMap.autoUpdate = key > 0 // the moon is the only shadow caster; once it is out, skip its pass
  tardis.update({ open: shot.door * DOOR_OPEN, glow: shot.glow, inside: at.inside, swivel, eye: camera.position })
  sky.update(camera)
  composer.render()
  const view = tardis.pageView(camera)
  pages.render(view.matrix, view.camera)
}
// Everything on the GPU before the loader lifts: every shader compiled, every texture and every mesh's buffers
// uploaded. Otherwise each part does it the first time it comes into view, and the walk in stutters as the room
// appears (measured: 116-150 ms frames). Nothing else draws until this is done, so the room stays drawable
// throughout: compiled against the composer's target (what the scene is drawn into: no tone mapping there), then
// one full draw with culling off sends every mesh, shadow pass included.
async function warmUp() {
  tardis.update({ open: 1, glow: 1, inside: false, swivel: 0, eye: camera.position })
  scene.traverse((o) => {
    for (const m of [o.material ?? []].flat()) for (const v of Object.values(m)) if (v?.isTexture) renderer.initTexture(v)
  })
  renderer.setRenderTarget(target)
  await renderer.compileAsync(scene, camera)
  renderer.setRenderTarget(null)
  const culled = []
  scene.traverse((o) => o.isMesh && o.frustumCulled && (culled.push(o), (o.frustumCulled = false)))
  composer.render()
  for (const o of culled) o.frustumCulled = true
}
// The loader lifts once everything is on the GPU, a real frame has been drawn and the stars are in.
Promise.all([sky.ready, warmUp()]).then(() => {
  ready = true
  frame()
  sync()
  const loader = document.getElementById('loader')
  loader.addEventListener('transitionend', () => loader.remove(), { once: true })
  loader.style.opacity = 0
  document.documentElement.classList.remove('loading')
})
scrollTimeline(shot, tardis.screen, deepLink, (atEnd) => {
  arrived = atEnd
  if (ready && arrived) frame() // the arriving frame
  sync()
})
