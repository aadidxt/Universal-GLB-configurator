import * as THREE from 'three'
import { describeMaterial, toMaterialArray } from './scanner/ModelScanner'
import type { MaterialEntry } from './scanner/types'

export interface MaterialPatch {
  color?: string
  opacity?: number
  transparent?: boolean
  metalness?: number
  roughness?: number
  emissive?: string
  emissiveIntensity?: number
}

/**
 * "shared" writes straight to the material every user sees.
 * "isolate" clones first so only the selected object changes.
 */
export type MaterialEditScope = 'shared' | 'isolate'

export interface MaterialEditResult {
  /** Material actually written to (the clone, when isolating). */
  materialId: string
  cloned: boolean
  /** Registry rows to merge back into the manifest. */
  materials: MaterialEntry[]
  /** Materials that disappeared from the registry. */
  removedMaterialIds: string[]
  /** New material id list for the edited object. */
  objectId: string
  objectMaterialIds: string[]
}

/**
 * Live material registry for the loaded model plus the edit/clone rules.
 * Textures are shared by reference through clones, so a color change tints a
 * textured material instead of dropping its maps.
 */
export class MaterialService {
  private materials = new Map<string, THREE.Material>()
  private objects = new Map<string, THREE.Object3D>()
  private users = new Map<string, Set<string>>()
  /** Materials no object references any more; disposed when the model unloads. */
  private orphans = new Set<THREE.Material>()

  setIndex(objects: Map<string, THREE.Object3D>, materials: Map<string, THREE.Material>): void {
    this.disposeOrphans()
    this.objects = objects
    this.materials = materials
    this.users = new Map()

    for (const [id, object] of objects) {
      for (const material of toMaterialArray((object as THREE.Mesh).material)) {
        this.addUser(material.uuid, id)
      }
    }
  }

  clear(): void {
    this.disposeOrphans()
    this.materials = new Map()
    this.objects = new Map()
    this.users = new Map()
  }

  getMaterial(id: string): THREE.Material | null {
    return this.materials.get(id) ?? null
  }

  userCount(materialId: string): number {
    return this.users.get(materialId)?.size ?? 0
  }

  /** True when writing to this material would visibly change other objects too. */
  isShared(materialId: string, objectId: string): boolean {
    const users = this.users.get(materialId)
    if (!users) return false
    return users.size > 1 || (users.size === 1 && !users.has(objectId))
  }

  /**
   * Applies a patch to one material slot of one object.
   * With scope "isolate" the material is cloned first unless the object is
   * already its only user, in which case cloning would just waste memory.
   */
  edit(objectId: string, slot: number, patch: MaterialPatch, scope: MaterialEditScope): MaterialEditResult | null {
    const object = this.objects.get(objectId) as THREE.Mesh | undefined
    if (!object) return null

    const slots = toMaterialArray(object.material)
    const current = slots[slot]
    if (!current) return null

    const removedMaterialIds: string[] = []
    let target = current
    let cloned = false

    if (scope === 'isolate' && this.isShared(current.uuid, objectId)) {
      target = current.clone()
      target.name = uniqueCloneName(current.name || current.type)
      // clone() copies texture references, so every map survives the split.
      cloned = true

      if (Array.isArray(object.material)) {
        const next = object.material.slice()
        next[slot] = target
        object.material = next
      } else {
        object.material = target
      }

      this.materials.set(target.uuid, target)
      this.removeUser(current.uuid, objectId, removedMaterialIds)
      this.addUser(target.uuid, objectId)
    }

    applyPatch(target, patch)
    target.needsUpdate = true

    const touched = new Set<string>([target.uuid])
    if (cloned) touched.add(current.uuid)

    return {
      materialId: target.uuid,
      cloned,
      objectId,
      objectMaterialIds: toMaterialArray(object.material).map((material) => material.uuid),
      materials: [...touched]
        .filter((id) => this.materials.has(id))
        .map((id) => this.describe(id)),
      removedMaterialIds,
    }
  }


  /** Material id currently bound to one slot of an object. */
  getSlotMaterialId(objectId: string, slot: number): string | null {
    const object = this.objects.get(objectId) as THREE.Mesh | undefined
    if (!object) return null
    return toMaterialArray(object.material)[slot]?.uuid ?? null
  }

