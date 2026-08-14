/** Serializable description of every animation in the loaded model. */

export type AnimatedProperty =
  | 'position'
  | 'quaternion'
  | 'rotation'
  | 'scale'
  | 'morphTargetInfluences'
  | 'other'

export type Axis = 'x' | 'y' | 'z'

export interface TrackInfo {
  /** `${clipId}::${trackIndex}` — track names are not unique across clips. */
  id: string
  clipId: string
  /** Raw KeyframeTrack.name, e.g. "Door_1.quaternion". */
  trackName: string
  /** Resolved via PropertyBinding, null when the target is missing from the scene. */
  objectId: string | null
  /** Node name parsed out of the track, kept for diagnostics. */
  targetName: string
  property: AnimatedProperty
  /** Raw property string when `property` is "other". */
  rawProperty: string
  keyframeCount: number
  timeStart: number
  timeEnd: number
  /** Per-component min/max of the keyframe values. */
  valueMin: number[]
  valueMax: number[]
  /** Axis with the largest change (translation/scale) or the rotation axis. */
  dominantAxis: Axis | null
  /** Total swept rotation in degrees for quaternion/rotation tracks. */
  totalRotationDeg: number | null
  /** Distance between the extreme positions for translation tracks. */
  translationDistance: number | null
  /** Last keyframe matches the first — the track can loop seamlessly. */
  returnsToStart: boolean
  /** Full-turn spin or seamless loop: safe to run as a continuous animation. */
  cyclic: boolean
}

export interface ClipInfo {
  /** `clip-${index}` — clip names may repeat or be empty. */
  id: string
  index: number
  name: string
  duration: number
  trackCount: number
  tracks: TrackInfo[]
  /** Distinct objects driven by this clip. */
  objectIds: string[]
  /** Every animated property appearing in the clip. */
  properties: AnimatedProperty[]
  /** All resolvable tracks return to their start value. */
  loopable: boolean
  /** At least one track spins continuously. */
  cyclic: boolean
  /** Tracks whose target could not be resolved in the scene. */
  unresolvedTracks: number
}

/** What the animation system can say about a single object. */
export interface ObjectAnimationCapability {
  objectId: string
  clipIds: string[]
  trackIds: string[]
  properties: AnimatedProperty[]
  rotation: { axis: Axis | null; totalDeg: number; cyclic: boolean } | null
  translation: { axis: Axis | null; distance: number } | null
  scaling: { axis: Axis | null; amount: number } | null
  morphing: boolean
}

export interface AnimationScanResult {
  clips: ClipInfo[]
  clipOrder: string[]
  /** objectId -> capability. */
  objects: Record<string, ObjectAnimationCapability>
  tracks: Record<string, TrackInfo>
}

export const EMPTY_ANIMATION_SCAN: AnimationScanResult = {
  clips: [],
  clipOrder: [],
  objects: {},
  tracks: {},
}
