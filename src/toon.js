import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

// Cel kit: hard-banded toon shading plus inverted-hull ink outlines.

// Three light bands (shadow, mid, lit). Nearest filtering keeps the steps hard.
const ramp = new THREE.DataTexture(new Uint8Array([46, 128, 255]), 3, 1, THREE.RedFormat)
ramp.minFilter = ramp.magFilter = THREE.NearestFilter
ramp.needsUpdate = true

export const toon = (params) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...params })

// Back faces pushed out along averaged normals and drawn flat: the classic inverted-hull outline.
export function ink(thickness, color = '#03050a') {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { thickness: { value: thickness }, color: { value: new THREE.Color(color) } }]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float thickness;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position + normal * thickness, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }`,
    side: THREE.BackSide,
    fog: true,
  })
}

// Hull geometry: positions welded so split normals (box corners, cylinder caps) average into one,
// which keeps the pushed-out shell closed instead of cracking at hard edges.
const hulls = new WeakMap()
function hullOf(geometry) {
  let hull = hulls.get(geometry)
  if (!hull) {
    const welded = geometry.clone()
    welded.deleteAttribute('normal')
    welded.deleteAttribute('uv')
    hull = mergeVertices(welded)
    hull.computeVertexNormals()
    hulls.set(geometry, hull)
  }
  return hull
}

const boxes = new Map()
/** Shared box geometry per size, so identical parts share one hull. */
export function box(w, h, d) {
  const key = `${w},${h},${d}`
  if (!boxes.has(key)) boxes.set(key, new THREE.BoxGeometry(w, h, d))
  return boxes.get(key)
}

/** A shaded mesh with its outline as a child. `outline` is an ink() material, or null for none. */
export function part(geometry, material, outline, { position, rotation, shadows = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material)
  if (position) mesh.position.set(...position)
  if (rotation) mesh.rotation.set(...rotation)
  mesh.castShadow = mesh.receiveShadow = shadows
  if (outline) mesh.add(new THREE.Mesh(hullOf(geometry), outline))
  return mesh
}

/**
 * Merges every mesh under `root` (but not under `keep`, the parts that move) into one mesh per material, so a static
 * assembly of many small parts costs one draw call per material instead of one per part. Instanced meshes stay.
 */
export function bake(root, keep = []) {
  root.updateMatrixWorld(true)
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const moving = new Set()
  for (const k of keep) k.traverse((o) => moving.add(o))
  const groups = new Map()
  const baked = []
  const m = new THREE.Matrix4()
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || moving.has(o)) return
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}|${Object.keys(o.geometry.attributes).sort()}`
    if (!groups.has(key)) groups.set(key, { from: o, geometries: [] })
    const g = o.geometry.clone().applyMatrix4(m.multiplyMatrices(toRoot, o.matrixWorld))
    // A mirroring transform turns faces inside out; flip their winding back.
    if (m.determinant() < 0) {
      const index = g.index.array
      for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]]
    }
    groups.get(key).geometries.push(g)
    baked.push(o)
  })
  for (const o of baked) o.removeFromParent()
  for (const { from, geometries } of groups.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), from.material)
    mesh.castShadow = from.castShadow
    mesh.receiveShadow = from.receiveShadow
    mesh.renderOrder = from.renderOrder
    root.add(mesh)
  }
}

export function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...repeat)
  }
  return t
}
