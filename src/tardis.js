import * as THREE from 'three'
import { toon, ink, box, part, bake, canvasTexture } from './toon'
import { createInterior, ORDER } from './interior'

// Dimensions in metres, after the 1963 Peter Brachacki prop: ~1.5 m base, ~2.7 m to the lamp.
const POST = 0.13
const HALF = 0.6 // post centre offset from box centre
const IN = HALF - POST / 2 // inner edge of posts = half the door span
const FACE_Z = 0.55
const BASE_H = 0.12
const DOOR_H = 1.93
const SIGN_H = 0.24
const TOP = BASE_H + DOOR_H + SIGN_H // top of posts / sign boxes
const LEAF_W = IN
const STILE = 0.05
const RAIL = 0.05
const RAIL_BOTTOM = 0.1
const WINDOW_H = 0.42
const PANEL_H = (DOOR_H - RAIL_BOTTOM - 3 * RAIL - WINDOW_H - RAIL) / 3

export const DOORWAY = { y: BASE_H + DOOR_H / 2, z: FACE_Z, floor: BASE_H, width: 2 * IN, height: DOOR_H }

const FONT = '"Gill Sans", "Gill Sans MT", "Helvetica Neue", Arial, sans-serif'

const signTex = canvasTexture(1024, 236, (g, w, h) => {
  g.fillStyle = '#0a0a0c'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#ffffff'
  g.textBaseline = 'middle'
  g.font = `600 100px ${FONT}`
  g.textAlign = 'left'
  g.fillText('POLICE', 60, h / 2 + 6)
  g.textAlign = 'right'
  g.fillText('BOX', w - 60, h / 2 + 6)
  g.textAlign = 'center'
  g.font = `600 44px ${FONT}`
  g.fillText('PUBLIC', w / 2 + 70, h / 2 - 26)
  g.fillText('CALL', w / 2 + 70, h / 2 + 30)
})

const noticeTex = canvasTexture(512, 440, (g, w, h) => {
  g.fillStyle = '#f3f0e6'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = '#1a1a1a'
  g.lineWidth = 6
  g.strokeRect(14, 14, w - 28, h - 28)
  g.fillStyle = '#111'
  g.textAlign = 'center'
  const lines = [
    ['600 50px', 'POLICE TELEPHONE'],
    ['500 34px', 'FREE'],
    ['500 30px', 'FOR USE OF'],
    ['600 46px', 'PUBLIC'],
    ['500 26px', 'ADVICE & ASSISTANCE'],
    ['500 26px', 'OBTAINABLE IMMEDIATELY'],
    ['500 26px', 'OFFICERS & CARS'],
    ['500 26px', 'RESPOND TO ALL CALLS'],
    ['600 40px', 'PULL TO OPEN'],
  ]
  lines.forEach(([f, s], i) => {
    g.font = `${f} ${FONT}`
    g.fillText(s, w / 2, 70 + i * 43)
  })
})

const paint = toon({ color: '#164584' })
const recess = toon({ color: '#0e2c5c' })
const glass = toon({ color: '#efe9da', emissive: '#ffe1ad', emissiveIntensity: 1.15 })
const lampGlass = toon({ color: '#ffffff', emissive: '#fff1cf', emissiveIntensity: 1.8 })
const signFace = toon({ map: signTex, emissiveMap: signTex, emissive: '#ffffff', emissiveIntensity: 1.3 })
const notice = toon({ map: noticeTex })
const brass = toon({ color: '#c9a04f' })
// The scene fog belongs to the interior; the box stands in clear space.
for (const m of [paint, recess, glass, lampGlass, signFace, notice, brass]) m.fog = false
const line = ink(0.013)
line.fog = false
const fine = ink(0.006)
fine.fog = false

const plane = (w, h) => new THREE.PlaneGeometry(w, h)

// One door leaf drawn hinge-at-origin, spanning +x, front surface at z=0.
function leaf({ withNotice = false, hardware = false } = {}) {
  const g = new THREE.Group()
  const add = (m) => g.add(m)
  add(part(box(LEAF_W, DOOR_H, 0.03), recess, null, { position: [LEAF_W / 2, DOOR_H / 2, -0.015] }))
  add(part(box(STILE, DOOR_H, 0.04), paint, line, { position: [STILE / 2, DOOR_H / 2, 0.02] }))
  add(part(box(STILE, DOOR_H, 0.04), paint, line, { position: [LEAF_W - STILE / 2, DOOR_H / 2, 0.02] }))
  const inner = LEAF_W - 2 * STILE
  let y = 0
  const rail = (h) => {
    add(part(box(inner, h, 0.035), paint, line, { position: [LEAF_W / 2, y + h / 2, 0.0175] }))
    y += h
  }
  rail(RAIL_BOTTOM)
  for (let i = 0; i < 3; i++) {
    if (withNotice && i === 2) add(part(plane(0.3, 0.26), notice, null, { position: [LEAF_W / 2, y + PANEL_H / 2, 0.006] }))
    y += PANEL_H
    rail(RAIL)
  }
  add(part(plane(inner, WINDOW_H), glass, null, { position: [LEAF_W / 2, y + WINDOW_H / 2, 0.004], shadows: false }))
  add(part(box(0.022, WINDOW_H, 0.022), paint, fine, { position: [LEAF_W / 2, y + WINDOW_H / 2, 0.012] }))
  for (const k of [1, 2]) add(part(box(inner, 0.022, 0.022), paint, fine, { position: [LEAF_W / 2, y + (WINDOW_H * k) / 3, 0.012] }))
  y += WINDOW_H
  rail(RAIL)
  if (hardware) {
    const at = [LEAF_W - STILE * 1.6, RAIL_BOTTOM + 2 * PANEL_H + 1.5 * RAIL, 0.045]
    add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20), brass, fine, { position: at, rotation: [Math.PI / 2, 0, 0] }))
    add(part(new THREE.SphereGeometry(0.016, 14, 10), brass, fine, { position: [at[0], at[1] - 0.09, at[2] + 0.012] }))
  }
  return g
}

