import * as THREE from 'three'
import { toon, ink, part, box, bake, canvasTexture } from './toon'
import { MONITOR } from './spec'

// Bigger on the inside: the room is far larger than the box and is drawn only where the doorway
// is on screen (stencil), until the camera crosses the threshold and it is drawn normally.
// Draw order: exterior (0) -> doorway writes stencil (1) -> doorway resets depth to far (2) -> room (3) -> front doors (4).
export const ORDER = { mask: 1, reset: 2, room: 3, doors: 4 }

// Modelled on the 2013-17 console room: indigo dark lit cyan; a three-tier stack of Gallifreyan-panelled
// drums over a glass rotor of cyan tubes that pulse up and down; a hexagonal console whose six panels each
// carry their own instruments (a pilot's throttle, a glass dial, a bank of levers, a keyboard and screen,
// gauges, a crank), a row of red rockers round its collar, a sparser ring of desks around it, and a monitor
// on an angled arm that swings round the rotor; a round platform ringed in cyan; steel arched ribs with light
// strips; honeycomb lower walls and glowing floor grilles; a balcony edged in cyan, reached by a stair behind
// the rotor, lined with bookshelves, Gallifreyan blackboards and orange roundels.
const R = 13 // room radius, m
const H = 16 // room height, m
const BALCONY = 4.6 // balcony floor height, m
const RIBS = 18
const GAP = 0.17 // radians of wall left open behind the doorway
export const MASK_INSET = 0.035 // the doorway mask sits this far inside the door plane, behind the closed leaves
export const EYE = 1.65 // eye height above the room floor, m: clears the 1.93 m doorway with headroom; the monitor's centre sits here
const ARM = 1.6 // monitor face's distance from the rotor axis, m
// Where the monitor waits before it swings round: behind the rotor, off to the visitor's left (-x), facing away.
const MONITOR_START = -0.85 * Math.PI

// Console geometry: a hexagonal skirt, then six panels sloping up to the rotor collar.
const DECK = { base: 0.95, top: 1.25, outer: 1.5, inner: 0.55 }
const DECK_APOTHEM = { outer: DECK.outer * Math.cos(Math.PI / 6), inner: DECK.inner * Math.cos(Math.PI / 6) }
const DECK_SLOPE = Math.atan2(DECK.top - DECK.base, DECK_APOTHEM.outer - DECK_APOTHEM.inner)
const DECK_HALF = Math.hypot(DECK.top - DECK.base, DECK_APOTHEM.outer - DECK_APOTHEM.inner) / 2 // half the panel's slant length

const maskMat = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
})

// Pushes the doorway to the far plane so the room is not hidden by the box's own inner faces.
const resetMat = new THREE.ShaderMaterial({
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
  fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
  colorWrite: false,
  depthFunc: THREE.AlwaysDepth,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.EqualStencilFunc,
})

// Deterministic randomness, so every visit draws the same room.
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

const hexPath = (g, cx, cy, r) => {
  g.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i
    g[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  g.closePath()
}

// Gallifreyan circle-writing: a ring with satellite circles, an inner arc and a stem. Every textured surface
// it lands on keeps the canvas's aspect ratio, so the circles stay circles.
function glyph(g, r, cx, cy, size) {
  g.beginPath()
  g.arc(cx, cy, size, 0, Math.PI * 2)
  g.stroke()
  for (let k = 0; k < 4; k++) {
    const a = r() * Math.PI * 2
    const d = size * (0.3 + r() * 0.45)
    g.beginPath()
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, size * (0.12 + r() * 0.22), 0, Math.PI * 2)
    g.stroke()
  }
  g.beginPath()
  g.arc(cx, cy, size * (0.55 + r() * 0.2), r() * 6, r() * 6 + 2.5)
  g.stroke()
}

// Dark teal-grey honeycomb; the tile is two hexes wide so offset rows repeat seamlessly.
const honeycomb = canvasTexture(256, 222, (g, w, h) => {
  g.fillStyle = '#0a0f16'
  g.fillRect(0, 0, w, h)
  const r = w / 4
  for (let row = -1; row <= 2; row++)
    for (let col = -1; col <= 3; col++) {
      const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0)
      hexPath(g, cx, (row * h) / 2, r - 5)
      g.fillStyle = '#25343f'
      g.fill()
      hexPath(g, cx, (row * h) / 2, r - 16)
      g.fillStyle = '#1a2630'
      g.fill()
    }
}, [Math.round((2 * Math.PI * R) / 2.2), 2])

// One square silver panel engraved with Gallifreyan; drums repeat it once per (square) face.
const drumPanel = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#c9ced6'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = '#5d6570'
  g.lineWidth = 6
  g.strokeRect(6, 6, w - 12, h - 12)
  g.lineWidth = 3
  glyph(g, rng(5), w / 2, h / 2, w * 0.34)
})

const perforated = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#5d6670'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#323a43'
  for (let y = 6; y < h; y += 10) for (let x = 6; x < w; x += 10) g.fillRect(x - 2, y - 2, 4, 4)
}, [10, 10])

