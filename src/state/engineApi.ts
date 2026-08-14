import { createContext } from 'react'
import type { EditorEngine } from '../engine/EditorEngine'
import type { MaterialEditScope, MaterialPatch } from '../engine/MaterialService'
import type { AnimationManager } from '../engine/animation/AnimationManager'
import type { InteractionEngine } from '../engine/interaction/InteractionEngine'
import type { InteractionDefinition, PivotMode, PivotSpec, Vec3 } from '../engine/interaction/types'
import type { SemanticType } from '../engine/semantic/types'

export interface EngineApi {
  /** Called by the viewport once its DOM container exists. */
  mount: (container: HTMLElement) => () => void
  getEngine: () => EditorEngine | null
  loadFile: (file: File) => Promise<void>
  frameModel: () => void
  resetView: () => void
  setGridVisible: (visible: boolean) => void

  /** Selection. `additive` toggles the id (Ctrl/Cmd), `range` extends (Shift). */
  select: (id: string | null, modifiers?: { additive?: boolean; range?: boolean }) => void
  pickAt: (ndcX: number, ndcY: number, modifiers?: { additive?: boolean; range?: boolean }) => void
  focusObject: (id: string) => void
  focusSelected: () => void
  setObjectVisible: (id: string, visible: boolean) => void
  /** Editable display name; the glTF name stays in `rawName`. */
  renameObject: (id: string, name: string) => void

  editMaterial: (objectId: string, slot: number, patch: MaterialPatch, scope?: MaterialEditScope) => void

  /** Playback surface; null before the viewport mounts. */
  getAnimations: () => AnimationManager | null
  /** Plays a clip forward; used by "Open", "On" and generic play. */
  playClip: (clipId: string, direction?: 1 | -1) => void
  pauseClip: (clipId: string) => void
  toggleClip: (clipId: string) => void
  stopClip: (clipId: string) => void
  stopAllClips: () => void
  setClipLoop: (clipId: string, loop: boolean) => void
  setClipSpeed: (clipId: string, speed: number) => void
  setClipDirection: (clipId: string, direction: 1 | -1) => void
  seekClip: (clipId: string, time: number) => void
  seekClipNormalized: (clipId: string, value: number) => void
  /** Door/drawer helpers: forward to the end, reverse back to the start. */
  openWithClip: (clipId: string) => void
  closeWithClip: (clipId: string) => void
  /** Fires a one-shot clip and returns it to the rest pose afterwards. */
  triggerClip: (clipId: string) => void

  // --- Phase 4 ------------------------------------------------------------

  getInteractionEngine: () => InteractionEngine | null
  addInteraction: (definition: InteractionDefinition) => void
  updateInteraction: (definition: InteractionDefinition) => void
  deleteInteraction: (id: string) => void

  /** Runtime controls; these are transient and stay out of the undo history. */
  toggleInteraction: (id: string) => void
  openInteraction: (id: string) => void
  closeInteraction: (id: string) => void
  setInteractionValue: (id: string, value: number) => void
  setInteractionRunning: (id: string, running: boolean) => void
  setInteractionSpeed: (id: string, speedDegPerSec: number) => void
  setInteractionDirection: (id: string, direction: 1 | -1) => void
  resetInteraction: (id: string) => void

  /** Pivot helpers for the interaction editor. */
  getPivotOptions: (targetId: string, extraIds: string[], includeChildren: boolean) => Record<PivotMode, Vec3 | null>
  resolvePivot: (targetId: string, extraIds: string[], spec: PivotSpec, includeChildren: boolean) => Vec3 | null
  beginPivotEdit: (interactionId: string, point: Vec3, onMove: (point: Vec3) => void) => void
  endPivotEdit: () => void

  /** Phase 3 suggestions: accept creates a real interaction, ignore hides it. */
  acceptSuggestion: (objectId: string, semantic: SemanticType) => void
  ignoreSuggestion: (objectId: string) => void
  clearSuggestionOverride: (objectId: string) => void

  /**
   * Replaces a baked clip with an editable manual rotation/translation seeded
   * from what the scanner measured — the fix for doors that open the wrong way.
   */
  overrideAnimation: (objectId: string) => void
  /** Reverses an existing interaction (inward door becomes outward). */
  flipInteraction: (id: string) => void
  /** Sets the open angle, keeping the current direction sign. */
  setInteractionAngle: (id: string, degrees: number) => void

  /** Persistence: configuration lives in IndexedDB, keyed by the GLB hash. */
  saveProject: () => Promise<void>
  loadSavedProject: () => Promise<void>
  deleteSavedProject: () => Promise<void>
  exportProject: () => void
  /** Bakes the configured motion into animation clips and downloads a new GLB. */
  exportBakedGlb: () => Promise<void>
  importProject: (file: File) => Promise<void>

  undo: () => void
  redo: () => void
}

export const EngineContext = createContext<EngineApi | null>(null)
