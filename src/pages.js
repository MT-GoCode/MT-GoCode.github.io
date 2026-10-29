// The page, drawn in 3D over the canvas where a three.js camera sees it: what CSS3DRenderer does, but as one
// transform on the element itself, under its layer's perspective. CSS3DRenderer nests the element in a camera element
// pushed out to exactly the eye, where Chrome's hit-testing fails: the page shows, but every click passes through it.
// Matrices follow CSS3DRenderer's conventions (CSS y points down).
const eps = (v) => (Math.abs(v) < 1e-10 ? 0 : v)
const cameraCSS = (m) => `matrix3d(${m.elements.map((v, i) => eps(i % 4 === 1 ? -v : v)).join(',')})`
const objectCSS = (m) => `matrix3d(${m.elements.map((v, i) => eps(i >= 4 && i < 8 ? -v : v)).join(',')})`

/** `element` placed by render(matrix, camera): `matrix` is its world matrix, in the camera's units. */
export function createPages(host, element) {
  const layer = document.createElement('div')
  layer.id = 'pages'
  layer.append(element)
  host.append(layer)
  element.style.transformOrigin = '0 0'
  let w = 0
  let h = 0
  return {
    setSize(width, height) {
      w = width
      h = height
    },
    render(matrix, camera) {
      const lens = (camera.projectionMatrix.elements[5] * h) / 2 // px from the eye to the plane drawn at 1:1
      layer.style.perspective = `${lens}px`
      element.style.transform = `translate(${w / 2}px, ${h / 2}px) translateZ(${lens}px) ${cameraCSS(camera.matrixWorldInverse)} ${objectCSS(matrix)} translate(-50%, -50%)`
    },
  }
}