const grille = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#3a4046'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#e6f2ff'
  for (let y = 8; y < h; y += 12) for (let x = 8; x < w; x += 12) g.fillRect(x - 3, y - 3, 6, 6)
})

const books = canvasTexture(512, 512, (g, w) => {
  const r = rng(7)
  g.fillStyle = '#140c07'
  g.fillRect(0, 0, w, w)
  const SPINES = ['#5a1e17', '#2f3d26', '#6b4a22', '#1f2b44', '#4a2a3a', '#7a5a2a', '#2b2018', '#5c3a1c']
  for (let row = 0; row < 4; row++) {
    const top = row * 128 + 10
    let x = 6
    while (x < w - 10) {
      const bw = 8 + r() * 14
      const bh = 92 + r() * 22
      g.fillStyle = SPINES[Math.floor(r() * SPINES.length)]
      g.fillRect(x, top + (114 - bh), bw, bh)
      g.fillStyle = 'rgba(214,170,90,0.55)'
      g.fillRect(x + 2, top + (114 - bh) + 12, bw - 4, 3)
      x += bw + 1 + (r() < 0.08 ? 18 : 0)
    }
    g.fillStyle = '#4a2e18'
    g.fillRect(0, top + 114, w, 14)
  }
})

const BOARD = { w: 2.2, h: 3.0 } // blackboard face, m; its canvas has the same aspect
const chalk = canvasTexture(440, 600, (g, w, h) => {
  const r = rng(11)
  g.fillStyle = '#1b231e'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = 'rgba(230,230,220,0.78)'
  g.lineCap = 'round'
  for (let i = 0; i < 6; i++) {
    g.lineWidth = 2 + r() * 2
    glyph(g, r, 60 + r() * (w - 120), 60 + r() * (h - 120), 22 + r() * 40)
  }
  g.strokeStyle = '#3a2412'
  g.lineWidth = 18
  g.strokeRect(0, 0, w, h)
})

const roundel = (glow) =>
  canvasTexture(128, 128, (g, w) => {
    const disc = (rad, c) => {
      g.beginPath()
      g.arc(w / 2, w / 2, rad, 0, Math.PI * 2)
      g.fillStyle = c
      g.fill()
    }
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, w)
    disc(62, glow ? '#000' : '#aab2bc')
    disc(48, glow ? '#000' : '#2a1206')
    disc(34, glow ? '#ff7a1a' : '#ffae5a')
  })

const gaugeFace = canvasTexture(128, 128, (g, w) => {
  g.fillStyle = '#e9e2cf'
  g.beginPath()
  g.arc(w / 2, w / 2, 60, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#222'
  g.lineWidth = 4
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (0.8 + (1.4 * i) / 8)
    g.beginPath()
    g.moveTo(w / 2 + Math.cos(a) * 44, w / 2 + Math.sin(a) * 44)
    g.lineTo(w / 2 + Math.cos(a) * 54, w / 2 + Math.sin(a) * 54)
    g.stroke()
  }
  g.strokeStyle = '#b02a1a'
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(w / 2, w / 2)
  g.lineTo(w / 2 + 40, w / 2 - 22)
  g.stroke()
})

// Small orange CRT readout, after the classic console's.
const crtFace = canvasTexture(160, 120, (g, w, h) => {
  g.fillStyle = '#e8792a'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#5a1e04'
  g.fillRect(12, 10, 60, 12)
  for (let i = 0; i < 6; i++) g.fillRect(12, 32 + i * 13, 40 + ((i * 37) % 90), 6)
})

