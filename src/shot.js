import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { DOORWAY } from './tardis'
import { MASK_INSET } from './interior'
import { SCRUB } from './spec'

gsap.registerPlugin(ScrollTrigger)

const DEG = Math.PI / 180

// Every animated quantity of the shot. The scroll timeline is its only writer; aim() turns it into the camera.
export const createShot = () => ({
  az: 45, // camera azimuth around the box, degrees; 0 = straight at the doors
  el: 32, // camera elevation, degrees
  dist: 15 * Math.cos(32 * DEG), // horizontal distance from the box's centre during the orbit
  ty: 1.35, // target height
  walk: 0, // 0..1 along the one straight path from the end of the orbit, through the doorway, to the monitor
  bob: 1, // idle float amplitude, settled as the camera comes round to the doors
  door: 0, // 0 closed .. 1 open
  glow: 0, // light spilling out of the doorway
  rim: 1, // back light; it would also light the room, so the timeline fades it as the doors open
})

// From the target toward the camera, per metre of horizontal distance: elevation raises the camera without moving it
// away, so levelling the camera only ever lowers it.
const offset = (az, el, out) => out.set(Math.sin(az * DEG), Math.tan(el * DEG), Math.cos(az * DEG))

/** Where the opening shot looks: from the camera toward the box. */
export function openingDirection() {
  const { az, el } = createShot()
  return offset(az, el, new THREE.Vector3()).normalize().negate()
}

export const NEAR = 0.05 // camera near plane, m
// The shot is composed for a 16:10 screen. Narrower screens (portrait phones) keep its width, so the box and
// then the doorway sit centred across the screen; the vertical angle is capped where portrait perspective
// starts to visibly stretch (judged on the phone capture).
const COMPOSED_ASPECT = 16 / 10
const MAX_VFOV = 85

const APPROACH = 7.5 // camera distance from the box's centre as the orbit ends and the walk begins, m
const AT_DOOR = 0.02 // camera this far in front of the doorway is where inside begins, m
const DOOR = DOORWAY.z + AT_DOOR // that, as distance from the box's centre
// The doorway mask must still be beyond the near plane there, or it is clipped and the box shows through.
if (!(AT_DOOR + MASK_INSET > NEAR)) throw new Error('doorway crossing: mask would be clipped by the near plane')

// The lens is a function of how far the camera is from the doorway, never tweened on its own. Each key says how
// the lens gets there from the key before:
//   steady: tan(fov/2) ~ dist^-k, k < 1, which can never widen faster than the camera closes; for the orbit,
//     where the camera is at rest at both ends, so the rate change at a key cannot be felt;
//   settle: a smoothstep, landing on the key with zero rate; for the doorway, which the camera passes at speed,
//     so the lens comes to rest with no jolt (one still widening as it hit its final value read as a snap).
// Inside, it holds the last key. Keys are converted for the window's shape first (narrow windows keep the composed
// width, capped), so the stretches, and the landing's zero rate, hold on every screen.
const tanHalf = (fov) => Math.tan((fov * DEG) / 2)
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const steady = ([d0, f0], [d1, f1], dist) => {
  const k = Math.log(tanHalf(f1) / tanHalf(f0)) / Math.log(d0 / d1)
  return (2 * Math.atan(tanHalf(f0) * (d0 / dist) ** k)) / DEG
}
const settle = ([d0, f0], [d1, f1], dist) => f0 + (f1 - f0) * smooth(d0, d1, dist)
// [distance from centre m, fov degrees, how it is reached from the key before], far to near
const LENS = [[15 * Math.cos(32 * DEG), 17], [APPROACH, 26, steady], [DOOR, 50, settle]]
function lensFor(dist, aspect) {
  const keys = LENS.map(([d, fov, how]) => [d, viewFov(fov, aspect), how])
  if (dist >= keys[0][0]) return keys[0][1]
  if (dist <= keys.at(-1)[0]) return keys.at(-1)[1]
  const i = keys.findIndex(([d]) => d <= dist) // the nearer key of the stretch holding dist
  return keys[i][2](keys[i - 1], keys[i], dist)
}
// Narrow (portrait) windows keep the composed shot's width, up to MAX_VFOV.
function viewFov(fov, aspect) {
  if (aspect >= COMPOSED_ASPECT) return fov
  return Math.min((2 * Math.atan((tanHalf(fov) * COMPOSED_ASPECT) / aspect)) / DEG, MAX_VFOV)
}
/** Throws if, for this window shape, the lens would ever widen faster than the camera closes (a step back). */
export function checkLens(aspect) {
  for (let n = 1, prev = Infinity; n <= 2000; n++) {
    const dist = LENS[0][0] + (DOOR - LENS[0][0]) * (n / 2000)
    const span = (dist - DOORWAY.z) * tanHalf(lensFor(dist, aspect)) // the view's half-height at the doorway's plane
    if (!(span < prev)) throw new Error(`lens widens faster than the camera closes at ${dist.toFixed(2)} m, aspect ${aspect.toFixed(2)}`)
    prev = span
  }
}

