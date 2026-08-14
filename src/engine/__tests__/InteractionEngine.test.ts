import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { InteractionEngine } from '../interaction/InteractionEngine'
import {
  createInteractionFromPreset,
  createOverrideFromDetection,
  flipDirection,
  presetForSemantic,
  withOpenAngle,
} from '../interaction/presets'
import type { InteractionDefinition } from '../interaction/types'

function buildScene() {
  const scene = new THREE.Group()

  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1))
  door.name = 'Door'
  door.geometry.translate(0.5, 0, 0)

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05))
  handle.name = 'Handle'
  handle.position.set(0.9, 0, 0.06)
  door.add(handle)

  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12))
  fan.name = 'Fan'
  fan.position.set(3, 1, 0)

  const drawer = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 0.6))
  drawer.name = 'Drawer'
  drawer.position.set(-2, 0, 0)

  scene.add(door, fan, drawer)
  scene.updateMatrixWorld(true)

  const objects = new Map<string, THREE.Object3D>()
  scene.traverse((object) => objects.set(object.uuid, object))

  const engine = new InteractionEngine()
  engine.setResolver((id) => objects.get(id) ?? null)

  return { scene, door, handle, fan, drawer, engine }
}

function doorDefinition(targetId: string, overrides: Partial<InteractionDefinition> = {}): InteractionDefinition {
  const definition = createInteractionFromPreset('door', { targetId, name: 'Door', extent: [1, 2, 0.1] })
  return { ...definition, ...overrides }
}