// Glass dial plate: concentric rings under four turning knobs.
const dialFace = canvasTexture(128, 128, (g, w) => {
  g.fillStyle = '#1d3f8a'
  g.beginPath()
  g.arc(w / 2, w / 2, 62, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#7fb4ff'
  g.lineWidth = 3
  for (const rad of [50, 34, 18]) {
    g.beginPath()
    g.arc(w / 2, w / 2, rad, 0, Math.PI * 2)
    g.stroke()
  }
})

const lowerWall = toon({ map: honeycomb, side: THREE.BackSide })
const upperWall = toon({ color: '#141c2a', side: THREE.BackSide })
const steel = toon({ color: '#4d5f78' })
const dullSteel = toon({ color: '#3a4656' })
const silver = toon({ color: '#aeb6c2' })
const handrail = toon({ color: '#c3cbd6' })
const darkSteel = toon({ color: '#222b38' })
const consoleGrey = toon({ color: '#5a6471' })
const plate = toon({ color: '#2a3038' })
const black = toon({ color: '#16191d' })
const red = toon({ color: '#b02218' })
const floor = toon({ map: perforated })
const wood = toon({ color: '#3a2414' })
// Shelves and boards carry a faint self-glow: in the room they are lit, and toon bands alone leave them black.
const shelfFace = toon({ map: books, emissiveMap: books, emissive: '#ffd2a0', emissiveIntensity: 0.4 })
const boardFace = toon({ map: chalk, emissiveMap: chalk, emissive: '#ffffff', emissiveIntensity: 0.35 })
const grilleLit = toon({ map: grille, emissiveMap: grille, emissive: '#cfe9ff', emissiveIntensity: 0.22 })
const gauge = toon({ map: gaugeFace, emissiveMap: gaugeFace, emissive: '#ffffff', emissiveIntensity: 0.35 })
const crt = toon({ map: crtFace, emissiveMap: crtFace, emissive: '#ffffff', emissiveIntensity: 0.7 })
const dial = toon({ map: dialFace, emissiveMap: dialFace, emissive: '#ffffff', emissiveIntensity: 0.6 })
const cyan = toon({ color: '#c6f0ff', emissive: '#4cc8ff', emissiveIntensity: 1 })
const tube = toon({ color: '#d8f6ff', emissive: '#5ad2ff', emissiveIntensity: 1 })
const rocker = toon({ color: '#ff3a2a', emissive: '#ff2a1a', emissiveIntensity: 0.6 })
const orange = toon({ map: roundel(false), emissiveMap: roundel(true), emissive: '#ffffff', emissiveIntensity: 1 })
const glass = toon({ color: '#8fd4ff', transparent: true, opacity: 0.16, depthWrite: false })
const KEYS = ['#d8dde4', '#3a8cff', '#ffb02a', '#e8463a'].map((c) => toon({ color: c }))
const line = ink(0.025)
const thin = ink(0.01)

const atAngle = (a, r, y) => [r * Math.sin(a), y, r * Math.cos(a)]
// Angle for slot i of n round the room, leaving the doorway side (angle 0) open by `open` radians.
const around = (i, n, open) => open / 2 + ((Math.PI * 2 - open) * (i + 0.5)) / n

// A grid of instanced keys: one draw call per key colour, however many keys.
function keyGrid(g, x, z, cols, rows, pitch, key, pick) {
  const m = new THREE.Matrix4()
  const lists = KEYS.map(() => [])
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) lists[pick(i, j)].push([x + (i - (cols - 1) / 2) * pitch, z + (j - (rows - 1) / 2) * pitch])
  lists.forEach((list, k) => {
    if (!list.length) return
    const inst = new THREE.InstancedMesh(key, KEYS[k], list.length)
    list.forEach(([px, pz], n) => inst.setMatrixAt(n, m.makeTranslation(px, key.parameters.height / 2, pz)))
    g.add(inst)
  })
}

// Console instruments. Each adds to `g` at (x, z) on a panel surface at y = 0 (+z runs down-slope, away from the rotor).
const KIT = {
  // The pilot's throttle: a slotted quadrant and a long lever ending in a T-grip.
  throttle(g, x, z) {
    g.add(part(box(0.14, 0.05, 0.26), plate, thin, { position: [x, 0.025, z] }))
    for (const s of [-1, 1]) g.add(part(box(0.012, 0.09, 0.22), silver, thin, { position: [x + s * 0.05, 0.07, z] }))
    const lever = new THREE.Group()
    lever.position.set(x, 0.05, z + 0.06)
    lever.rotation.x = -0.55
    lever.add(part(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 10), silver, thin, { position: [0, 0.14, 0] }))
    lever.add(part(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 12), black, thin, { position: [0, 0.29, 0], rotation: [0, 0, Math.PI / 2] }))
    g.add(lever)
  },
  // Glass dial plate under a bezel, four knobs set into it.
  dial(g, x, z) {
    g.add(part(new THREE.TorusGeometry(0.17, 0.018, 8, 40), silver, thin, { position: [x, 0.012, z], rotation: [Math.PI / 2, 0, 0] }))
    g.add(part(new THREE.CircleGeometry(0.16, 40), dial, null, { position: [x, 0.006, z], rotation: [-Math.PI / 2, 0, 0], shadows: false }))
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4
      const at = [x + Math.cos(a) * 0.09, 0.025, z + Math.sin(a) * 0.09]
      g.add(part(new THREE.CylinderGeometry(0.022, 0.026, 0.04, 12), silver, thin, { position: at }))
    }
  },
  // A bank of five levers in their slots, red-tipped.
  levers(g, x, z) {
    g.add(part(box(0.36, 0.03, 0.18), plate, thin, { position: [x, 0.015, z] }))
    for (let k = 0; k < 5; k++) {
      const lx = x + (k - 2) * 0.07
      const rod = part(new THREE.CylinderGeometry(0.009, 0.009, 0.17, 8), silver, thin, { position: [lx, 0.1, z + 0.02] })
      rod.rotation.x = -0.25 + (k % 2) * 0.5
      g.add(rod)
      g.add(part(new THREE.SphereGeometry(0.02, 10, 8), red, thin, { position: [lx, 0.18, z + 0.02 - Math.sin(rod.rotation.x) * 0.08] }))
    }
  },
  // A keyboard of small grey keys with a few coloured function keys, as on the classic console.
  keyboard(g, x, z) {
    g.add(part(box(0.3, 0.02, 0.13), plate, thin, { position: [x, 0.01, z] }))
    keyGrid(g, x, z, 8, 3, 0.034, box(0.026, 0.018, 0.026), (i, j) => (j === 0 && i > 5 ? 1 + (i % 3) : 0))
  },
  // Orange readout screen in a raised frame.
  screen(g, x, z) {
    g.add(part(box(0.3, 0.04, 0.22), plate, thin, { position: [x, 0.02, z] }))
    g.add(part(new THREE.PlaneGeometry(0.24, 0.17), crt, null, { position: [x, 0.041, z], rotation: [-Math.PI / 2, 0, 0], shadows: false }))
  },
  gauge(g, x, z) {
    g.add(part(new THREE.CylinderGeometry(0.085, 0.09, 0.03, 24), silver, thin, { position: [x, 0.015, z] }))
    g.add(part(new THREE.CircleGeometry(0.07, 24), gauge, null, { position: [x, 0.032, z], rotation: [-Math.PI / 2, 0, 0], shadows: false }))
  },
  crank(g, x, z) {
    g.add(part(new THREE.TorusGeometry(0.08, 0.013, 8, 24), silver, thin, { position: [x, 0.035, z], rotation: [Math.PI / 2, 0, 0] }))
    for (const a of [0, Math.PI / 2]) g.add(part(box(0.16, 0.01, 0.012), silver, null, { position: [x, 0.035, z], rotation: [0, a, 0] }))
    g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8), black, thin, { position: [x + 0.08, 0.08, z] }))
  },
  // Two levers joined by a cross-bar, thrown together.
  doubleLever(g, x, z) {
    g.add(part(box(0.16, 0.03, 0.1), plate, thin, { position: [x, 0.015, z] }))
    for (const s of [-1, 1]) {
      const rod = part(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), silver, thin, { position: [x + s * 0.05, 0.1, z - 0.03] })
      rod.rotation.x = 0.4
      g.add(rod)
    }
    g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 10), black, thin, { position: [x, 0.19, z - 0.07], rotation: [0, 0, Math.PI / 2] }))
  },
  knob(g, x, z) {
    g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 14), black, thin, { position: [x, 0.025, z] }))
    g.add(part(box(0.012, 0.012, 0.04), silver, null, { position: [x, 0.055, z - 0.012] }))
  },
  toggles(g, x, z) {
    g.add(part(box(0.22, 0.02, 0.06), plate, thin, { position: [x, 0.01, z] }))
    for (let k = 0; k < 5; k++) {
      const t = part(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), silver, null, { position: [x + (k - 2) * 0.042, 0.04, z] })
      t.rotation.x = k % 2 ? 0.4 : -0.4
      g.add(t)
    }
  },
}

