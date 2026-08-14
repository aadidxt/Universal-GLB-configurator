import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Viewport } from './Viewport'

export type TransformMode = 'translate' | 'rotate' | 'scale'
export type TransformSpace = 'world' | 'local'

export interface TransformSnapping {
  /** World units per translate step; null disables snapping. */
  translation: number | null
  /** Degrees per rotate step; null disables snapping. */
  rotationDeg: number | null
  scale: number | null
}

/**
 * Gizmo wrapper. It only ever writes position/quaternion/scale on the attached
 * node — no reparenting and no geometry baking — so skinning and animation
 * tracks that target the same node keep working.
 */
export class TransformManager {
  readonly controls: TransformControls
  private readonly viewport: Viewport
  private readonly helper: THREE.Object3D
  private attached: THREE.Object3D | null = null
  private enabled = true
  private changeListeners = new Set<(object: THREE.Object3D) => void>()
  private draggingListeners = new Set<(dragging: boolean) => void>()

  constructor(viewport: Viewport) {
    this.viewport = viewport
    this.controls = new TransformControls(viewport.camera, viewport.renderer.domElement)
    this.controls.setSpace('world')

    // r169+ exposes the visual part separately; older builds are Object3D themselves.
    const maybeHelper = this.controls as unknown as { getHelper?: () => THREE.Object3D }
    this.helper = typeof maybeHelper.getHelper === 'function'
      ? maybeHelper.getHelper()
      : (this.controls as unknown as THREE.Object3D)
    this.helper.visible = false
    viewport.scene.add(this.helper)

    this.controls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value)
      // Orbiting while dragging the gizmo would fight the pointer.
      this.viewport.controls.enabled = !dragging
      for (const listener of this.draggingListeners) listener(dragging)
    })

    this.controls.addEventListener('objectChange', () => {
      if (this.attached) {
        for (const listener of this.changeListeners) listener(this.attached)
      }
    })
  }

  attach(object: THREE.Object3D | null): void {
    this.attached = object
    if (object && this.enabled) {
      this.controls.attach(object)
      this.helper.visible = true
    } else {
      this.controls.detach()
      this.helper.visible = false
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.attach(this.attached)
  }

  setMode(mode: TransformMode): void {
    this.controls.setMode(mode)
  }

  setSpace(space: TransformSpace): void {
    this.controls.setSpace(space)
  }

  setSnapping(snapping: TransformSnapping): void {
    this.controls.setTranslationSnap(snapping.translation)
    this.controls.setRotationSnap(
      snapping.rotationDeg === null ? null : THREE.MathUtils.degToRad(snapping.rotationDeg),
    )
    this.controls.setScaleSnap(snapping.scale)
  }

  onObjectChange(listener: (object: THREE.Object3D) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  onDraggingChanged(listener: (dragging: boolean) => void): () => void {
    this.draggingListeners.add(listener)
    return () => this.draggingListeners.delete(listener)
  }

  get isDragging(): boolean {
    return (this.controls as unknown as { dragging: boolean }).dragging === true
  }

  dispose(): void {
    this.changeListeners.clear()
    this.draggingListeners.clear()
    this.controls.detach()
    this.helper.removeFromParent()
    this.controls.dispose()
  }
}
