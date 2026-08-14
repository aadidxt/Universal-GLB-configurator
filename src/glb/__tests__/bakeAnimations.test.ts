import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildBakedClips } from '../bakeAnimations'
import { createInteractionFromPreset, flipDirection, withOpenAngle } from '../../engine/interaction/presets'
import type { InteractionDefinition } from '../../engine/interaction/types'

function driverFor(): THREE.Object3D {
  const object = new THREE.Group()
  object.name = 'DoorPivot'
  return object
}

function rotationDefinition(overrides: Partial<InteractionDefinition> = {}): InteractionDefinition {
  const definition = createInteractionFromPreset('genericRotation', { targetId: 'obj', name: 'Door' })
  return { ...definition, ...overrides }
}

/** Signed yaw of a quaternion sample inside a baked track. */
function yawAt(track: THREE.QuaternionKeyframeTrack, frame: number): number {
  const q = new THREE.Quaternion().fromArray(Array.from(track.values), frame * 4)
  const deg = THREE.MathUtils.radToDeg(2 * Math.atan2(q.y, q.w))
  return ((deg + 180) % 360) - 180
}

describe('buildBakedClips', () => {
  it('bakes a rotation into a quaternion track on the driver', () => {
    const driver = driverFor()
    const definition = withOpenAngle(rotationDefinition(), 105)

    const { clips, warnings } = buildBakedClips([definition], () => driver)

    expect(warnings).toEqual([])
    expect(clips).toHaveLength(1)
    expect(clips[0].tracks[0].name).toBe(`${driver.uuid}.quaternion`)
    expect(clips[0].duration).toBeCloseTo(1, 5)
  })

  it('starts at 0° and ends at exactly the configured angle', () => {
    const driver = driverFor()
    const track = buildBakedClips([withOpenAngle(rotationDefinition(), 105)], () => driver)[
      'clips'
    ][0].tracks[0] as THREE.QuaternionKeyframeTrack

    const frames = track.times.length
    expect(yawAt(track, 0)).toBeCloseTo(0, 3)
    expect(yawAt(track, frames - 1)).toBeCloseTo(105, 3)
  })

  it('keeps the flipped direction in the exported curve', () => {
    const driver = driverFor()
    const definition = flipDirection(withOpenAngle(rotationDefinition(), 120))
    const track = buildBakedClips([definition], () => driver).clips[0].tracks[0] as THREE.QuaternionKeyframeTrack

    expect(yawAt(track, track.times.length - 1)).toBeCloseTo(-120, 3)
  })

  it('samples eased motion and collapses linear motion to two keys', () => {
    const driver = driverFor()
    const eased = rotationDefinition({
      config: { kind: 'rotateBetween', axis: 'y', closedDeg: 0, openDeg: 90, durationMs: 1000, easing: 'easeInOut', loop: 'none' },
    })
    const linear = rotationDefinition({
      config: { kind: 'rotateBetween', axis: 'y', closedDeg: 0, openDeg: 90, durationMs: 1000, easing: 'linear', loop: 'none' },
    })

    expect(buildBakedClips([eased], () => driver).clips[0].tracks[0].times.length).toBeGreaterThan(10)
    expect(buildBakedClips([linear], () => driver).clips[0].tracks[0].times).toHaveLength(2)
  })

  it('respects the driver rest pose instead of assuming identity', () => {
    const driver = driverFor()
    driver.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(30))

    const track = buildBakedClips([withOpenAngle(rotationDefinition(), 60)], () => driver)
      .clips[0].tracks[0] as THREE.QuaternionKeyframeTrack

    // Baked curve starts where the model rests and adds the configured swing.
    expect(yawAt(track, 0)).toBeCloseTo(30, 3)
    expect(yawAt(track, track.times.length - 1)).toBeCloseTo(90, 3)
  })

  it('bakes a spin as one full revolution whose length follows the speed', () => {
    const driver = driverFor()
    const fan = createInteractionFromPreset('fan', { targetId: 'obj', name: 'Fan' })

    const clip = buildBakedClips([fan], () => driver).clips[0]
    // 360°/s default speed means a one-second revolution.
    expect(clip.duration).toBeCloseTo(1, 5)
    expect(clip.tracks[0].times.length).toBe(2)
  })

  it('bakes a slider into a position track', () => {
    const driver = driverFor()
    driver.position.set(1, 2, 3)
    const drawer = createInteractionFromPreset('drawer', {
      targetId: 'obj',
      name: 'Drawer',
      extent: [1, 1, 1],
      suggestedAxis: 'z',
    })

    const track = buildBakedClips([drawer], () => driver).clips[0].tracks[0] as THREE.VectorKeyframeTrack
    const last = Array.from(track.values).slice(-3)

    expect(track.name).toBe(`${driver.uuid}.position`)
    expect(last[2]).toBeCloseTo(3.8, 5)
  })

  it('warns instead of failing for motions glTF cannot express', () => {
    const driver = driverFor()
    const visibility = createInteractionFromPreset('visibility', { targetId: 'obj', name: 'Panel' })

    const { clips, warnings } = buildBakedClips([visibility], () => driver)

    expect(clips).toEqual([])
    expect(warnings[0]).toMatch(/visibility/)
  })

  it('skips definitions whose driver is gone', () => {
    const { clips, warnings } = buildBakedClips([rotationDefinition()], () => null)

    expect(clips).toEqual([])
    expect(warnings[0]).toMatch(/no target/)
  })

  it('gives every clip a unique name', () => {
    const driver = driverFor()
    const a = rotationDefinition({ name: 'Door' })
    const b = rotationDefinition({ id: 'second', name: 'Door' })

    const names = buildBakedClips([a, b], () => driver).clips.map((clip) => clip.name)
    expect(new Set(names).size).toBe(2)
  })
})