// Six panels, each its own instrument layout; panel 0 faces the doors. [instrument, x, z] in panel space.
const PANELS = [
  [['throttle', -0.26, 0.12], ['keyboard', 0.18, 0.16], ['toggles', 0, -0.26]],
  [['dial', 0, 0.06], ['knob', -0.42, 0.26], ['knob', 0.42, 0.26], ['toggles', 0, -0.27]],
  [['levers', 0, 0.02], ['gauge', -0.44, 0.27], ['gauge', 0.44, 0.27]],
  [['screen', -0.18, 0.08], ['keyboard', 0.26, 0.2], ['knob', 0.2, -0.2]],
  [['doubleLever', -0.24, 0.1], ['crank', 0.26, 0.12], ['toggles', 0, -0.26]],
  [['throttle', 0.3, 0.14], ['gauge', -0.28, 0.1], ['knob', -0.05, -0.22]],
]

function shell(g) {
  const span = [GAP / 2, Math.PI * 2 - GAP]
  g.add(part(new THREE.CylinderGeometry(R, R, BALCONY, 96, 1, true, ...span), lowerWall, null, { position: [0, BALCONY / 2, 0], shadows: false }))
  g.add(part(new THREE.CylinderGeometry(R, R, H - BALCONY, 96, 1, true, ...span), upperWall, null, { position: [0, (H + BALCONY) / 2, 0], shadows: false }))
  g.add(part(new THREE.CircleGeometry(R, 96), darkSteel, null, { rotation: [-Math.PI / 2, 0, 0] }))
  g.add(part(new THREE.CircleGeometry(R, 96), darkSteel, null, { position: [0, H, 0], rotation: [Math.PI / 2, 0, 0] }))
  // Glowing grilles set into the floor: one ring on the platform, one around it.
  const tile = new THREE.PlaneGeometry(0.7, 1.1)
  for (const [radius, n, y] of [[4.9, 16, 0.304], [7.6, 26, 0.004]])
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      g.add(part(tile, grilleLit, null, { position: atAngle(a, radius, y), rotation: [-Math.PI / 2, 0, a], shadows: false }))
    }
  // Arched ribs: up the wall carrying a cyan strip, then curving in to the crown.
  const tall = H - 6
  const riser = box(0.4, tall, 0.55)
  const strip = box(0.08, tall - 0.6, 0.04)
  const lean = new THREE.Vector2(R - 0.4 - 4.5, 5.5)
  const leanBeam = box(0.32, lean.length(), 0.5)
  for (let i = 0; i < RIBS; i++) {
    const rib = new THREE.Group()
    rib.rotation.y = (i / RIBS) * Math.PI * 2 + Math.PI / RIBS
    rib.add(part(riser, steel, line, { position: [0, tall / 2, R - 0.4] }))
    rib.add(part(strip, cyan, null, { position: [0, tall / 2, R - 0.7], shadows: false }))
    const beam = part(leanBeam, steel, line, { position: [0, tall + lean.y / 2, R - 0.4 - lean.x / 2] })
    beam.rotation.x = -Math.atan2(lean.x, lean.y)
    rib.add(beam)
    g.add(rib)
  }
}

