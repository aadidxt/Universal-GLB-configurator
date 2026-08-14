import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Viewport, type ViewportOptions } from './Viewport'
import { ModelManager, type ModelStats } from './ModelManager'
import { computeBounds, frameObject, type ModelBounds } from './framing'
import { SelectionManager } from './SelectionManager'
import { TransformManager } from './TransformManager'
import { MaterialService } from './MaterialService'
import { scanModel } from './scanner/ModelScanner'
import type { ModelManifest, NodeEntry } from './scanner/types'
import { AnimationManager } from './animation/AnimationManager'
import { scanAnimations } from './animation/AnimationScanner'
import { buildCapabilityManifest, EMPTY_CAPABILITY_MANIFEST } from './capability/CapabilityManifest'
import type { CapabilityManifest } from './capability/types'
import { InteractionEngine } from './interaction/InteractionEngine'
import { pivotPreview, resolvePivotPoint } from './interaction/PivotService'
import type { InteractionDefinition, PivotMode, PivotSpec, Vec3 as IVec3 } from './interaction/types'
import { CommandHistory } from './commands/CommandHistory'
import { buildBakedClips } from '../glb/bakeAnimations'
import { exportSceneToGLB } from '../glb/GLBExporter'
import { toMaterialArray } from './scanner/ModelScanner'
import type { MaterialOverride, ObjectOverride } from '../project/schema'

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(4, 3, 5)
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0)

/**
 * Facade the React layer talks to. Everything below it is plain Three.js, so
 * later managers (selection, transform gizmos, animation, scanning) can be
 * attached here without the viewport component changing.
 */
export class EditorEngine {
  readonly viewport: Viewport
  readonly models: ModelManager
  readonly selection: SelectionManager
  readonly transforms: TransformManager
  readonly materials: MaterialService
  readonly animations: AnimationManager
  readonly interactions: InteractionEngine
  readonly history = new CommandHistory()

  private disposeFrameCallback: () => void
  private manifest: ModelManifest | null = null
  /** Untouched state right after import; every override is a diff against it. */
  private baseline: {
    nodes: Map<string, { name: string; visible: boolean; position: number[]; quaternion: number[]; scale: number[] }>
    materials: Map<string, MaterialOverride>
    slots: Map<string, string[]>
    materialOrder: string[]
    materialNames: Map<string, string>
  } = { nodes: new Map(), materials: new Map(), slots: new Map(), materialOrder: [], materialNames: new Map() }
  private pivotHelper: THREE.Object3D | null = null
  private pivotMoveCallback: ((point: IVec3) => void) | null = null
  private transformsAttachedBefore: THREE.Object3D | null = null
  private capabilities: CapabilityManifest = EMPTY_CAPABILITY_MANIFEST

  constructor(container: HTMLElement, options?: ViewportOptions) {
    this.viewport = new Viewport(container, options)
    this.models = new ModelManager(this.viewport.scene)
    this.selection = new SelectionManager(this.viewport)
    this.transforms = new TransformManager(this.viewport)
    this.materials = new MaterialService()
    this.animations = new AnimationManager()

    this.interactions = new InteractionEngine()
    this.interactions.setResolver((id) => this.selection.getObject(id))
    this.interactions.setAnimationBridge({
      play: (clipId, direction) => this.animations.play(clipId, direction),
      pause: (clipId) => this.animations.pause(clipId),
      stop: (clipId) => this.animations.stop(clipId),
      setLoop: (clipId, loop) => this.animations.setLoop(clipId, loop),
      setSpeed: (clipId, speed) => this.animations.setSpeed(clipId, speed),
      isPlaying: (clipId) => this.animations.getState(clipId)?.playing ?? false,
    })

    this.disposeFrameCallback = this.viewport.addFrameCallback((delta) => {
      this.animations.update(delta)
      this.interactions.tick(delta)
      // Selection highlights track objects that animation is moving.
      if (this.selection.ids.length > 0) this.selection.refreshHighlight()
    })
  }

