import type { SemanticType } from '../semantic/types'

/**
 * Interaction definitions are plain JSON: no functions, no class instances, no
 * Object3D references. The InteractionEngine turns them into behaviour at
 * runtime, and Phase 5 can persist them untouched.
 */

export type Axis = 'x' | 'y' | 'z'
export type Vec3 = [number, number, number]
export type Easing = 'linear' | 'easeInOut' | 'easeOut' | 'easeIn'
export type LoopMode = 'none' | 'loop' | 'pingpong'

/** Where the rotation/translation origin sits, derived from world bounds. */
export type PivotMode = 'original' | 'center' | 'left' | 'right' | 'top' | 'bottom' | 'custom'

export interface PivotSpec {
  mode: PivotMode
  /** World-space point; only meaningful for mode "custom". */
  point?: Vec3
}

export type InteractionKind =
  | 'playAnimation'
  | 'rotateBetween'
  | 'translateBetween'
  | 'continuousSpin'
  | 'toggleVisibility'
  | 'transform'

export type InteractionPreset =
  | 'door'
  | 'fan'
  | 'drawer'
  | 'button'
  | 'lever'
  | 'genericRotation'
  | 'genericTranslation'
  | 'existingAnimation'
  | 'visibility'

export interface RotateBetweenConfig {
  axis: Axis
  closedDeg: number
  openDeg: number
  durationMs: number
  easing: Easing
  loop: LoopMode
}

export interface TranslateBetweenConfig {
  axis: Axis
  /** Offsets along the axis relative to the rest pose, in model units. */
  closed: number
  open: number
  durationMs: number
  easing: Easing
  loop: LoopMode
}

export interface ContinuousSpinConfig {
  axis: Axis
  /** Current speed in degrees per second. */
  speedDegPerSec: number
  maxSpeedDegPerSec: number
  direction: 1 | -1
  /** Initial state; toggling flips it at runtime. */
  running: boolean
}

export interface PlayAnimationConfig {
  clipIds: string[]
  mode: 'toggle' | 'openClose' | 'once'
  loop: boolean
  speed: number
}

export interface ToggleVisibilityConfig {
  hiddenByDefault: boolean
}

/** Generic action: interpolate the whole TRS between two saved states. */
export interface TransformConfig {
  from: { position?: Vec3; rotationDeg?: Vec3; scale?: Vec3 }
  to: { position?: Vec3; rotationDeg?: Vec3; scale?: Vec3 }
  durationMs: number
  easing: Easing
  loop: LoopMode
}

export type InteractionConfig =
  | ({ kind: 'rotateBetween' } & RotateBetweenConfig)
  | ({ kind: 'translateBetween' } & TranslateBetweenConfig)
  | ({ kind: 'continuousSpin' } & ContinuousSpinConfig)
  | ({ kind: 'playAnimation' } & PlayAnimationConfig)
  | ({ kind: 'toggleVisibility' } & ToggleVisibilityConfig)
  | ({ kind: 'transform' } & TransformConfig)

export interface InteractionDefinition {
  id: string
  name: string
  preset: InteractionPreset
  /** Drives the Configurator category and icons. */
  semantic: SemanticType
  /** Primary object id; also the anchor for bounds-derived pivots. */
  targetId: string
  /** Extra objects that move as one logical part (door glass, frame, handle). */
  extraTargetIds: string[]
  /** Whole subtree moves, which is the default for a mesh with children. */
  includeChildren: boolean
  pivot: PivotSpec
  labels: { on: string; off: string }
  config: InteractionConfig
  /** Set when the definition came from accepting a Phase 3 suggestion. */
  createdFrom?: 'manual' | 'suggestion' | 'detection' | 'override'
  /**
   * Baked clips this interaction replaces. They are stopped and held at their
   * rest frame while the interaction exists, so a GLB whose door swings the
   * wrong way can be re-driven manually without the clip fighting back.
   */
  overrideClipIds?: string[]
}

/** Live runtime state, mirrored into React by a rAF hook. */
export interface InteractionRuntimeState {
  id: string
  /** 0 = closed/off/rest, 1 = open/on. */
  value: number
  target: number
  /** Animating towards the target right now. */
  moving: boolean
  /** continuousSpin only. */
  running: boolean
  speedDegPerSec: number
  direction: 1 | -1
  visible: boolean
}

export const DEFAULT_PIVOT: PivotSpec = { mode: 'original' }

export function isMotionKind(kind: InteractionKind): boolean {
  return kind === 'rotateBetween' || kind === 'translateBetween' || kind === 'transform'
}