function balcony(g) {
  g.add(part(new THREE.RingGeometry(9, R - 0.05, 96), darkSteel, null, { position: [0, BALCONY, 0], rotation: [-Math.PI / 2, 0, 0] }))
  g.add(part(new THREE.TorusGeometry(9, 0.07, 6, 180), cyan, null, { position: [0, BALCONY - 0.02, 0], rotation: [Math.PI / 2, 0, 0], shadows: false }))
  g.add(part(new THREE.TorusGeometry(9.05, 0.04, 8, 180), dullSteel, thin, { position: [0, BALCONY + 1, 0], rotation: [Math.PI / 2, 0, 0] }))
  const post = new THREE.CylinderGeometry(0.025, 0.025, 1, 6)
  for (let i = 0; i < 60; i++) g.add(part(post, dullSteel, null, { position: atAngle((i / 60) * Math.PI * 2, 9.05, BALCONY + 0.5) }))
  // Upper wall: bookshelf bays (three of them Gallifreyan blackboards), an orange roundel between each.
  const shelf = box(2.4, 3.2, 0.5)
  const face = new THREE.PlaneGeometry(BOARD.w, BOARD.h)
  const disc = new THREE.CircleGeometry(0.42, 32)
  const BAYS = 16
  for (let i = 0; i < BAYS; i++) {
    const a = around(i, BAYS, 2 * GAP)
    const bay = new THREE.Group()
    bay.rotation.y = a + Math.PI
    bay.position.set(...atAngle(a, R - 0.7, BALCONY + 1.7))
    const board = i === 3 || i === 8 || i === 12
    bay.add(part(shelf, wood, line))
    bay.add(part(face, board ? boardFace : shelfFace, null, { position: [0, 0, 0.26], shadows: false }))
    g.add(bay)
    if (i === BAYS - 1) continue
    const b = (a + around(i + 1, BAYS, 2 * GAP)) / 2
    const light = part(disc, orange, null, { position: atAngle(b, R - 0.08, BALCONY + 2.4), shadows: false })
    light.rotation.y = b + Math.PI
    g.add(light)
  }
}

// A straight flight behind the rotor on the right (+x is the viewer's right on entering), up to the balcony.
function staircase(g) {
  const from = new THREE.Vector3(5.2, 0, -5.0)
  const to = new THREE.Vector3(1.6, BALCONY, -8.6)
  const run = new THREE.Vector2(to.x - from.x, to.z - from.z).length()
  const flight = new THREE.Group()
  flight.position.copy(from)
  flight.rotation.y = Math.atan2(to.x - from.x, to.z - from.z)
  const STEPS = 16
  const step = box(1.3, 0.08, 0.32)
  for (let i = 0; i < STEPS; i++) flight.add(part(step, darkSteel, thin, { position: [0, ((i + 1) * BALCONY) / STEPS - 0.04, ((i + 0.5) * run) / STEPS] }))
  const slope = Math.atan2(BALCONY, run)
  const length = Math.hypot(run, BALCONY)
  for (const x of [-0.68, 0.68]) {
    const stringer = part(box(0.06, 0.18, length), dullSteel, thin, { position: [x, BALCONY / 2 - 0.05, run / 2] })
    stringer.rotation.x = -slope
    flight.add(stringer)
    flight.add(part(new THREE.CylinderGeometry(0.03, 0.03, length, 10), handrail, thin, { position: [x, BALCONY / 2 + 0.9, run / 2], rotation: [Math.PI / 2 - slope, 0, 0] }))
    for (let i = 1; i < STEPS; i += 3) {
      const z = ((i + 0.5) * run) / STEPS
      flight.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), handrail, null, { position: [x, ((i + 1) * BALCONY) / STEPS + 0.45, z] }))
    }
  }
  g.add(flight)
}

function platform(g) {
  g.add(part(new THREE.CylinderGeometry(6, 6.2, 0.3, 64), floor, line, { position: [0, 0.15, 0] }))
  // Cyan light pooled in a ring around the console's foot.
  g.add(part(new THREE.RingGeometry(1.5, 1.75, 64), cyan, null, { position: [0, 0.31, 0], rotation: [-Math.PI / 2, 0, 0], shadows: false }))
  // Curved railing round the platform, open toward the doors.
  const OPEN = 0.9
  const rail = part(new THREE.TorusGeometry(6.1, 0.04, 8, 120, Math.PI * 2 - OPEN), dullSteel, thin, { position: [0, 1.25, 0] })
  rail.rotation.set(Math.PI / 2, 0, Math.PI / 2 + OPEN / 2)
  g.add(rail)
  const post = new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6)
  for (let i = 0; i < 24; i++) g.add(part(post, dullSteel, null, { position: atAngle(OPEN / 2 + ((Math.PI * 2 - OPEN) * i) / 23, 6.1, 0.78) }))
}

