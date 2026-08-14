import * as THREE from 'three'
import type {
  AnimatedProperty,
  AnimationScanResult,
  Axis,
  ClipInfo,
  ObjectAnimationCapability,
  TrackInfo,
} from './types'

const AXES: Axis[] = ['x', 'y', 'z']
/** Below this a rotation is noise rather than motion. */
const ROTATION_EPSILON_DEG = 0.5
const RETURN_EPSILON = 1e-4
/** A track sweeping at least this much is treated as a continuous spin. */
const SPIN_THRESHOLD_DEG = 300

/**
 * Reads every clip and track of a loaded model and resolves each track to the
 * real Object3D via PropertyBinding — never by assuming names are unique.
 */
export function scanAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): AnimationScanResult {
  const clipInfos: ClipInfo[] = []
  const tracks: Record<string, TrackInfo> = {}
  const objects: Record<string, ObjectAnimationCapability> = {}

  clips.forEach((clip, index) => {
    const clipId = `clip-${index}`
    const clipTracks: TrackInfo[] = []
    let unresolved = 0

    clip.tracks.forEach((track, trackIndex) => {
      const info = describeTrack(root, clip, clipId, track, trackIndex)
      clipTracks.push(info)
      tracks[info.id] = info
      if (!info.objectId) unresolved += 1
    })

    const objectIds = unique(clipTracks.map((track) => track.objectId).filter((id): id is string => !!id))
    const properties = unique(clipTracks.map((track) => track.property))
    const resolved = clipTracks.filter((track) => track.objectId)

    clipInfos.push({
      id: clipId,
      index,
      name: clip.name || `Clip ${index + 1}`,
      duration: clip.duration,
      trackCount: clip.tracks.length,
      tracks: clipTracks,
      objectIds,
      properties,
      loopable: resolved.length > 0 && resolved.every((track) => track.returnsToStart || track.cyclic),
      cyclic: clipTracks.some((track) => track.cyclic),
      unresolvedTracks: unresolved,
    })

    for (const track of clipTracks) {
      if (!track.objectId) continue
      objects[track.objectId] = mergeCapability(objects[track.objectId], track, clipId)
    }
  })

  return {
    clips: clipInfos,
    clipOrder: clipInfos.map((clip) => clip.id),
    objects,
    tracks,
  }
}

function describeTrack(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  clipId: string,
  track: THREE.KeyframeTrack,
  trackIndex: number,
): TrackInfo {
  const parsed = safeParse(track.name)
  const target = resolveTarget(root, parsed)
  const property = normalizeProperty(parsed?.propertyName ?? '')

  const times = Array.from(track.times)
  const values = Array.from(track.values)
  const stride = times.length > 0 ? Math.max(1, Math.round(values.length / times.length)) : 1

  const { valueMin, valueMax } = componentRange(values, stride)
  const analysis = analyzeMotion(property, times, values, stride)

  return {
    id: `${clipId}::${trackIndex}`,
    clipId,
    trackName: track.name,
    objectId: target?.uuid ?? null,
    targetName: parsed?.nodeName ?? track.name,
    property,
    rawProperty: parsed?.propertyName ?? '',
    keyframeCount: times.length,
    timeStart: times[0] ?? 0,
    timeEnd: times[times.length - 1] ?? clip.duration,
    valueMin,
    valueMax,
    ...analysis,
  }
}

function safeParse(trackName: string) {
  try {
    return THREE.PropertyBinding.parseTrackName(trackName)
  } catch {
    return null
  }
}

/**
 * PropertyBinding.findNode handles uuid, name, and bone lookups. glTF track
 * names can also carry the raw node index, so a uuid/name sweep is the fallback.
 */
function resolveTarget(root: THREE.Object3D, parsed: ReturnType<typeof safeParse>): THREE.Object3D | null {
  if (!parsed) return null

  const found = THREE.PropertyBinding.findNode(root, parsed.nodeName)
  if (found) return found as THREE.Object3D

  let fallback: THREE.Object3D | null = null
  root.traverse((object) => {
    if (fallback) return
    if (object.uuid === parsed.nodeName || object.name === parsed.nodeName) fallback = object
  })
  return fallback
}

