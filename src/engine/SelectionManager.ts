import * as THREE from 'three'
import type { Viewport } from './Viewport'

export interface SelectionChange {
  ids: string[]
  primaryId: string | null
}

/**
 * Owns "what is selected" for the engine: id <-> Object3D resolution, pointer
 * raycasting and the visual highlight. Materials are never touched — the
 * highlight is an OutlinePass selection plus a Box3 helper for nodes that have
 * no geometry of their own (empties, bones, lights, cameras).
 */
export class SelectionManager {
  private readonly viewport: Viewport
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private index = new Map<string, THREE.Object3D>()
  private selectedIds: string[] = []
  private root: THREE.Object3D | null = null
  private readonly boxHelper: THREE.Box3Helper
  private readonly helperBox = new THREE.Box3()
  private listeners = new Set<(change: SelectionChange) => void>()

  constructor(viewport: Viewport) {
    this.viewport = viewport
    this.boxHelper = new THREE.Box3Helper(this.helperBox, new THREE.Color('#ffa03c'))
    this.boxHelper.visible = false
    // Helpers must not be raycast or outlined.
    this.boxHelper.raycast = () => {}
    ;(this.boxHelper.material as THREE.Material).depthTest = false
    this.viewport.helpers.add(this.boxHelper)
  }

  /** Called after each model load; also drops any stale selection. */
  setIndex(index: Map<string, THREE.Object3D>, root: THREE.Object3D | null): void {
    this.index = index
    this.root = root
    this.applySelection([])
  }

  onChange(listener: (change: SelectionChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get ids(): string[] {
    return this.selectedIds
  }

  get primary(): THREE.Object3D | null {
    const id = this.selectedIds[this.selectedIds.length - 1]
    return id ? (this.index.get(id) ?? null) : null
  }

  getObject(id: string): THREE.Object3D | null {
    return this.index.get(id) ?? null
  }

  getObjects(ids: string[] = this.selectedIds): THREE.Object3D[] {
    return ids.map((id) => this.index.get(id)).filter((object): object is THREE.Object3D => !!object)
  }

  select(ids: string[]): void {
    this.applySelection(ids.filter((id) => this.index.has(id)))
  }

  /** Ctrl/Cmd-click semantics: toggle one id in/out of the current selection. */
  toggle(id: string): void {
    if (!this.index.has(id)) return
    const next = this.selectedIds.includes(id)
      ? this.selectedIds.filter((value) => value !== id)
      : [...this.selectedIds, id]
    this.applySelection(next)
  }

  clear(): void {
    this.applySelection([])
  }

  /**
   * Picks the closest visible renderable object under normalized device coords.
   * Returns its manifest id, or null when the ray misses the model.
   */
  pick(ndcX: number, ndcY: number): string | null {
    if (!this.root) return null

    this.pointer.set(ndcX, ndcY)
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera)

    const hits = this.raycaster.intersectObject(this.root, true)
    for (const hit of hits) {
      const object = hit.object
      if (!object.visible || !isVisibleInHierarchy(object)) continue
      const id = this.idOf(object)
      if (id) return id
    }
    return null
  }

  /** Refreshes the box helper after transforms or visibility changes. */
  refreshHighlight(): void {
    this.updateHighlight()
  }

  dispose(): void {
    this.listeners.clear()
    this.viewport.setOutlinedObjects([])
    this.boxHelper.removeFromParent()
    this.boxHelper.dispose()
    this.index = new Map()
    this.root = null
  }

  private idOf(object: THREE.Object3D): string | null {
    return this.index.has(object.uuid) ? object.uuid : null
  }

  private applySelection(ids: string[]): void {
    this.selectedIds = ids
    this.updateHighlight()
    const change: SelectionChange = { ids, primaryId: ids[ids.length - 1] ?? null }
    for (const listener of this.listeners) listener(change)
  }

  private updateHighlight(): void {
    const objects = this.getObjects()
    this.viewport.setOutlinedObjects(objects.filter((object) => hasRenderableDescendant(object)))

    const primary = this.primary
    if (!primary || hasRenderableDescendant(primary)) {
      this.boxHelper.visible = false
      return
    }

    // Geometry-less node (empty/bone/light): show a small world-space box instead.
    const position = primary.getWorldPosition(new THREE.Vector3())
    const extent = this.emptyHelperSize()
    this.helperBox.setFromCenterAndSize(position, new THREE.Vector3(extent, extent, extent))
    this.boxHelper.box = this.helperBox
    this.boxHelper.visible = true
  }

  private emptyHelperSize(): number {
    if (!this.root) return 0.2
    const box = new THREE.Box3().setFromObject(this.root)
    if (box.isEmpty()) return 0.2
    return Math.max(box.getSize(new THREE.Vector3()).length() * 0.02, 1e-4)
  }
}

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function hasRenderableDescendant(object: THREE.Object3D): boolean {
  let found = false
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!found && (mesh.isMesh === true || (child as THREE.Points).isPoints === true)) found = true
  })
  return found
}