  /** Reads back just the properties a patch would overwrite, for undo. */
  readValues(materialId: string, patch: MaterialPatch): MaterialPatch {
    const material = this.materials.get(materialId) ?? this.findOrphan(materialId)
    if (!material) return {}

    const source = material as THREE.MeshStandardMaterial
    const values: MaterialPatch = {}
    if (patch.color !== undefined && source.color) values.color = `#${source.color.getHexString()}`
    if (patch.emissive !== undefined && source.emissive) values.emissive = `#${source.emissive.getHexString()}`
    if (patch.emissiveIntensity !== undefined) values.emissiveIntensity = source.emissiveIntensity
    if (patch.metalness !== undefined) values.metalness = source.metalness
    if (patch.roughness !== undefined) values.roughness = source.roughness
    if (patch.opacity !== undefined) {
      values.opacity = material.opacity
      values.transparent = material.transparent
    }
    if (patch.transparent !== undefined) values.transparent = material.transparent
    return values
  }

  /** Writes a patch straight to a material id, bypassing scope rules (undo/redo). */
  applyTo(materialId: string, patch: MaterialPatch): MaterialEntry | null {
    const material = this.materials.get(materialId) ?? this.findOrphan(materialId)
    if (!material) return null

    applyPatch(material, patch)
    material.needsUpdate = true
    return this.materials.has(materialId) ? this.describe(materialId) : describeMaterial(material)
  }

  /**
   * Binds an existing material (possibly an orphaned clone) to one slot.
   * This is what makes cloning undoable and redoable without re-cloning.
   */
  assign(objectId: string, slot: number, materialId: string): MaterialEditResult | null {
    const object = this.objects.get(objectId) as THREE.Mesh | undefined
    if (!object) return null

    const slots = toMaterialArray(object.material)
    const current = slots[slot]
    if (!current) return null

    const next = this.materials.get(materialId) ?? this.findOrphan(materialId)
    if (!next) return null
    if (current.uuid === next.uuid) return null

    if (Array.isArray(object.material)) {
      const list = object.material.slice()
      list[slot] = next
      object.material = list
    } else {
      object.material = next
    }

    const removedMaterialIds: string[] = []
    this.removeUser(current.uuid, objectId, removedMaterialIds)

    this.orphans.delete(next)
    this.materials.set(next.uuid, next)
    this.addUser(next.uuid, objectId)

    const touched = [next.uuid, current.uuid].filter((id) => this.materials.has(id))
    return {
      materialId: next.uuid,
      cloned: false,
      objectId,
      objectMaterialIds: toMaterialArray(object.material).map((material) => material.uuid),
      materials: touched.map((id) => this.describe(id)),
      removedMaterialIds,
    }
  }

  private findOrphan(materialId: string): THREE.Material | null {
    for (const material of this.orphans) {
      if (material.uuid === materialId) return material
    }
    return null
  }

  /** Registry row for a material, including its current user list. */
  describe(materialId: string): MaterialEntry {
    const material = this.materials.get(materialId)
    if (!material) throw new Error(`Unknown material: ${materialId}`)
    const entry = describeMaterial(material)
    entry.userIds = [...(this.users.get(materialId) ?? [])]
    return entry
  }

  private addUser(materialId: string, objectId: string): void {
    const set = this.users.get(materialId) ?? new Set<string>()
    set.add(objectId)
    this.users.set(materialId, set)
  }

  private removeUser(materialId: string, objectId: string, removed: string[]): void {
    const set = this.users.get(materialId)
    if (!set) return
    set.delete(objectId)
    if (set.size > 0) return

    this.users.delete(materialId)
    const material = this.materials.get(materialId)
    if (material) {
      // Nothing references it any more; hold it until the model unloads so an
      // undo-style re-edit in the same session can still reach its textures.
      this.orphans.add(material)
      this.materials.delete(materialId)
    }
    removed.push(materialId)
  }

  private disposeOrphans(): void {
    for (const material of this.orphans) material.dispose()
    this.orphans.clear()
  }
}

function applyPatch(material: THREE.Material, patch: MaterialPatch): void {
  const target = material as THREE.MeshStandardMaterial

  if (patch.color !== undefined && target.color) target.color.set(patch.color)
  if (patch.emissive !== undefined && target.emissive) target.emissive.set(patch.emissive)
  if (patch.emissiveIntensity !== undefined && typeof target.emissiveIntensity === 'number') {
    target.emissiveIntensity = patch.emissiveIntensity
  }
  if (patch.metalness !== undefined && typeof target.metalness === 'number') target.metalness = patch.metalness
  if (patch.roughness !== undefined && typeof target.roughness === 'number') target.roughness = patch.roughness
  if (patch.opacity !== undefined) {
    material.opacity = patch.opacity
    // Opaque materials ignore opacity entirely; flip transparency to match intent.
    if (patch.transparent === undefined) material.transparent = patch.opacity < 1
  }
  if (patch.transparent !== undefined) material.transparent = patch.transparent
}

let cloneCounter = 0
function uniqueCloneName(base: string): string {
  cloneCounter += 1
  return `${base} (copy ${cloneCounter})`
}
