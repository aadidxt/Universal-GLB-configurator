import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { AnimationManager } from '../animation/AnimationManager'
import { scanAnimations } from '../animation/AnimationScanner'
import { buildAnimatedScene } from './animationFixtures'

function setup() {
  const fixture = buildAnimatedScene()
  const scan = scanAnimations(fixture.scene, fixture.clips)
  const manager = new AnimationManager()
  manager.setModel(fixture.scene, fixture.clips, scan.clips)
  return { ...fixture, manager, scan }
}

describe('AnimationManager', () => {
  it('creates one action per clip and starts paused', () => {
    const { manager } = setup()
    const states = manager.getStates()

    expect(states).toHaveLength(5)
    expect(states.every((state) => !state.playing)).toBe(true)
    expect(manager.getState('clip-0')?.duration).toBe(2)
  })

  it('defaults cyclic clips to looping and one-shot clips to non-looping', () => {
    const { manager } = setup()

    expect(manager.getState('clip-1')?.loop).toBe(true) // fan spin
    expect(manager.getState('clip-0')?.loop).toBe(false) // door swing
  })

  it('plays, pauses and resumes an individual clip', () => {
    const { manager } = setup()

    manager.play('clip-1')
    expect(manager.getState('clip-1')?.playing).toBe(true)

    manager.update(0.25)
    expect(manager.getState('clip-1')?.time).toBeGreaterThan(0)

    manager.pause('clip-1')
    expect(manager.getState('clip-1')?.playing).toBe(false)
  })

  it('keeps clips independent of each other', () => {
    const { manager } = setup()

    manager.play('clip-1')
    manager.update(0.3)

    expect(manager.getState('clip-1')?.time).toBeGreaterThan(0)
    expect(manager.getState('clip-0')?.time).toBe(0)
    expect(manager.getState('clip-0')?.playing).toBe(false)
  })

  it('actually moves the target object', () => {
    const { manager, fan } = setup()
    const before = fan.quaternion.clone()

    manager.play('clip-1')
    manager.update(0.4)

    expect(fan.quaternion.angleTo(before)).toBeGreaterThan(0.1)
  })

  it('stop() returns the object to the first frame', () => {
    const { manager, door } = setup()

    manager.play('clip-0')
    manager.update(1)
    expect(door.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1)

    manager.stop('clip-0')
    expect(manager.getState('clip-0')?.time).toBe(0)
    expect(door.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
  })

  it('reverse playback walks the clip back to the closed pose', () => {
    const { manager, door } = setup()

    manager.play('clip-0', 1)
    manager.update(2)
    const openAngle = door.quaternion.angleTo(new THREE.Quaternion())
    expect(openAngle).toBeGreaterThan(1)

    manager.play('clip-0', -1)
    manager.update(2)

    expect(door.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(openAngle / 2)
  })

  it('applies playback speed to the action time scale', () => {
    const { manager } = setup()

    manager.setSpeed('clip-1', 2)
    manager.play('clip-1')
    manager.update(0.25)

    expect(manager.getState('clip-1')?.speed).toBe(2)
    expect(manager.getState('clip-1')?.time).toBeCloseTo(0.5, 2)
  })

  it('seeks to an absolute time and clamps to the clip length', () => {
    const { manager } = setup()

    manager.seek('clip-0', 1)
    expect(manager.getState('clip-0')?.time).toBe(1)

    manager.seek('clip-0', 99)
    expect(manager.getState('clip-0')?.time).toBe(2)
  })

  it('seekNormalized maps 0..1 onto the clip duration', () => {
    const { manager } = setup()

    manager.seekNormalized('clip-0', 0.5)
    expect(manager.getState('clip-0')?.time).toBeCloseTo(1, 5)
  })

  it('loop toggling switches between LoopOnce and LoopRepeat', () => {
    const { manager } = setup()

    manager.setLoop('clip-0', true)
    manager.play('clip-0')
    manager.update(5)

    // With looping on, a 2s clip does not stop at its end.
    expect(manager.getState('clip-0')?.playing).toBe(true)
  })

  it('stopAll resets every clip', () => {
    const { manager } = setup()

    manager.play('clip-0')
    manager.play('clip-1')
    manager.update(0.5)
    manager.stopAll()

    expect(manager.getStates().every((state) => state.time === 0 && !state.playing)).toBe(true)
  })

  it('notifies listeners when playback state changes', () => {
    const { manager } = setup()
    let calls = 0
    const unsubscribe = manager.onChange(() => (calls += 1))

    manager.play('clip-0')
    manager.pause('clip-0')
    unsubscribe()
    manager.play('clip-0')

    expect(calls).toBe(2)
  })

  it('setModel tears down the previous model completely', () => {
    const { manager } = setup()
    manager.play('clip-1')

    const next = buildAnimatedScene()
    const scan = scanAnimations(next.scene, [next.clips[0]])
    manager.setModel(next.scene, [next.clips[0]], scan.clips)

    expect(manager.getStates()).toHaveLength(1)
    expect(manager.getState('clip-1')).toBeNull()
    expect(manager.getState('clip-0')?.playing).toBe(false)
  })

  it('dispose leaves no clips behind and stops driving the old objects', () => {
    const { manager, fan } = setup()

    manager.play('clip-1')
    manager.update(0.2)
    manager.dispose()

    const after = fan.quaternion.clone()
    manager.update(1)

    expect(manager.hasClips).toBe(false)
    expect(manager.getStates()).toEqual([])
    expect(fan.quaternion.angleTo(after)).toBe(0)
  })
})
