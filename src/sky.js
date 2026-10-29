import * as THREE from 'three'

// The real naked-eye sky (Yale Bright Star Catalogue, packed by scripts/stars.py) plus a procedural Milky Way.
// It rides with the camera, so it is infinitely far: no parallax, visible at every lens and position.

// J2000 equatorial -> three.js axes, as in scripts/stars.py: x = cos d cos a, y = sin d, z = -cos d sin a.
const eq = (raDeg, decDeg) => {
  const a = THREE.MathUtils.degToRad(raDeg)
  const d = THREE.MathUtils.degToRad(decDeg)
  return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a))
}
const NGP = eq(192.85948, 27.12825) // north galactic pole (IAU)
const GC = eq(266.405, -28.93617) // galactic centre

const STAR_R = 140
const MILKY_R = 150
// The galactic centre sits off to the side of the opening view and the band is rolled diagonal,
// so the first frame has the Milky Way crossing behind the box rather than filling it.
const OFFSET = new THREE.Euler(0.25, 0.5, 0)
const ROLL = 0.7

// Value noise + fbm (after Inigo Quilez).
const NOISE = /* glsl */ `
float wHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float wFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * wNoise(p); p *= 2.03; a *= 0.5; } return s; }
`

const starMat = new THREE.ShaderMaterial({
  uniforms: { pixelRatio: { value: 1 } },
  vertexShader: /* glsl */ `
    attribute float mag;
    attribute float bv;
    uniform float pixelRatio;
    varying vec3 vColor;
    varying float vAlpha;
    // B-V -> temperature (Ballesteros 2012) -> blackbody colour (Tanner Helland's fit), softened toward white.
    vec3 starColor(float bv) {
      float t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62)) / 100.0;
      vec3 c;
      c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
      c.g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
      c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
      return mix(c, vec3(1.0), 0.35);
    }
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      float flux = pow(10.0, -0.4 * (mag - 1.0)); // relative to a magnitude-1 star
      gl_PointSize = clamp(2.6 * sqrt(flux), 1.6, 10.0) * pixelRatio;
      vAlpha = clamp(0.25 + flux, 0.25, 1.0);
      vColor = starColor(bv) * (0.7 + 1.6 * min(flux, 2.0)); // the brightest exceed 1.0 and bloom
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      gl_FragColor = vec4(vColor * exp(-d * d * 4.0) * vAlpha, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})

const milkyMat = new THREE.ShaderMaterial({
  uniforms: { ngp: { value: NGP }, gc: { value: GC } },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 ngp;
    uniform vec3 gc;
    varying vec3 vDir;
    ${NOISE}
    void main() {
      vec3 d = normalize(vDir);
      float b = asin(clamp(dot(d, ngp), -1.0, 1.0)); // galactic latitude
      float l = atan(dot(d, cross(ngp, gc)), dot(d, gc)); // galactic longitude, 0 at the centre
      float clouds = wFbm(d * 7.0);
      float dust = smoothstep(0.42, 0.72, wFbm(d * 16.0 + 3.0)) * exp(-pow(b / 0.05, 2.0));
      float band = exp(-pow(b / (0.07 + 0.04 * clouds), 2.0)) * (0.45 + 0.55 * exp(-pow(l / 1.4, 2.0)));
      float bulge = exp(-pow(l / 0.22, 2.0) - pow(b / 0.1, 2.0));
      float i = (band * (0.5 + clouds) + 1.3 * bulge) * (1.0 - 0.8 * dust);
      vec3 tint = mix(vec3(0.55, 0.62, 0.8), vec3(1.0, 0.86, 0.66), clamp(bulge * 1.5, 0.0, 1.0));
      gl_FragColor = vec4(tint * i * 0.035, 1.0);
    }`,
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})

/** `toward` = the direction the opening shot looks. Call update(camera) each frame. */
export function createSky(renderer, toward) {
  const group = new THREE.Group()
  const aim = toward.clone().normalize().applyEuler(OFFSET)
  group.quaternion.setFromAxisAngle(aim, ROLL).multiply(new THREE.Quaternion().setFromUnitVectors(GC, aim))
  const milky = new THREE.Mesh(new THREE.SphereGeometry(MILKY_R, 64, 32), milkyMat)
  milky.renderOrder = -2
  milky.frustumCulled = false
  const geometry = new THREE.BufferGeometry()
  const stars = new THREE.Points(geometry, starMat)
  stars.renderOrder = -1
  stars.frustumCulled = false
  group.add(milky, stars)

  // Loaded after start-up so the first frame of the box never waits on the catalogue.
  const ready = fetch('/stars.bin')
    .then((r) => {
      if (!r.ok) throw new Error(`stars.bin: HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    .then((buf) => {
      const v = new DataView(buf)
      const n = buf.byteLength / 8
      const pos = new Float32Array(n * 3)
      const mag = new Float32Array(n)
      const bv = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const o = i * 8
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = (v.getInt16(o + k * 2, true) / 32767) * STAR_R
        mag[i] = v.getUint8(o + 6) / 25 - 2
        bv[i] = v.getUint8(o + 7) / 40 - 0.5
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geometry.setAttribute('mag', new THREE.BufferAttribute(mag, 1))
      geometry.setAttribute('bv', new THREE.BufferAttribute(bv, 1))
    })

  return {
    group,
    ready, // resolves once the catalogue is loaded into the star geometry
    update(camera) {
      group.position.copy(camera.position)
      starMat.uniforms.pixelRatio.value = renderer.getPixelRatio()
    },
  }
}
