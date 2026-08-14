import * as THREE from 'three'
import type { PivotMode, PivotSpec, Vec3 } from './types'

export interface PivotBinding {
  /** The object interactions should drive. */
  driver: THREE.Object3D
  /** True when `driver` is a proxy group this service created. */
  proxy: boolean
  /** World-space pivot point in use. */
  point: THREE.Vector3
  release: () => void
}

/**
 * Pivot correction without touching vertex data: the target (or a set of
 * targets) is re-parented into a proxy group placed at the desired hinge point.
 * Object3D.attach() preserves the world matrix, so nothing moves on screen when
 * the pivot changes — only the origin of future rotations does.
 */
export class PivotService {
  private bindings = new Map<string, PivotBinding>()

  /**
   * Binds a driver for one interaction. Re-binding the same key releases the
   * previous proxy first, so pivot edits never stack groups.
   */
  bind(
    key: string,
    targets: THREE.Object3D[],
    spec: PivotSpec,
    options: { includeChildren?: boolean } = {},
  ): PivotBinding | null {
    this.release(key)

    const valid = targets.filter(Boolean)
    if (valid.length === 0) return null

    const primary = valid[0]
    const parent = primary.parent
    const needsProxy = spec.mode !== 'original' || valid.length > 1

    if (!needsProxy || !parent) {
      const binding: PivotBinding = {
        driver: primary,
        proxy: false,
        point: primary.getWorldPosition(new THREE.Vector3()),
        release: () => {},
      }
      this.bindings.set(key, binding)
      return binding
    }

    const point = resolvePivotPoint(valid, spec, options.includeChildren ?? true)

    const group = new THREE.Group()
    group.name = `__pivot_${key}`
    group.userData.pivotProxy = true
    parent.add(group)

    // Place the group at the pivot in the parent's local space, then attach the
    // targets: attach() rewrites their local transform so the world pose holds.
    parent.updateWorldMatrix(true, false)
    group.position.copy(parent.worldToLocal(point.clone()))
    group.updateMatrixWorld(true)

    const restored: Array<{ object: THREE.Object3D; parent: THREE.Object3D; index: number }> = []
    for (const target of valid) {
      const originalParent = target.parent
      if (!originalParent) continue
      restored.push({ object: target, parent: originalParent, index: originalParent.children.indexOf(target) })
      group.attach(target)
    }

    const binding: PivotBinding = {
      driver: group,
      proxy: true,
      point,
      release: () => {
        for (const entry of restored) {
          // attach() again on the way out: the world pose survives the unwrap.
          entry.parent.attach(entry.object)
          const currentIndex = entry.parent.children.indexOf(entry.object)
          if (currentIndex >= 0 && entry.index >= 0 && currentIndex !== entry.index) {
            entry.parent.children.splice(currentIndex, 1)
            entry.parent.children.splice(entry.index, 0, entry.object)
          }
        }
        group.removeFromParent()
      },
    }

    this.bindings.set(key, binding)
    return binding
  }

  get(key: string): PivotBinding | null {
    return this.bindings.get(key) ?? null
  }

  release(key: string): void {
    const binding = this.bindings.get(key)
    if (!binding) return
    binding.release()
    this.bindings.delete(key)
  }

  releaseAll(): void {
    for (const key of [...this.bindings.keys()]) this.release(key)
  }
}

/** World-space point implied by a pivot mode over the targets' bounds. */
export function resolvePivotPoint(
  targets: THREE.Object3D[],
  spec: PivotSpec,
  includeChildren = true,
): THREE.Vector3 {
  if (spec.mode === 'custom' && spec.point) {
    return new THREE.Vector3().fromArray(spec.point)
  }

  const primary = targets[0]
  if (spec.mode === 'original') return primary.getWorldPosition(new THREE.Vector3())

  const box = worldBounds(targets, includeChildren)
  if (!box) return primary.getWorldPosition(new THREE.Vector3())

  const center = box.getCenter(new THREE.Vector3())
  switch (spec.mode) {
    case 'left':
      return new THREE.Vector3(box.min.x, center.y, center.z)
    case 'right':
      return new THREE.Vector3(box.max.x, center.y, center.z)
    case 'top':
      return new THREE.Vector3(center.x, box.max.y, center.z)
    case 'bottom':
      return new THREE.Vector3(center.x, box.min.y, center.z)
    case 'center':
    default:
      return center
  }
}

/** Candidate pivot points for every mode, used by the UI preview. */
export function pivotPreview(targets: THREE.Object3D[], includeChildren = true): Record<PivotMode, Vec3 | null> {
  const modes: PivotMode[] = ['original', 'center', 'left', 'right', 'top', 'bottom']
  const preview = {} as Record<PivotMode, Vec3 | null>

  for (const mode of modes) {
    preview[mode] = resolvePivotPoint(targets, { mode }, includeChildren).toArray() as Vec3
  }
  preview.custom = null
  return preview
}

function worldBounds(targets: THREE.Object3D[], includeChildren: boolean): THREE.Box3 | null {
  const box = new THREE.Box3()
  let found = false

  for (const target of targets) {
    target.updateWorldMatrix(true, true)
    const single = new THREE.Box3()

    if (includeChildren) {
      single.setFromObject(target, true)
    } else {
      const mesh = target as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
        single.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld)
      } else {
        single.setFromObject(target, true)
      }
    }

    if (single.isEmpty()) continue
    box.union(single)
    found = true
  }

  return found ? box : null
}