function consoles(g) {
  // Hexagonal centre console: open pedestal, a skirt, then six panels sloping up to the rotor collar.
  // Turned by 30 degrees so a panel, not a corner, faces the doors.
  const turn = Math.PI / 6
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + turn
    g.add(part(box(0.14, DECK.base - 0.4, 0.14), darkSteel, thin, { position: [0.62 * Math.sin(a), 0.3 + (DECK.base - 0.4) / 2, 0.62 * Math.cos(a)] }))
  }
  g.add(part(new THREE.CylinderGeometry(DECK.outer, 0.9, 0.22, 6), consoleGrey, line, { position: [0, DECK.base - 0.11, 0], rotation: [0, turn, 0] }))
  g.add(part(new THREE.CylinderGeometry(DECK.inner, DECK.outer, DECK.top - DECK.base, 6), consoleGrey, line, { position: [0, (DECK.base + DECK.top) / 2, 0], rotation: [0, turn, 0] }))
  const rockerGeo = box(0.03, 0.03, 0.06)
  const rockers = new THREE.InstancedMesh(rockerGeo, rocker, 6 * 7)
  const m = new THREE.Matrix4()
  const mid = (DECK_APOTHEM.outer + DECK_APOTHEM.inner) / 2
  PANELS.forEach((kit, i) => {
    const panel = new THREE.Group()
    const a = (i * Math.PI) / 3
    panel.position.set(...atAngle(a, mid, (DECK.base + DECK.top) / 2))
    panel.rotation.set(0, a, 0)
    const face = new THREE.Group()
    face.rotation.x = DECK_SLOPE
    for (const [name, x, z] of kit) KIT[name](face, x, z)
    panel.add(face)
    g.add(panel)
    // A row of red rockers along the panel's top edge, under the rotor collar.
    for (let k = 0; k < 7; k++) {
      const local = new THREE.Vector3((k - 3) * 0.06, 0.015, -DECK_HALF + 0.06).applyEuler(face.rotation).applyEuler(panel.rotation).add(panel.position)
      rockers.setMatrixAt(i * 7 + k, m.makeRotationFromEuler(new THREE.Euler(DECK_SLOPE, a, 0, 'YXZ')).setPosition(local))
    }
  })
  g.add(rockers)
  g.add(part(new THREE.CylinderGeometry(0.6, 0.62, 0.08, 6), silver, line, { position: [0, DECK.top + 0.04, 0], rotation: [0, turn, 0] }))
  // A sparser ring of desks around it, open toward the doors, each sloping toward the centre.
  const SEGMENTS = 9
  const OPEN = 1.1
  const RADIUS = 3.6
  const width = 2 * RADIUS * Math.sin((Math.PI * 2 - OPEN) / SEGMENTS / 2) - 0.08
  const RING = [['keyboard', 0, 0], ['toggles', 0, 0.05], ['gauge', 0, 0], ['knob', 0, 0]]
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = new THREE.Group()
    seg.rotation.y = around(i, SEGMENTS, OPEN)
    const top = new THREE.Group()
    top.position.set(0, 1.12, RADIUS)
    top.rotation.x = -0.45
    top.add(part(box(width, 0.06, 0.6), consoleGrey, thin, { position: [0, -0.03, 0] }))
    const [name, x, z] = RING[i % RING.length]
    KIT[name](top, x, z)
    seg.add(top)
    seg.add(part(box(width, 0.8, 0.06), consoleGrey, thin, { position: [0, 0.7, RADIUS + 0.28] }))
    g.add(seg)
  }
}