// A pair of leaves on one face. Returns the face group and its two hinge groups.
function face(rotation, { front = false } = {}) {
  const g = new THREE.Group()
  g.rotation.y = rotation
  const leaves = new THREE.Group()
  leaves.position.set(0, BASE_H, FACE_Z)
  const left = new THREE.Group()
  left.position.x = -IN
  left.add(leaf({ withNotice: front }))
  const right = new THREE.Group()
  right.position.x = IN
  const mirrored = leaf({ hardware: front })
  mirrored.scale.x = -1
  right.add(mirrored)
  leaves.add(left, right)
  const y = BASE_H + DOOR_H + SIGN_H / 2
  g.add(leaves)
  g.add(part(box(2 * IN, SIGN_H, 0.16), paint, line, { position: [0, y, FACE_Z + 0.02] }))
  g.add(part(plane(2 * IN - 0.06, SIGN_H - 0.05), signFace, null, { position: [0, y, FACE_Z + 0.101], shadows: false }))
  return { group: g, left, right }
}

function roof() {
  const g = new THREE.Group()
  g.add(part(box(1.42, 0.1, 1.42), paint, line, { position: [0, TOP + 0.05, 0] }))
  g.add(part(box(1.32, 0.07, 1.32), paint, line, { position: [0, TOP + 0.135, 0] }))
  g.add(part(box(1.22, 0.06, 1.22), paint, line, { position: [0, TOP + 0.2, 0] }))
  g.add(part(new THREE.ConeGeometry(0.86, 0.12, 4, 1), paint, line, { position: [0, TOP + 0.29, 0], rotation: [0, Math.PI / 4, 0] }))
  const lamp = new THREE.Group()
  lamp.position.y = TOP + 0.35
  lamp.add(part(box(0.2, 0.04, 0.2), paint, fine))
  lamp.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.17, 20), lampGlass, null, { position: [0, 0.11, 0], shadows: false }))
  for (const a of [45, 135, 225, 315]) {
    const r = THREE.MathUtils.degToRad(a)
    lamp.add(part(box(0.018, 0.17, 0.018), paint, fine, { position: [0.07 * Math.cos(r), 0.11, 0.07 * Math.sin(r)] }))
  }
  lamp.add(part(new THREE.CylinderGeometry(0.04, 0.095, 0.05, 20), paint, fine, { position: [0, 0.215, 0] }))
  lamp.add(part(new THREE.SphereGeometry(0.025, 14, 10), paint, fine, { position: [0, 0.26, 0] }))
  g.add(lamp)
  return g
}

/**
 * The box plus its interior; `content` is the DOM element the console monitor shows. Add `fog` to the scene; render
 * pageView(camera)'s { matrix, camera } with pages.js; `screen` is the monitor in the box's space, shaped to the window by
 * fitMonitor(aspect, viewHeight); call update({ open, glow, inside, swivel, eye }) each frame, eye = camera position.
 */
export function createTardis(content) {
  const group = new THREE.Group()
  const exterior = new THREE.Group()
  exterior.add(part(box(1.5, BASE_H, 1.5), paint, line, { position: [0, BASE_H / 2, 0] }))
  for (const [x, z] of [[HALF, HALF], [-HALF, HALF], [HALF, -HALF], [-HALF, -HALF]])
    exterior.add(part(box(POST, TOP - BASE_H, POST), paint, line, { position: [x, BASE_H + (TOP - BASE_H) / 2, z] }))
  const front = face(0, { front: true })
  // The front doors draw after the room, so the room shows only where they are open.
  for (const hinge of [front.left, front.right]) hinge.traverse((o) => o.isMesh && (o.renderOrder = ORDER.doors))
  exterior.add(front.group, face(Math.PI / 2).group, face(Math.PI).group, face(-Math.PI / 2).group, roof())
  // Static parts merged to one draw call per material; each front door leaf merged within itself, as it swings whole.
  bake(exterior, [front.left, front.right])
  bake(front.left)
  bake(front.right)
  // Lights stay outside `exterior`, which is hidden once inside: a hidden light recompiles every lit material.
  const lamp = new THREE.PointLight('#ffe2a8', 1.2, 2.5, 2)
  lamp.position.y = TOP + 0.46
  const spill = new THREE.PointLight('#ffc777', 0, 4, 2)
  spill.position.set(0, 1.2, 0.35)
  const interior = createInterior(DOORWAY, content)
  group.add(exterior, lamp, spill, interior.group)
  return {
    group,
    fog: interior.fog,
    screen: interior.screen,
    pageView: interior.pageView,
    fitMonitor: interior.fitMonitor,
    update({ open, glow, inside, swivel, eye }) {
      front.left.rotation.y = open
      front.right.rotation.y = -open
      spill.intensity = glow * 6
      exterior.visible = !inside
      interior.update({ inside, open, glow, swivel, eye })
    },
  }
}