describe('InteractionEngine', () => {
  it('definitions stay plain JSON', () => {
    const definition = doorDefinition('id')
    const roundTripped = JSON.parse(JSON.stringify(definition))

    expect(roundTripped).toEqual(definition)
    expect(typeof definition.config).toBe('object')
  })

  it('opens and closes a door around the configured hinge', () => {
    const { engine, door } = buildScene()
    const definition = doorDefinition(door.uuid, { pivot: { mode: 'right' } })
    engine.add(definition)

    engine.open(definition.id)
    for (let i = 0; i < 60; i++) engine.tick(0.05)

    const state = engine.getState(definition.id)!
    expect(state.value).toBeCloseTo(1, 3)

    const freeEdge = door.localToWorld(new THREE.Vector3(0, 0, 0))
    expect(Math.abs(freeEdge.z)).toBeGreaterThan(0.5)
    // The hinged edge stays near the hinge while the free edge swings away.
    expect(Math.abs(door.localToWorld(new THREE.Vector3(1, 0, 0)).x - 1)).toBeLessThan(0.05)

    engine.close(definition.id)
    for (let i = 0; i < 60; i++) engine.tick(0.05)
    expect(engine.getState(definition.id)!.value).toBeCloseTo(0, 3)
    expect(Math.abs(door.localToWorld(new THREE.Vector3(0, 0, 0)).z)).toBeLessThan(1e-3)
  })

  it('moves child parts with the door', () => {
    const { engine, door, handle } = buildScene()
    const before = handle.getWorldPosition(new THREE.Vector3()).clone()

    // Hinge on the opposite edge, so the handle travels the full arc.
    const definition = doorDefinition(door.uuid, { pivot: { mode: 'left' }, includeChildren: true })
    engine.add(definition)
    engine.open(definition.id)
    for (let i = 0; i < 40; i++) engine.tick(0.05)

    expect(handle.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeGreaterThan(0.3)
  })

  it('moves extra targets as one logical part', () => {
    const { engine, door, drawer } = buildScene()
    const before = drawer.getWorldPosition(new THREE.Vector3()).clone()

    const definition = doorDefinition(door.uuid, { pivot: { mode: 'right' }, extraTargetIds: [drawer.uuid] })
    engine.add(definition)
    engine.open(definition.id)
    for (let i = 0; i < 40; i++) engine.tick(0.05)

    expect(drawer.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeGreaterThan(0.1)
  })

  it('adding an interaction never teleports the model', () => {
    const { engine, door } = buildScene()
    const before = door.getWorldPosition(new THREE.Vector3()).clone()

    engine.add(doorDefinition(door.uuid, { pivot: { mode: 'left' } }))

    expect(door.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6)
  })

  it('spins a fan continuously and stops on toggle', () => {
    const { engine, fan } = buildScene()
    const definition = createInteractionFromPreset('fan', { targetId: fan.uuid, name: 'Fan' })
    engine.add(definition)

    engine.setRunning(definition.id, true)
    engine.tick(0.5)
    const spun = fan.getWorldQuaternion(new THREE.Quaternion()).clone()
    expect(spun.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.5)

    engine.toggle(definition.id)
    engine.tick(0.5)
    expect(fan.getWorldQuaternion(new THREE.Quaternion()).angleTo(spun)).toBeLessThan(1e-6)
  })

  it('applies fan speed and direction, clamped to the maximum', () => {
    const { engine, fan } = buildScene()
    const definition = createInteractionFromPreset('fan', { targetId: fan.uuid, name: 'Fan' })
    engine.add(definition)

    engine.setSpeed(definition.id, 99999)
    expect(engine.getState(definition.id)!.speedDegPerSec).toBe(1800)

    engine.setSpeed(definition.id, 90)
    engine.setDirection(definition.id, -1)
    engine.setRunning(definition.id, true)
    engine.tick(1)

    const euler = new THREE.Euler().setFromQuaternion(fan.getWorldQuaternion(new THREE.Quaternion()))
    expect(euler.z).toBeLessThan(0)
  })

  it('slides a drawer between closed and open offsets', () => {
    const { engine, drawer } = buildScene()
    const definition = createInteractionFromPreset('drawer', {
      targetId: drawer.uuid,
      name: 'Drawer',
      extent: [1, 0.3, 0.6],
      suggestedAxis: 'z',
    })
    engine.add(definition)

    engine.setValue(definition.id, 1)
    expect(drawer.position.z).toBeCloseTo(0.48, 3)

    // The drawer preset eases out, so half-way through is past the midpoint.
    engine.setValue(definition.id, 0.5)
    expect(drawer.position.z).toBeCloseTo(0.36, 3)

    engine.reset(definition.id)
    expect(drawer.position.z).toBeCloseTo(0, 5)
  })

  it('toggles visibility including extra targets', () => {
    const { engine, drawer } = buildScene()
    const definition = createInteractionFromPreset('visibility', { targetId: drawer.uuid, name: 'Drawer' })
    engine.add(definition)

    engine.toggle(definition.id)
    expect(drawer.visible).toBe(false)

    engine.toggle(definition.id)
    expect(drawer.visible).toBe(true)
  })

  it('drives discovered clips through the animation bridge', () => {
    const { engine, fan } = buildScene()
    const calls: string[] = []
    engine.setAnimationBridge({
      play: (clipId, direction) => calls.push(`play:${clipId}:${direction}`),
      pause: (clipId) => calls.push(`pause:${clipId}`),
      stop: (clipId) => calls.push(`stop:${clipId}`),
      setLoop: (clipId, loop) => calls.push(`loop:${clipId}:${loop}`),
      setSpeed: () => {},
      isPlaying: () => false,
    })

    const definition = createInteractionFromPreset('existingAnimation', {
      targetId: fan.uuid,
      name: 'Fan',
      clipIds: ['clip-0'],
    })
    engine.add(definition)
    engine.toggle(definition.id)

    expect(calls).toContain('play:clip-0:1')
  })

  it('generic rotation supports ping-pong looping', () => {
    const { engine, drawer } = buildScene()
    const definition = createInteractionFromPreset('genericRotation', { targetId: drawer.uuid, name: 'Part' })
    const looping: InteractionDefinition = {
      ...definition,
      config: { ...definition.config, kind: 'rotateBetween', loop: 'pingpong', durationMs: 100 } as never,
    }
    engine.add(looping)
    engine.setTarget(looping.id, 1)

    engine.tick(0.15)
    expect(engine.getState(looping.id)!.value).toBe(1)
    engine.tick(0.05)
    expect(engine.getState(looping.id)!.value).toBeLessThan(1)
  })

  it('editing a definition keeps the current open/closed state', () => {
    const { engine, door } = buildScene()
    const definition = doorDefinition(door.uuid, { pivot: { mode: 'right' } })
    engine.add(definition)
    engine.setValue(definition.id, 1)

    engine.update({ ...definition, config: { ...definition.config, kind: 'rotateBetween', openDeg: 45 } as never })

    expect(engine.getState(definition.id)!.value).toBe(1)
    const euler = new THREE.Euler().setFromQuaternion(engine.getStates().length ? door.parent!.quaternion : new THREE.Quaternion())
    expect(THREE.MathUtils.radToDeg(euler.y)).toBeCloseTo(45, 0)
  })

  it('removing an interaction restores the rest pose and unwraps the proxy', () => {
    const { engine, door, scene } = buildScene()
    const restWorld = door.getWorldPosition(new THREE.Vector3()).clone()

    const definition = doorDefinition(door.uuid, { pivot: { mode: 'right' } })
    engine.add(definition)
    engine.setValue(definition.id, 1)
    engine.remove(definition.id)

    expect(engine.has(definition.id)).toBe(false)
    expect(door.parent).toBe(scene)
    expect(door.getWorldPosition(new THREE.Vector3()).distanceTo(restWorld)).toBeLessThan(1e-6)
    expect(Math.abs(door.localToWorld(new THREE.Vector3(0, 0, 0)).z)).toBeLessThan(1e-6)
  })

  it('clear() removes every interaction and proxy group', () => {
    const { engine, door, fan, scene } = buildScene()
    engine.add(doorDefinition(door.uuid, { pivot: { mode: 'right' } }))
    engine.add(createInteractionFromPreset('fan', { targetId: fan.uuid, name: 'Fan' }))

    engine.clear()

    expect(engine.getDefinitions()).toEqual([])
    expect(scene.children.some((child) => child.name.startsWith('__pivot_'))).toBe(false)
  })

  it('ignores definitions whose target is missing', () => {
    const { engine } = buildScene()
    const definition = doorDefinition('does-not-exist')

    expect(() => engine.add(definition)).not.toThrow()
    expect(engine.getState(definition.id)?.value).toBe(0)
  })

  it('maps Phase 3 semantics onto the right preset', () => {
    expect(presetForSemantic('door')).toBe('door')
    expect(presetForSemantic('fan')).toBe('fan')
    expect(presetForSemantic('rotating')).toBe('fan')
    expect(presetForSemantic('drawer')).toBe('drawer')
    expect(presetForSemantic('switch')).toBe('button')
  })

  it('door preset defaults to an edge hinge and a ~105° swing', () => {
    const definition = createInteractionFromPreset('door', { targetId: 'x', name: 'Door' })

    expect(definition.pivot.mode).toBe('left')
    expect(definition.config).toMatchObject({ kind: 'rotateBetween', closedDeg: 0, openDeg: 105 })
    expect(definition.labels).toEqual({ on: 'Open', off: 'Close' })
  })
})

/** Signed yaw in degrees; Euler decomposition flips sign past 90°, this does not. */
function yawDeg(quaternion: THREE.Quaternion): number {
  const angle = THREE.MathUtils.radToDeg(2 * Math.atan2(quaternion.y, quaternion.w))
  return ((angle + 180) % 360) - 180
}

describe('animation override (wrong-direction fix)', () => {
  function scanned() {
    const { scene, door, engine } = buildScene()
    const capability = {
      objectId: door.uuid,
      clipIds: ['clip-0'],
      trackIds: ['clip-0::0'],
      properties: ['quaternion' as const],
      rotation: { axis: 'y' as const, totalDeg: 95, cyclic: false },
      translation: null,
      scaling: null,
      morphing: false,
    }
    return { scene, door, engine, capability }
  }

  it('seeds a manual rotation from the measured clip motion', () => {
    const { door, capability } = scanned()
    const definition = createOverrideFromDetection({ targetId: door.uuid, name: 'Door', capability })

    expect(definition.config).toMatchObject({ kind: 'rotateBetween', axis: 'y', openDeg: 95 })
    // The clip drove the node itself, so its own origin is already the hinge.
    expect(definition.pivot.mode).toBe('original')
    expect(definition.overrideClipIds).toEqual(['clip-0'])
    expect(definition.createdFrom).toBe('override')
  })

  it('stops the baked clip so it cannot fight the manual motion', () => {
    const { engine, door, capability } = scanned()
    const stopped: string[] = []
    engine.setAnimationBridge({
      play: () => {},
      pause: () => {},
      stop: (clipId) => stopped.push(clipId),
      setLoop: () => {},
      setSpeed: () => {},
      isPlaying: () => false,
    })

    engine.add(createOverrideFromDetection({ targetId: door.uuid, name: 'Door', capability }))
    expect(stopped).toEqual(['clip-0'])
  })

  it('flip reverses the swing so an inward door opens outward', () => {
    const { engine, door, capability } = scanned()
    const definition = createOverrideFromDetection({ targetId: door.uuid, name: 'Door', capability })
    engine.add(definition)
    engine.setValue(definition.id, 1)
    const inward = yawDeg(door.getWorldQuaternion(new THREE.Quaternion()))

    const flipped = flipDirection(definition)
    expect(flipped.config).toMatchObject({ openDeg: -95 })

    engine.update(flipped)
    engine.setValue(flipped.id, 1)
    const outward = yawDeg(door.getWorldQuaternion(new THREE.Quaternion()))

    // Same amount, opposite sense.
    expect(inward).toBeCloseTo(95, 1)
    expect(outward).toBeCloseTo(-95, 1)
  })

  it('flip works for sliders and spins too', () => {
    const translate = createInteractionFromPreset('drawer', { targetId: 'x', name: 'D', extent: [1, 1, 1] })
    expect(flipDirection(translate).config).toMatchObject({ open: -0.8 })

    const spin = createInteractionFromPreset('fan', { targetId: 'x', name: 'F' })
    expect(flipDirection(spin).config).toMatchObject({ direction: -1 })
  })

  it('quick angles keep the chosen direction', () => {
    const { door, capability } = scanned()
    const definition = createOverrideFromDetection({ targetId: door.uuid, name: 'Door', capability })

    expect(withOpenAngle(definition, 120).config).toMatchObject({ openDeg: 120 })
    expect(withOpenAngle(flipDirection(definition), 120).config).toMatchObject({ openDeg: -120 })
  })

  it('applies the exact configured angle at full open', () => {
    const { engine, door, capability } = scanned()
    const definition = withOpenAngle(
      createOverrideFromDetection({ targetId: door.uuid, name: 'Door', capability }),
      110,
    )
    engine.add(definition)
    engine.setValue(definition.id, 1)

    expect(yawDeg(door.getWorldQuaternion(new THREE.Quaternion()))).toBeCloseTo(110, 1)
  })

  it('returns to the exact rest pose on reset', () => {
    const { engine, door, capability } = scanned()
    const rest = door.getWorldQuaternion(new THREE.Quaternion()).clone()

    const definition = createOverrideFromDetection({ targetId: door.uuid, name: 'Door', capability })
    engine.add(definition)
    engine.setValue(definition.id, 1)
    engine.reset(definition.id)

    expect(door.getWorldQuaternion(new THREE.Quaternion()).angleTo(rest)).toBeLessThan(1e-6)
  })

  it('builds a spin override for a cyclic clip and a slide override for translation', () => {
    const { door, fan } = buildScene()

    const spin = createOverrideFromDetection({
      targetId: fan.uuid,
      name: 'Fan',
      capability: {
        objectId: fan.uuid,
        clipIds: ['clip-1'],
        trackIds: [],
        properties: ['quaternion'],
        rotation: { axis: 'z', totalDeg: 360, cyclic: true },
        translation: null,
        scaling: null,
        morphing: false,
      },
    })
    expect(spin.config.kind).toBe('continuousSpin')

    const slide = createOverrideFromDetection({
      targetId: door.uuid,
      name: 'Drawer',
      capability: {
        objectId: door.uuid,
        clipIds: ['clip-2'],
        trackIds: [],
        properties: ['position'],
        rotation: null,
        translation: { axis: 'z', distance: 0.6 },
        scaling: null,
        morphing: false,
      },
    })
    expect(slide.config).toMatchObject({ kind: 'translateBetween', axis: 'z', open: 0.6 })
  })
})
