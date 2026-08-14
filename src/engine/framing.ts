import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface ModelBounds {
  box: THREE.Box3
  center: THREE.Vector3
  size: THREE.Vector3
  radius: number
}

/** World-space bounds of a subtree. Returns null when the subtree has no renderable geometry. */
export function computeBounds(root: THREE.Object3D): ModelBounds | null {
  root.updateWorldMatrix(true, true)

  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return null

  const min = box.min
  const max = box.max
  if (!isFinite(min.x + min.y + min.z + max.x + max.y + max.z)) return null

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() * 0.5, 1e-4)

  return { box, center, size, radius }
}

/**
 * Places the camera so the whole subtree fits both frustum axes, and rescales
 * near/far + control distances to the model so tiny and huge GLBs both work.
 */
export function frameObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D,
  options: { direction?: THREE.Vector3; fitOffset?: number } = {},
): ModelBounds | null {
  const bounds = computeBounds(root)
  if (!bounds) return null

  const fitOffset = options.fitOffset ?? 1.1
  const halfVFov = THREE.MathUtils.degToRad(camera.fov) * 0.5
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect)

  // Fit the bounding sphere against the tighter frustum axis: orientation-independent,
  // so box corners can never fall outside the view the way a per-axis box fit allows.
  const halfFov = Math.max(Math.min(halfVFov, halfHFov), 1e-3)
  const distance = (bounds.radius / Math.sin(halfFov)) * fitOffset

  const direction = (options.direction ?? new THREE.Vector3(1, 0.6, 1)).clone().normalize()

  camera.position.copy(bounds.center).addScaledVector(direction, distance)
  camera.near = Math.max(distance / 1000, bounds.radius / 1000, 1e-4)
  camera.far = Math.max(distance * 100, bounds.radius * 100, 100)
  camera.updateProjectionMatrix()
  camera.lookAt(bounds.center)

  controls.target.copy(bounds.center)
  controls.minDistance = camera.near * 10
  controls.maxDistance = camera.far * 0.5
  controls.update()

  return bounds
}