  /**
   * Swaps in a new model: disposes the old one, rebuilds the manifest, resets
   * selection/material registries and frames the camera.
   */
  setModel(gltf: GLTF): {
    stats: ModelStats
    bounds: ModelBounds | null
    manifest: ModelManifest
    capabilities: CapabilityManifest
  } {
    this.transforms.attach(null)
    this.exitPivotEdit()
    this.interactions.clear()
    this.history.clear()
    this.animations.dispose()
    const stats = this.models.setModel(gltf)

    const scan = scanModel(gltf.scene, { animations: this.models.animationClips })
    this.manifest = scan.manifest
    this.selection.setIndex(scan.objects, gltf.scene)
    this.materials.setIndex(scan.objects, scan.materials)

    const animationScan = scanAnimations(gltf.scene, this.models.animationClips)
    this.capabilities = buildCapabilityManifest(scan.manifest, animationScan)
    this.animations.setModel(gltf.scene, this.models.animationClips, animationScan.clips)

    this.captureBaseline(scan.manifest, scan.objects)

    const bounds = this.frameModel()
    this.fitGridToModel(bounds)
    return { stats, bounds, manifest: scan.manifest, capabilities: this.capabilities }
  }

  clearModel(): void {
    this.transforms.attach(null)
    this.exitPivotEdit()
    this.interactions.clear()
    this.history.clear()
    this.animations.dispose()
    this.capabilities = EMPTY_CAPABILITY_MANIFEST
    this.selection.setIndex(new Map(), null)
    this.materials.clear()
    this.manifest = null
    this.models.clear()
    this.resetView()
  }

  getManifest(): ModelManifest | null {
    return this.manifest
  }

  getCapabilities(): CapabilityManifest {
    return this.capabilities
  }

  /** Selection entry point used by both the viewport and the Outliner. */
  setSelection(ids: string[]): void {
    this.selection.select(ids)
    this.transforms.attach(this.selection.primary)
  }

  toggleSelection(id: string): void {
    this.selection.toggle(id)
    this.transforms.attach(this.selection.primary)
  }

  /** Picks at normalized device coordinates; returns the selected id or null. */
  pickAt(ndcX: number, ndcY: number): string | null {
    return this.selection.pick(ndcX, ndcY)
  }

  setObjectVisible(id: string, visible: boolean): NodeEntry[] {
    const object = this.selection.getObject(id)
    if (!object || !this.manifest) return []

    object.visible = visible
    this.selection.refreshHighlight()
    return this.refreshVisibility()
  }

  /** Frames one node; falls back to the whole model for geometry-less nodes. */
  focusObject(id: string): ModelBounds | null {
    const object = this.selection.getObject(id)
    if (!object) return null

    const bounds = frameObject(this.viewport.camera, this.viewport.controls, object)
    return bounds ?? this.frameModel()
  }

  /** Fresh transform values for a node after a gizmo drag. */
  readTransform(id: string): Pick<NodeEntry, 'position' | 'rotation' | 'quaternion' | 'scale' | 'worldBounds'> | null {
    const object = this.selection.getObject(id)
    if (!object) return null

    object.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(object, true)
    const hasBox = !box.isEmpty() && isFinite(box.min.x) && isFinite(box.max.x)

    return {
      position: object.position.toArray() as [number, number, number],
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      quaternion: object.quaternion.toArray() as [number, number, number, number],
      scale: object.scale.toArray() as [number, number, number],
      worldBounds: hasBox
        ? {
            min: box.min.toArray() as [number, number, number],
            max: box.max.toArray() as [number, number, number],
            center: box.getCenter(new THREE.Vector3()).toArray() as [number, number, number],
            size: box.getSize(new THREE.Vector3()).toArray() as [number, number, number],
          }
        : null,
    }
  }

