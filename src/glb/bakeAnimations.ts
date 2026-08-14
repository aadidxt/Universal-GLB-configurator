import * as THREE from 'three'
import type { InteractionDefinition } from '../engine/interaction/types'

export interface BakedClipResult {
  clips: THREE.AnimationClip[]
  warnings: string[]
}

/** Keyframes per second used when sampling eased motion. */
const SAMPLE_RATE = 24
/** A spin clip is exported as one full revolution, loopable in any viewer. */
const SPIN_TURN_DEG = 360

/**
 * Turns interaction definitions into real AnimationClips so the exported GLB
 * behaves the same in Blender, model-viewer or any three.js scene — no editor
 * required. Tracks target node uuids, which is what GLTFExporter resolves.
 */
export function buildBakedClips(
  definitions: InteractionDefinition[],
  resolveDriver: (id: string) => THREE.Object3D | null,
): BakedClipResult {
  const clips: THREE.AnimationClip[] = []
  const warnings: string[] = []
  const usedNames = new Set<string>()

  for (const definition of definitions) {
    const driver = resolveDriver(definition.id)
    if (!driver) {
      warnings.push(`"${definition.name}" has no target in the scene and was skipped`)
      continue
    }

    const config = definition.config
    const name = uniqueName(definition.name || 'Interaction', usedNames)

    switch (config.kind) {
      case 'rotateBetween': {
        const duration = Math.max(config.durationMs, 1) / 1000
        const track = rotationTrack(driver, config.axis, config.closedDeg, config.openDeg, duration, config.easing)
        clips.push(new THREE.AnimationClip(name, duration, [track]))
        break
      }

      case 'continuousSpin': {
        const speed = config.speedDegPerSec > 0 ? config.speedDegPerSec : 360
        const duration = SPIN_TURN_DEG / speed
        const track = rotationTrack(
          driver,
          config.axis,
          0,
          SPIN_TURN_DEG * config.direction,
          duration,
          'linear',
        )
        clips.push(new THREE.AnimationClip(name, duration, [track]))
        break
      }

      case 'translateBetween': {
        const duration = Math.max(config.durationMs, 1) / 1000
        const track = translationTrack(driver, config.axis, config.closed, config.open, duration, config.easing)
        clips.push(new THREE.AnimationClip(name, duration, [track]))
        break
      }

      case 'transform': {
        warnings.push(`"${definition.name}" uses a generic transform, which is not baked yet`)
        break
      }

      case 'toggleVisibility': {
        // glTF has no visibility animation channel.
        warnings.push(`"${definition.name}" toggles visibility, which glTF cannot animate`)
        break
      }

      case 'playAnimation':
        // Already covered by the model's own clips.
        break
    }
  }

  return { clips, warnings }
}

/**
 * Samples the eased motion so the exported curve matches what the editor shows.
 * Linear easing collapses to two keyframes.
 */
function sampleTimes(duration: number, easing: string): number[] {
  if (easing === 'linear') return [0, duration]

  const count = Math.max(2, Math.round(duration * SAMPLE_RATE))
  return Array.from({ length: count + 1 }, (_, index) => (index / count) * duration)
}

function ease(t: number, easing: string): number {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  switch (easing) {
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    default:
      return x
  }
}

function axisVector(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
  return new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
}

function rotationTrack(
  driver: THREE.Object3D,
  axis: 'x' | 'y' | 'z',
  fromDeg: number,
  toDeg: number,
  duration: number,
  easing: string,
): THREE.QuaternionKeyframeTrack {
  // The rest pose is the reference: the exported curve is base * delta, exactly
  // like the runtime engine applies it.
  const base = driver.quaternion.clone()
  const times = sampleTimes(duration, easing)
  const values: number[] = []
  const delta = new THREE.Quaternion()
  const result = new THREE.Quaternion()
  const vector = axisVector(axis)

  for (const time of times) {
    const t = duration > 0 ? time / duration : 1
    const angle = THREE.MathUtils.degToRad(fromDeg + (toDeg - fromDeg) * ease(t, easing))
    delta.setFromAxisAngle(vector, angle)
    result.copy(base).multiply(delta)
    values.push(result.x, result.y, result.z, result.w)
  }

  return new THREE.QuaternionKeyframeTrack(`${driver.uuid}.quaternion`, times, values)
}

function translationTrack(
  driver: THREE.Object3D,
  axis: 'x' | 'y' | 'z',
  from: number,
  to: number,
  duration: number,
  easing: string,
): THREE.VectorKeyframeTrack {
  const base = driver.position.clone()
  const times = sampleTimes(duration, easing)
  const values: number[] = []
  const vector = axisVector(axis)
  const point = new THREE.Vector3()

  for (const time of times) {
    const t = duration > 0 ? time / duration : 1
    const offset = from + (to - from) * ease(t, easing)
    point.copy(base).addScaledVector(vector, offset)
    values.push(point.x, point.y, point.z)
  }

  return new THREE.VectorKeyframeTrack(`${driver.uuid}.position`, times, values)
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name
  let index = 1
  while (used.has(candidate)) candidate = `${name}_${index++}`
  used.add(candidate)
  return candidate
}