// The monitor: a frame on an arm slanting up from the console's collar at the rotor, pivoting about the rotor axis. Its face sits at
// eye height, ARM from the axis. Its screen is `content`, a real DOM element placed on the face in 3D
// (pages.js), so what it shows is the page itself. fit(aspect, viewHeight) reshapes the frame to the
// visitor's window, lays the content out at the pixel size its screen has when the frame fills that window,
// and re-runs the arm. view(camera) is the content's world matrix and camera to draw it with (pages.js).
function monitor(g, content) {
  const pivot = new THREE.Group()
  const head = new THREE.Group()
  head.position.set(0, EYE, ARM)
  const frame = part(box(1, 1, 0.05), silver, thin, { position: [0, 0, -0.025] })
  // The back housing: a shallower box behind the frame, in the frame's colour.
  const housing = part(box(1, 1, 0.07), silver, thin, { position: [0, 0, -0.085] })
  // Dark glass behind the content, flush with the frame face and pulled forward in depth to win.
  const glassMat = new THREE.MeshBasicMaterial({ color: '#000000', fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })
  const screen = part(new THREE.PlaneGeometry(1, 1), glassMat, null, { shadows: false })
  // Where the content sits: on the frame face itself, so its distance from the camera is the frame's.
  const anchor = new THREE.Object3D()
  // The content is drawn in a world scaled to CSS px, not metres, where it sits at scale 1: in metres it would be a
  // fraction of a px from the CSS eye at a tiny scale, past what the browser's hit-testing resolves. Scaling the page
  // and its camera alike leaves the picture unchanged.
  const page = new THREE.Matrix4()
  content.style.visibility = 'hidden'
  const pageCamera = new THREE.PerspectiveCamera()
  pageCamera.matrixWorldAutoUpdate = false
  const toPx = new THREE.Matrix4()
  const fromPx = new THREE.Matrix4()
  const handles = [-1, 1].map((s) => {
    const h = part(new THREE.TorusGeometry(0.09, 0.012, 6, 16, Math.PI), silver, thin, { rotation: [0, 0, (-s * Math.PI) / 2] })
    head.add(h)
    return h
  })
  head.add(frame, housing, screen, anchor)
  const strut = part(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), silver, thin)
  const joint = part(new THREE.SphereGeometry(0.05, 12, 10), darkSteel, thin)
  const collar = new THREE.Vector3(0, DECK.top + 0.06, 0.62) // where the console meets the rotor, on its collar
  pivot.add(head, strut, joint)
  g.add(pivot)
  const size = { w: 0, h: 0, innerW: 0, innerH: 0 }
  const facing = new THREE.Vector3()
  const toEye = new THREE.Vector3()
  return {
    pivot,
    view(camera) {
      anchor.updateWorldMatrix(true, false)
      camera.updateWorldMatrix(true, false)
      page.multiplyMatrices(toPx, anchor.matrixWorld)
      pageCamera.projectionMatrix.copy(camera.projectionMatrix)
      // The same camera in the scaled world: same orientation, position scaled.
      pageCamera.matrixWorld.multiplyMatrices(toPx, camera.matrixWorld).multiply(fromPx)
      pageCamera.matrixWorldInverse.copy(pageCamera.matrixWorld).invert()
      return { matrix: page, camera: pageCamera }
    },
    // The screen faces `eye` (a world point): the content is on its front, never seen through its back.
    faces(eye) {
      head.updateWorldMatrix(true, false)
      head.getWorldDirection(facing)
      return facing.dot(toEye.setFromMatrixPosition(head.matrixWorld).negate().add(eye)) > 0
    },
    size,
    fit(aspect, viewHeight) {
      size.h = MONITOR.diagonal / Math.hypot(1, aspect)
      size.w = size.h * aspect
      size.innerW = size.w - 2 * MONITOR.bezel
      size.innerH = size.h - 2 * MONITOR.bezel
      frame.scale.set(size.w, size.h, 1)
      housing.scale.set(size.w * 0.8, size.h * 0.8, 1)
      screen.scale.set(size.innerW, size.innerH, 1)
      const px = viewHeight / size.h // CSS px per metre once the frame fills the window
      content.style.width = `${size.innerW * px}px`
      content.style.height = `${size.innerH * px}px`
      anchor.scale.setScalar(1 / px)
      toPx.makeScale(px, px, px)
      fromPx.makeScale(1 / px, 1 / px, 1 / px)
      handles.forEach((h, k) => h.position.set((k ? 1 : -1) * (size.w / 2 + 0.06), 0, -0.03))
      // Strut slanting up from the collar to a joint at the centre of the back housing.
      const mount = new THREE.Vector3(0, EYE, ARM - 0.12)
      joint.position.copy(mount)
      const span = new THREE.Vector3().subVectors(mount, collar)
      strut.position.copy(collar).addScaledVector(span, 0.5)
      strut.scale.set(1, span.length(), 1)
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.normalize())
    },
  }
}

// The time rotor: a glass column of cyan tubes that pulse up and down, under the hanging drum stack.
function rotor(g) {
  const r = new THREE.Group()
  r.position.y = DECK.top + 0.08
  r.add(part(new THREE.CylinderGeometry(0.5, 0.55, 0.14, 32), silver, line, { position: [0, 0.07, 0] }))
  r.add(part(new THREE.CylinderGeometry(0.44, 0.44, 3.2, 32, 1, true), glass, null, { position: [0, 1.74, 0], shadows: false }))
  const core = new THREE.Group()
  const bar = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 10)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    core.add(part(bar, tube, null, { position: [0.2 * Math.sin(a), 0, 0.2 * Math.cos(a)], shadows: false }))
  }
  core.position.y = 1.74
  r.add(core)
  r.add(part(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 32), silver, line, { position: [0, 3.4, 0] }))
  g.add(r)
  // Hanging stack: a tapered neck from the rotor head, then three Gallifreyan drums widening upward. Each drum
  // has as many flat faces as makes every face square, and one engraved panel per face.
  const neckBase = r.position.y + 3.47
  g.add(part(new THREE.CylinderGeometry(1.2, 0.42, 1.6, 12), darkSteel, line, { position: [0, neckBase + 0.8, 0] }))
  let y = neckBase + 1.6
  for (const [radius, height] of [[1.9, 0.9], [2.6, 1], [3.3, 1.1]]) {
    const faces = Math.round(Math.PI / Math.asin(height / (2 * radius)))
    const panels = drumPanel.clone()
    panels.wrapS = THREE.RepeatWrapping
    panels.repeat.set(faces, 1)
    panels.needsUpdate = true
    const mat = toon({ map: panels, emissiveMap: panels, emissive: '#9fd6ff', emissiveIntensity: 0.25 })
    g.add(part(new THREE.CylinderGeometry(radius, radius, height, faces), mat, line, { position: [0, y + height / 2, 0] }))
    g.add(part(new THREE.CylinderGeometry(radius + 0.1, radius + 0.1, 0.12, faces), silver, thin, { position: [0, y + height, 0] }))
    y += height + 0.12
  }
  g.add(part(new THREE.CylinderGeometry(0.9, 0.9, H - y, 16), darkSteel, line, { position: [0, y + (H - y) / 2, 0] }))
  return core
}