  /** Recomputes effectiveVisible for every node after a visibility toggle. */
  private refreshVisibility(): NodeEntry[] {
    if (!this.manifest) return []

    const updated: NodeEntry[] = []
    for (const id of this.manifest.order) {
      const entry = this.manifest.nodes[id]
      const object = this.selection.getObject(id)
      if (!entry || !object) continue

      const parentEntry = entry.parentId ? this.manifest.nodes[entry.parentId] : null
      const effectiveVisible = (parentEntry ? parentEntry.effectiveVisible : true) && object.visible

      if (entry.visible !== object.visible || entry.effectiveVisible !== effectiveVisible) {
        entry.visible = object.visible
        entry.effectiveVisible = effectiveVisible
        updated.push({ ...entry })
      } else {
        entry.effectiveVisible = effectiveVisible
      }
    }
    return updated
  }

  frameModel(): ModelBounds | null {
    const object = this.models.object
    if (!object) return null
    return frameObject(this.viewport.camera, this.viewport.controls, object)
  }

  /** Default camera when there is no model, framed default view when there is. */
  resetView(): void {
    const object = this.models.object
    if (object) {
      frameObject(this.viewport.camera, this.viewport.controls, object)
      return
    }

    const { camera, controls } = this.viewport
    camera.position.copy(DEFAULT_CAMERA_POSITION)
    camera.near = 0.1
    camera.far = 1000
    camera.updateProjectionMatrix()
    controls.target.copy(DEFAULT_TARGET)
    controls.minDistance = 0.01
    controls.maxDistance = 500
    controls.update()
  }

  getBounds(): ModelBounds | null {
    const object = this.models.object
    return object ? computeBounds(object) : null
  }

  setControlsEnabled(enabled: boolean): void {
    this.viewport.controls.enabled = enabled
  }

  setGridVisible(visible: boolean): void {
    this.viewport.setGridVisible(visible)
  }

  // --- Phase 4: interactions, pivots, rename ------------------------------

  /** Renames an object; the original glTF name stays available as rawName. */
  setObjectName(id: string, name: string): NodeEntry | null {
    const object = this.selection.getObject(id)
    const entry = this.manifest?.nodes[id]
    if (!object || !entry) return null

    object.name = name
    entry.name = name || `<${object.type}>`
    const capability = this.capabilities.entries[id]
    if (capability) capability.name = entry.name
    return { ...entry }
  }

  /** Pivot point for every mode, so the UI can preview and label them. */
  getPivotOptions(targetId: string, extraIds: string[] = [], includeChildren = true): Record<PivotMode, IVec3 | null> {
    const targets = this.objectsFor(targetId, extraIds)
    if (targets.length === 0) {
      return { original: null, center: null, left: null, right: null, top: null, bottom: null, custom: null }
    }
    return pivotPreview(targets, includeChildren)
  }

  resolvePivot(targetId: string, extraIds: string[], spec: PivotSpec, includeChildren = true): IVec3 | null {
    const targets = this.objectsFor(targetId, extraIds)
    if (targets.length === 0) return null
    return resolvePivotPoint(targets, spec, includeChildren).toArray() as IVec3
  }