function normalizeProperty(property: string): AnimatedProperty {
  switch (property) {
    case 'position':
    case 'quaternion':
    case 'rotation':
    case 'scale':
    case 'morphTargetInfluences':
      return property
    default:
      return 'other'
  }
}

function componentRange(values: number[], stride: number): { valueMin: number[]; valueMax: number[] } {
  const valueMin = new Array(stride).fill(Number.POSITIVE_INFINITY)
  const valueMax = new Array(stride).fill(Number.NEGATIVE_INFINITY)

  for (let i = 0; i < values.length; i += stride) {
    for (let c = 0; c < stride; c++) {
      const value = values[i + c]
      if (value === undefined) continue
      if (value < valueMin[c]) valueMin[c] = value
      if (value > valueMax[c]) valueMax[c] = value
    }
  }

  return {
    valueMin: valueMin.map((value) => (isFinite(value) ? value : 0)),
    valueMax: valueMax.map((value) => (isFinite(value) ? value : 0)),
  }
}

type MotionAnalysis = Pick<
  TrackInfo,
  'dominantAxis' | 'totalRotationDeg' | 'translationDistance' | 'returnsToStart' | 'cyclic'
>

function analyzeMotion(
  property: AnimatedProperty,
  times: number[],
  values: number[],
  stride: number,
): MotionAnalysis {
  const frames = times.length
  const returnsToStart = framesEqual(values, stride, 0, frames - 1) && frames > 1

  if (property === 'quaternion' && stride === 4) {
    return analyzeQuaternion(values, frames, returnsToStart)
  }

  if (property === 'rotation' && stride >= 3) {
    return analyzeEuler(values, stride, frames, returnsToStart)
  }

  if (property === 'position' && stride >= 3) {
    const { axis, spread, distance } = vectorSpread(values, stride, frames)
    return {
      dominantAxis: spread > 1e-6 ? axis : null,
      totalRotationDeg: null,
      translationDistance: distance,
      returnsToStart,
      cyclic: returnsToStart && frames > 2,
    }
  }

  if (property === 'scale' && stride >= 3) {
    const { axis, spread } = vectorSpread(values, stride, frames)
    return {
      dominantAxis: spread > 1e-6 ? axis : null,
      totalRotationDeg: null,
      translationDistance: null,
      returnsToStart,
      cyclic: returnsToStart && frames > 2,
    }
  }

  return {
    dominantAxis: null,
    totalRotationDeg: null,
    translationDistance: null,
    returnsToStart,
    cyclic: returnsToStart && frames > 2,
  }
}

/**
 * Sums the angle between consecutive keyframe quaternions. A full turn shows up
 * as ~360° even though the first and last quaternion are identical, which is
 * exactly what separates a spinning fan from a door that swings back shut.
 */
function analyzeQuaternion(values: number[], frames: number, returnsToStart: boolean): MotionAnalysis {
  const a = new THREE.Quaternion()
  const b = new THREE.Quaternion()
  const delta = new THREE.Quaternion()
  const axisSum = new THREE.Vector3()
  let total = 0

  for (let i = 1; i < frames; i++) {
    a.fromArray(values, (i - 1) * 4)
    b.fromArray(values, i * 4)
    delta.copy(a).invert().multiply(b)

    const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(delta.w), -1, 1))
    if (angle < 1e-6) continue

    const sinHalf = Math.sqrt(Math.max(0, 1 - delta.w * delta.w))
    if (sinHalf > 1e-6) {
      const sign = delta.w < 0 ? -1 : 1
      axisSum.x += (delta.x / sinHalf) * angle * sign
      axisSum.y += (delta.y / sinHalf) * angle * sign
      axisSum.z += (delta.z / sinHalf) * angle * sign
    }
    total += angle
  }

  const totalDeg = THREE.MathUtils.radToDeg(total)
  const dominantAxis = dominantOf([Math.abs(axisSum.x), Math.abs(axisSum.y), Math.abs(axisSum.z)])

  return {
    dominantAxis: totalDeg > ROTATION_EPSILON_DEG ? dominantAxis : null,
    totalRotationDeg: totalDeg,
    translationDistance: null,
    returnsToStart,
    cyclic: totalDeg >= SPIN_THRESHOLD_DEG || (returnsToStart && frames > 2),
  }
}