// Lights live apart from the meshes: hiding a light changes every material's shader key (a recompile stall),
// so they are never hidden, only dimmed.
function lights() {
  const l = new THREE.Group()
  const core = new THREE.PointLight('#5ad2ff', 22, 14, 2)
  core.position.y = 3
  l.add(core)
  for (const d of [60, 150, 240, 330]) {
    const p = new THREE.PointLight('#5a86ff', 14, 16, 2)
    p.position.set(...atAngle(THREE.MathUtils.degToRad(d), 9, 5.5))
    l.add(p)
  }
  for (const p of l.children) p.userData.full = p.intensity
  return l
}

/**
 * `doorway` = { y, z, floor, width, height } of the opening in the box's local space; `content` is the DOM element
 * the monitor shows (draw pageView(camera)'s { matrix, camera } with pages.js). `screen` is the monitor in the box's space once swung round
 * to face the doors: its face centre (y, z) and its frame (w, h) and screen (innerW, innerH) sizes, which
 * fitMonitor(aspect, viewHeight) sets.
 */
export function createInterior(doorway, content) {
  const group = new THREE.Group()
  const floorZ = doorway.z - MASK_INSET
  const opening = new THREE.PlaneGeometry(doorway.width, doorway.height)
  const mask = new THREE.Mesh(opening, maskMat)
  mask.position.set(0, doorway.y, floorZ)
  mask.renderOrder = ORDER.mask
  const reset = new THREE.Mesh(opening, resetMat)
  reset.position.copy(mask.position)
  reset.renderOrder = ORDER.reset

  const inside = new THREE.Group()
  inside.position.y = doorway.floor
  inside.add(part(new THREE.PlaneGeometry(2.4, 1.4), darkSteel, null, { position: [0, 0.001, floorZ - 0.6], rotation: [-Math.PI / 2, 0, 0] }))
  const hall = new THREE.Group()
  hall.position.z = floorZ - R * Math.cos(GAP / 2) - 0.05
  shell(hall)
  balcony(hall)
  staircase(hall)
  platform(hall)
  consoles(hall)
  const core = rotor(hall)
  const mon = monitor(hall, content)
  // Everything but the parts that move (the rotor's core; the monitor, which also reshapes) merged to one draw call
  // per material.
  bake(hall, [core, mon.pivot])
  inside.add(hall)
  const lamps = lights()
  lamps.position.set(0, doorway.floor, hall.position.z)

  // Everything in the room is stencilled to the doorway until the camera is inside.
  const roomMats = new Set()
  inside.traverse((o) => {
    if (!o.isMesh) return
    o.renderOrder = ORDER.room
    roomMats.add(o.material)
  })
  for (const m of roomMats) {
    m.stencilWrite = true
    m.stencilRef = 1
  }
  group.add(mask, reset, inside, lamps)

  const screen = Object.assign(mon.size, { y: doorway.floor + EYE, z: hall.position.z + ARM })
  return {
    group,
    screen,
    pageView: mon.view,
    fitMonitor: mon.fit,
    // Haze for depth; only the room's materials take fog (the exterior opts out).
    fog: new THREE.FogExp2('#060a16', 0.028),
    // open: door angle (0 = shut). glow: 0..1 as the doors open; the room's lights scale with it so they do not
    // light the outside of the box during the orbit (point lights cannot be limited to the room).
    // swivel: 0 = monitor waiting behind the rotor on the left, 1 = in front facing the doors.
    // eye: the camera's world position.
    update({ inside: isInside, open, glow, swivel, eye }) {
      const f = isInside ? THREE.AlwaysStencilFunc : THREE.EqualStencilFunc
      for (const m of roomMats) m.stencilFunc = f
      // While the doors are shut nothing of the room can show, so skip its draw calls (and its shadow pass).
      mask.visible = reset.visible = open > 0
      inside.visible = open > 0 || isInside
      for (const l of lamps.children) l.intensity = l.userData.full * glow
      mon.pivot.rotation.y = MONITOR_START * (1 - swivel)
      // The content is drawn over the canvas, so it must only ever show over the room, and only from the front.
      // Shown and hidden by visibility, never display, so the page keeps its scroll, focus and selection.
      content.style.visibility = isInside && mon.faces(eye) ? 'visible' : 'hidden'
      const t = performance.now() / 1000
      core.position.y = 1.74 + Math.sin(t * 1.3) * 0.35
      core.rotation.y = t * 0.25
    },
  }
}