  /**
   * Visual pivot editing: a marker is dropped at the current pivot and the
   * transform gizmo drives it. The model itself never moves while editing.
   */
  enterPivotEdit(point: IVec3, onMove?: (point: IVec3) => void): void {
    this.exitPivotEdit()

    const helper = new THREE.Group()
    helper.name = '__pivotHelper'
    helper.position.fromArray(point)

    const bounds = this.getBounds()
    const scale = bounds ? Math.max(bounds.radius * 0.02, 1e-4) : 0.05

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa03c, depthTest: false, transparent: true, opacity: 0.9 }),
    )
    sphere.scale.setScalar(scale)
    sphere.renderOrder = 999
    sphere.raycast = () => {}
    helper.add(sphere)

    const axes = new THREE.AxesHelper(scale * 6)
    const axesMaterial = axes.material as THREE.Material
    axesMaterial.depthTest = false
    axes.renderOrder = 999
    helper.add(axes)

    this.viewport.helpers.add(helper)
    this.pivotHelper = helper
    this.pivotMoveCallback = onMove ?? null

    this.transformsAttachedBefore = this.selection.primary
    this.transforms.attach(helper)
  }

  updatePivotHelper(point: IVec3): void {
    this.pivotHelper?.position.fromArray(point)
  }

  getPivotHelperPoint(): IVec3 | null {
    return this.pivotHelper ? (this.pivotHelper.position.toArray() as IVec3) : null
  }

  get isEditingPivot(): boolean {
    return this.pivotHelper !== null
  }

  exitPivotEdit(): void {
    if (!this.pivotHelper) return

    this.transforms.attach(this.transformsAttachedBefore ?? null)
    this.pivotHelper.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
      else material?.dispose()
    })
    this.pivotHelper.removeFromParent()
    this.pivotHelper = null
    this.pivotMoveCallback = null
    this.transformsAttachedBefore = null
  }

  /** Called by the transform bridge whenever the gizmo moves the pivot helper. */
  notifyPivotHelperMoved(): void {
    const point = this.getPivotHelperPoint()
    if (point && this.pivotMoveCallback) this.pivotMoveCallback(point)
  }

  isPivotHelper(object: THREE.Object3D | null): boolean {
    return !!object && object === this.pivotHelper
  }

  // --- project overrides: diff against the freshly imported model ----------

  private captureBaseline(manifest: ModelManifest, objects: Map<string, THREE.Object3D>): void {
    const nodes = new Map<string, { name: string; visible: boolean; position: number[]; quaternion: number[]; scale: number[] }>()
    const slots = new Map<string, string[]>()

    for (const [id, object] of objects) {
      nodes.set(id, {
        name: manifest.nodes[id]?.name ?? object.name,
        visible: object.visible,
        position: object.position.toArray(),
        quaternion: object.quaternion.toArray(),
        scale: object.scale.toArray(),
      })

      const materials = toMaterialArray((object as THREE.Mesh).material)
      if (materials.length > 0) slots.set(id, materials.map((material) => material.uuid))
    }

    const materials = new Map<string, MaterialOverride>()
    const materialNames = new Map<string, string>()
    for (const id of manifest.materialOrder) {
      const entry = manifest.materials[id]
      if (!entry) continue
      materials.set(id, materialValues(entry))
      materialNames.set(id, entry.name)
    }

    this.baseline = { nodes, materials, slots, materialOrder: [...manifest.materialOrder], materialNames }
  }

  /** Everything the user changed since import, ready for the project file. */
  collectOverrides(): { objects: Record<string, ObjectOverride>; materials: Record<string, MaterialOverride> } {
    const objects: Record<string, ObjectOverride> = {}
    const materials: Record<string, MaterialOverride> = {}
    if (!this.manifest) return { objects, materials }

    for (const [id, base] of this.baseline.nodes) {
      const object = this.selection.getObject(id)
      const entry = this.manifest.nodes[id]
      if (!object || !entry) continue

      const override: ObjectOverride = {}
      if (entry.name !== base.name) override.name = entry.name
      if (object.visible !== base.visible) override.visible = object.visible
      if (!sameNumbers(object.position.toArray(), base.position)) override.position = object.position.toArray() as [number, number, number]
      if (!sameNumbers(object.quaternion.toArray(), base.quaternion)) {
        override.quaternion = object.quaternion.toArray() as [number, number, number, number]
      }
      if (!sameNumbers(object.scale.toArray(), base.scale)) override.scale = object.scale.toArray() as [number, number, number]

      // Materials that were cloned for this object only.
      const currentSlots = toMaterialArray((object as THREE.Mesh).material)
      const baseSlots = this.baseline.slots.get(id) ?? []
      const slotOverrides: NonNullable<ObjectOverride['materialSlots']> = []

      currentSlots.forEach((material, slot) => {
        const from = baseSlots[slot]
        if (!from || from === material.uuid) return
        const described = this.materials.describe(material.uuid)
        slotOverrides.push({ slot, from, override: materialValues(described) })
      })

      if (slotOverrides.length > 0) override.materialSlots = slotOverrides
      if (Object.keys(override).length > 0) objects[id] = override
    }

    // Shared materials that still exist but were edited in place. Read the live
    // material, not the manifest copy: the manifest snapshot the engine holds is
    // not the one the UI mutates.
    for (const [id, base] of this.baseline.materials) {
      if (!this.materials.getMaterial(id)) continue
      const current = materialValues(this.materials.describe(id))
      if (!sameMaterial(current, base)) materials[id] = current
    }

    return { objects, materials }
  }

  /** Applies stored object overrides after a reload of the same model. */
  applyObjectOverrides(overrides: Record<string, ObjectOverride>): NodeEntry[] {
    const updated: NodeEntry[] = []
    if (!this.manifest) return updated

    for (const [id, override] of Object.entries(overrides)) {
      const object = this.selection.getObject(id)
      const entry = this.manifest.nodes[id]
      if (!object || !entry) continue

      if (override.name !== undefined) this.setObjectName(id, override.name)
      if (override.visible !== undefined) object.visible = override.visible
      if (override.position) object.position.fromArray(override.position)
      if (override.quaternion) object.quaternion.fromArray(override.quaternion)
      if (override.scale) object.scale.fromArray(override.scale)
      object.updateMatrixWorld(true)

      const transform = this.readTransform(id)
      updated.push({ ...this.manifest.nodes[id], ...(transform ?? {}) })
    }

    this.refreshVisibility()
    this.selection.refreshHighlight()
    return updated.map((entry) => ({ ...this.manifest!.nodes[entry.id], ...entry }))
  }

  /** Camera state for the project file. */
  getCameraState() {
    const { camera, controls } = this.viewport
    return {
      position: camera.position.toArray() as [number, number, number],
      target: controls.target.toArray() as [number, number, number],
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    }
  }

  setCameraState(state: { position: number[]; target: number[]; fov: number; near: number; far: number }): void {
    const { camera, controls } = this.viewport
    camera.position.fromArray(state.position)
    camera.fov = state.fov
    camera.near = state.near
    camera.far = state.far
    camera.updateProjectionMatrix()
    controls.target.fromArray(state.target)
    controls.update()
  }

  /**
   * Translation tables between runtime uuids and reload-stable keys.
   * Saved projects only ever contain the stable side.
   */
  getIdMaps(): {
    objectToStable: Record<string, string>
    stableToObject: Record<string, string>
    materialToStable: Record<string, string>
    stableToMaterial: Record<string, string>
  } {
    const objectToStable: Record<string, string> = {}
    const stableToObject: Record<string, string> = {}
    const materialToStable: Record<string, string> = {}
    const stableToMaterial: Record<string, string> = {}

    if (this.manifest) {
      for (const id of this.manifest.order) {
        const entry = this.manifest.nodes[id]
        if (!entry) continue
        objectToStable[id] = entry.stableId
        stableToObject[entry.stableId] = id
      }

      // Materials have no path, so index-in-scan-order plus name is the key.
      this.baseline.materialOrder.forEach((materialId, index) => {
        const name = this.baseline.materialNames.get(materialId) ?? ''
        const stable = `${index}:${name}`
        materialToStable[materialId] = stable
        stableToMaterial[stable] = materialId
      })
    }

    return { objectToStable, stableToObject, materialToStable, stableToMaterial }
  }

  /** Animation capability discovered for one object, if any. */
  getAnimationCapability(objectId: string) {
    return this.capabilities.animation.objects[objectId] ?? null
  }

  /**
   * Bakes the configured interactions into real animation clips and writes a
   * new GLB. Clips that a manual interaction replaced are dropped, so the
   * exported file never contains both the old and the new motion.
   */
  async exportBakedGLB(): Promise<{ blob: Blob; byteLength: number; clipNames: string[]; warnings: string[] } | null> {
    const root = this.models.object
    if (!root) return null

    // Export the rest pose, not whatever happens to be open right now.
    this.interactions.resetAll()
    this.exitPivotEdit()
    this.transforms.attach(null)

    const definitions = this.interactions.getDefinitions()
    const { clips, warnings } = buildBakedClips(definitions, (id) => this.interactions.getDriver(id))

    const replaced = new Set(definitions.flatMap((definition) => definition.overrideClipIds ?? []))
    const originals = this.capabilities.animation.clips
      .filter((clip) => !replaced.has(clip.id))
      .map((clip) => this.models.animationClips[clip.index])
      .filter((clip): clip is THREE.AnimationClip => !!clip)

    if (replaced.size > 0) {
      warnings.push(`${replaced.size} original clip(s) replaced by manual interactions`)
    }

    const animations = [...originals, ...clips]
    const result = await exportSceneToGLB(root, animations)

    this.transforms.attach(this.selection.primary)
    return {
      ...result,
      clipNames: animations.map((clip) => clip.name),
      warnings,
    }
  }

  /** Interaction definitions currently registered, ready to serialize. */
  getInteractions(): InteractionDefinition[] {
    return this.interactions.getDefinitions()
  }

  private objectsFor(targetId: string, extraIds: string[]): THREE.Object3D[] {
    return [targetId, ...extraIds]
      .map((id) => this.selection.getObject(id))
      .filter((object): object is THREE.Object3D => !!object)
  }

  /** Introspection used by dev tooling and smoke tests; no production behaviour depends on it. */
  debugSnapshot() {
    const { camera, controls, renderer } = this.viewport
    const bounds = this.getBounds()

    let fitsModel: boolean | null = null
    if (bounds) {
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      )
      const corners: THREE.Vector3[] = []
      for (const x of [bounds.box.min.x, bounds.box.max.x]) {
        for (const y of [bounds.box.min.y, bounds.box.max.y]) {
          for (const z of [bounds.box.min.z, bounds.box.max.z]) {
            corners.push(new THREE.Vector3(x, y, z))
          }
        }
      }
      fitsModel = corners.every((corner) => frustum.containsPoint(corner))
    }

    return {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      distance: camera.position.distanceTo(controls.target),
      near: camera.near,
      far: camera.far,
      modelRootChildren: this.models.root.children.length,
      fitsModel,
      selection: this.selection.ids,
      nodeCount: this.manifest?.order.length ?? 0,
      materialCount: this.manifest?.materialOrder.length ?? 0,
      clipCount: this.capabilities.animation.clips.length,
      animationStates: this.animations.getStates(),
      interactions: this.interactions.getDefinitions().map((definition) => ({
        id: definition.id,
        name: definition.name,
        preset: definition.preset,
        targetId: definition.targetId,
        pivot: definition.pivot,
        state: this.interactions.getState(definition.id),
      })),
      history: this.history.snapshot(),
      editingPivot: this.isEditingPivot,
      render: { ...renderer.info.render },
      memory: { ...renderer.info.memory },
    }
  }

  /** name -> hex color of the first material slot; duplicate names get _1, _2 … */
  debugMaterialColors(): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    const object = this.models.object
    if (!object) return out

    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
      let key = child.name || child.uuid
      let index = 0
      while (key in out) key = `${child.name}_${++index}`
      out[key] = material?.color ? material.color.getHexString() : null
    })
    return out
  }

  /** Capability snapshot keyed by object name, for dev tooling and tests. */
  debugCapabilities() {
    const byName: Record<string, unknown> = {}
    for (const id of this.capabilities.order) {
      const entry = this.capabilities.entries[id]
      byName[entry.name] = {
        semantic: entry.semantic,
        confidence: entry.confidence,
        operable: entry.operable,
        animated: entry.animated,
        category: entry.category,
        inConfigurator: entry.inConfigurator,
        interactions: entry.interactions.map((item) => item.kind),
        properties: entry.animatedProperties,
        reasons: entry.reasons,
      }
    }

    const nameOf = (id: string) => this.capabilities.entries[id]?.name ?? id
    return {
      byName,
      clips: this.capabilities.animation.clips.map((clip) => ({
        id: clip.id,
        name: clip.name,
        duration: clip.duration,
        cyclic: clip.cyclic,
        targets: clip.objectIds.map(nameOf),
      })),
      clipTargets: Object.fromEntries(
        Object.entries(this.capabilities.clipTargets).map(([clipId, ids]) => [clipId, ids.map(nameOf)]),
      ),
      categories: Object.fromEntries(
        Object.entries(this.capabilities.categories).map(([category, ids]) => [category, ids.map(nameOf)]),
      ),
    }
  }

  debugNode(name: string) {
    const object = this.models.object?.getObjectByName(name)
    if (!object) return null
    object.updateWorldMatrix(true, false)
    return {
      id: object.uuid,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
      visible: object.visible,
      worldPosition: object.getWorldPosition(new THREE.Vector3()).toArray(),
      worldQuaternion: object.getWorldQuaternion(new THREE.Quaternion()).toArray(),
      parentName: object.parent?.name ?? null,
    }
  }

  /** Gizmo state plus the screen position of its origin, for click-drag tests. */
  debugGizmo() {
    const attached = this.selection.primary
    const controls = this.transforms.controls as unknown as {
      object?: THREE.Object3D
      mode: string
      space: string
      enabled: boolean
    }

    let screen: { x: number; y: number } | null = null
    if (attached) {
      const world = attached.getWorldPosition(new THREE.Vector3()).project(this.viewport.camera)
      const size = this.viewport.renderer.getSize(new THREE.Vector2())
      screen = { x: ((world.x + 1) / 2) * size.x, y: ((-world.y + 1) / 2) * size.y }
    }

    return {
      attached: !!controls.object,
      visible: !!attached,
      mode: controls.mode,
      space: controls.space,
      screen,
    }
  }

  dispose(): void {
    this.disposeFrameCallback()
    this.exitPivotEdit()
    this.interactions.dispose()
    this.history.clear()
    this.animations.dispose()
    this.transforms.dispose()
    this.selection.dispose()
    this.materials.clear()
    this.models.dispose()
    this.viewport.dispose()
  }

  /** Keeps the ground grid readable for both centimetre-scale and building-scale models. */
  private fitGridToModel(bounds: ModelBounds | null): void {
    if (!bounds) return
    const extent = Math.max(bounds.size.x, bounds.size.z, bounds.radius)
    const scale = Math.max(extent / 10, 1e-3)
    this.viewport.helpers.children
      .filter((child): child is THREE.GridHelper => child instanceof THREE.GridHelper)
      .forEach((grid) => {
        grid.scale.setScalar(scale)
        grid.position.set(bounds.center.x, bounds.box.min.y, bounds.center.z)
      })
  }
}

function materialValues(entry: { color: string | null; opacity: number; transparent: boolean; metalness: number | null; roughness: number | null; emissive: string | null; emissiveIntensity: number | null }): MaterialOverride {
  const values: MaterialOverride = { opacity: entry.opacity, transparent: entry.transparent }
  if (entry.color) values.color = entry.color
  if (entry.metalness !== null) values.metalness = entry.metalness
  if (entry.roughness !== null) values.roughness = entry.roughness
  if (entry.emissive) values.emissive = entry.emissive
  if (entry.emissiveIntensity !== null) values.emissiveIntensity = entry.emissiveIntensity
  return values
}

function sameMaterial(a: MaterialOverride, b: MaterialOverride): boolean {
  const keys: Array<keyof MaterialOverride> = ['color', 'opacity', 'transparent', 'metalness', 'roughness', 'emissive', 'emissiveIntensity']
  return keys.every((key) => {
    const left = a[key]
    const right = b[key]
    if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-6
    return left === right
  })
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-9)
}