const dir = new THREE.Vector3()
const look = new THREE.Vector3()
/**
 * The camera, from the shot: the one function every frame's motion comes from. `screen` = the monitor
 * ({ y, z, h }: its face's centre and frame height) the walk ends on, its frame exactly filling the view.
 * Returns where the camera is on the walk: `inside` (past the doorway), `toDoor` (metres short of it, 0 once
 * inside) and `walkedIn` (0..1 of the way from the doorway to the monitor).
 */
export function aim(camera, shot, screen) {
  // Walking straight in along -z: from APPROACH out front, through the doorway, to where the frame fills the view.
  // The end depends on the lens there, which is the last key's whatever the distance, so it is known up front.
  const end = screen.z + screen.h / 2 / tanHalf(lensFor(DOOR, camera.aspect))
  // Camera depth in the box's space: the orbit's distance, then carried on by the walk (which starts once the orbit
  // has closed to APPROACH) all the way to `end`.
  const z = shot.dist + (end - APPROACH) * shot.walk
  // Horizontal distance from the box's centre, held at the doorway once inside, where the target moves on instead.
  const d = Math.max(z, DOOR)
  camera.fov = lensFor(d, camera.aspect)
  camera.updateProjectionMatrix()
  offset(shot.az, shot.el, dir)
  camera.position.set(0, shot.ty, Math.min(0, z - DOOR)).addScaledVector(dir, d)
  look.copy(camera.position).sub(dir)
  camera.lookAt(look)
  return {
    inside: z < DOOR,
    toDoor: Math.max(0, z - DOOR),
    walkedIn: Math.min(1, Math.max(0, (DOOR - z) / (DOOR - end))),
  }
}
/** Derived from the walk, so they can never disagree with where the camera is. */
export const cues = ({ toDoor, walkedIn }) => ({
  // The key light is gone by the threshold: past it the box's own shadow on the room floor would vanish at once.
  moon: smooth(0.05, 1.5, toDoor),
  // The monitor swings round once the visitor is in, and has faced them well before they reach it.
  swivel: smooth(0.04, 0.7, walkedIn),
})

const WALK_START = 5.8
const WALK = 8.5 // timeline seconds for the whole walk, one ease from standstill to standstill

/**
 * Scroll-scrubbed timeline over `shot`, levelling out at the monitor `screen`'s height ({ y }); `arrived` starts it at
 * the monitor. `onEnd(true)` when the camera has arrived at the monitor, `onEnd(false)` when leaving it.
 */
export function scrollTimeline(shot, screen, arrived, onEnd) {
  // A cinematic always starts from the top; restored scroll would scrub the camera mid-flight on load.
  ScrollTrigger.clearScrollMemory('manual')
  scrollTo(0, 0)
  let ended = false
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    onUpdate: () => {
      const now = tl.progress() === 1
      if (now !== ended) onEnd((ended = now))
    },
  })
  tl.to(shot, { az: 360, duration: 5, ease: 'power1.inOut' }, 0)
    .to(shot, { el: 7, dist: APPROACH, duration: 5, ease: 'sine.inOut' }, 0)
    .to('#hint', { opacity: 0, duration: 0.6 }, 0)
    .to(shot, { bob: 0, duration: 2.1, ease: 'sine.inOut' }, 3.5)
    .to(shot, { door: 1, glow: 1, duration: 2, ease: 'power2.inOut' }, 4.6)
    .to(shot, { rim: 0, duration: 1.4 }, 4.6)
    // Settle straight to eye height for the walk in: level, looking straight ahead, never dipping.
    .to(shot, { ty: screen.y, el: 0, duration: 2.5, ease: 'sine.inOut' }, 5.6)
    // One ease for the whole walk, doorway included: speed is continuous everywhere, so there is no seam to feel.
    .to(shot, { walk: 1, duration: WALK, ease: 'sine.inOut' }, WALK_START)

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tl.progress(1)
    document.getElementById('runway').remove()
    return
  }
  // end: 'max' = the page's real scroll limit, so a phone toolbar changing the height can never strand the end.
  // The runway is sized in viewport heights, so a resize moves every scroll position; hold the visitor's place in
  // the shot instead. Their place is read on every scroll event against the range ScrollTrigger last measured (which
  // only changes on a refresh), so it is current when a refresh begins (ScrollTrigger's own progress updates only on
  // its next tick, which a refresh can precede); the refresh ends by putting them back there.
  const st = ScrollTrigger.create({ animation: tl, trigger: '#runway', start: 'top top', end: 'max', scrub: SCRUB })
  let place = 0
  let held = 0
  addEventListener('scroll', () => (place = (scrollY - st.start) / (st.end - st.start)), { passive: true })
  ScrollTrigger.addEventListener('refreshInit', () => (held = place))
  ScrollTrigger.addEventListener('refresh', () => st.scroll(st.start + held * (st.end - st.start)))
  if (arrived) {
    tl.progress(1)
    st.scroll(st.end)
    place = 1 // now, not on the scroll event: the load's refresh can come first, and would put them back at the top
  }
}