function analyzeEuler(values: number[], stride: number, frames: number, returnsToStart: boolean): MotionAnalysis {
  const spans = [0, 1, 2].map((component) => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    let travel = 0
    let previous: number | null = null

    for (let i = 0; i < frames; i++) {
      const value = values[i * stride + component]
      if (value === undefined) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
      if (previous !== null) travel += Math.abs(value - previous)
      previous = value
    }

    return { spread: isFinite(max - min) ? max - min : 0, travel }
  })

  const dominantAxis = dominantOf(spans.map((span) => span.spread))
  const index = dominantAxis ? AXES.indexOf(dominantAxis) : 0
  const totalDeg = THREE.MathUtils.radToDeg(spans[index]?.travel ?? 0)

  return {
    dominantAxis: totalDeg > ROTATION_EPSILON_DEG ? dominantAxis : null,
    totalRotationDeg: totalDeg,
    translationDistance: null,
    returnsToStart,
    cyclic: totalDeg >= SPIN_THRESHOLD_DEG || (returnsToStart && frames > 2),
  }
}

function vectorSpread(values: number[], stride: number, frames: number) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 3; c++) {
      const value = values[i * stride + c]
      if (value === undefined) continue
      min[c] = Math.min(min[c], value)
      max[c] = Math.max(max[c], value)
    }
  }

  const spreads = [0, 1, 2].map((c) => (isFinite(max[c] - min[c]) ? max[c] - min[c] : 0))
  const distance = Math.sqrt(spreads.reduce((sum, value) => sum + value * value, 0))

  return {
    axis: dominantOf(spreads),
    spread: Math.max(...spreads),
    distance,
  }
}

function dominantOf(magnitudes: number[]): Axis | null {
  let best = -1
  let bestIndex = -1
  magnitudes.forEach((value, index) => {
    if (value > best) {
      best = value
      bestIndex = index
    }
  })
  return best > 0 && bestIndex >= 0 ? AXES[bestIndex] : null
}

function framesEqual(values: number[], stride: number, frameA: number, frameB: number): boolean {
  if (frameA < 0 || frameB < 0) return false
  for (let c = 0; c < stride; c++) {
    const a = values[frameA * stride + c]
    const b = values[frameB * stride + c]
    if (a === undefined || b === undefined) return false
    if (Math.abs(a - b) > RETURN_EPSILON) return false
  }
  return true
}

function mergeCapability(
  existing: ObjectAnimationCapability | undefined,
  track: TrackInfo,
  clipId: string,
): ObjectAnimationCapability {
  const capability: ObjectAnimationCapability = existing ?? {
    objectId: track.objectId as string,
    clipIds: [],
    trackIds: [],
    properties: [],
    rotation: null,
    translation: null,
    scaling: null,
    morphing: false,
  }

  if (!capability.clipIds.includes(clipId)) capability.clipIds.push(clipId)
  capability.trackIds.push(track.id)
  if (!capability.properties.includes(track.property)) capability.properties.push(track.property)

  if (track.property === 'quaternion' || track.property === 'rotation') {
    const totalDeg = track.totalRotationDeg ?? 0
    const previous = capability.rotation
    capability.rotation = {
      axis: totalDeg >= (previous?.totalDeg ?? 0) ? track.dominantAxis : (previous?.axis ?? null),
      totalDeg: Math.max(previous?.totalDeg ?? 0, totalDeg),
      cyclic: (previous?.cyclic ?? false) || track.cyclic,
    }
  }

  if (track.property === 'position') {
    const distance = track.translationDistance ?? 0
    const previous = capability.translation
    capability.translation = {
      axis: distance >= (previous?.distance ?? 0) ? track.dominantAxis : (previous?.axis ?? null),
      distance: Math.max(previous?.distance ?? 0, distance),
    }
  }

  if (track.property === 'scale') {
    const amount = Math.max(...track.valueMax.map((value, index) => Math.abs(value - (track.valueMin[index] ?? 0))), 0)
    const previous = capability.scaling
    capability.scaling = {
      axis: amount >= (previous?.amount ?? 0) ? track.dominantAxis : (previous?.axis ?? null),
      amount: Math.max(previous?.amount ?? 0, amount),
    }
  }

  if (track.property === 'morphTargetInfluences') capability.morphing = true

  return capability
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
