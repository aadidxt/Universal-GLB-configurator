import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { scanModel } from '../scanner/ModelScanner'
import { scanAnimations } from '../animation/AnimationScanner'
import { buildCapabilityManifest } from '../capability/CapabilityManifest'
import { buildAnimatedScene } from './animationFixtures'

function build(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const root = new THREE.Group()
  root.add(scene)
  const { manifest } = scanModel(root)
  return buildCapabilityManifest(manifest, scanAnimations(root, clips))
}

describe('buildCapabilityManifest', () => {
  it('merges scene, material, animation and semantic data per object', () => {
    const { scene, door, clips } = buildAnimatedScene()
    const capabilities = build(scene, clips)
    const entry = capabilities.entries[door.uuid]

    expect(entry.selectable).toBe(true)
    expect(entry.recolorable).toBe(true)
    expect(entry.transformable).toBe(true)
    expect(entry.animated).toBe(true)
    expect(entry.animatedProperties).toEqual(['quaternion'])
    expect(entry.clipIds).toEqual(['clip-0'])
    expect(entry.semantic).toBe('door')
    expect(entry.confidence).toBeGreaterThan(0.6)
    expect(entry.reasons.length).toBeGreaterThan(0)
  })

  it('generates open/close plus a position scrub for doors', () => {
    const { scene, door, clips } = buildAnimatedScene()
    const kinds = build(scene, clips).entries[door.uuid].interactions.map((item) => item.kind)

    expect(kinds).toContain('open-close')
    expect(kinds).toContain('scrub')
  })

  it('generates on/off, speed and direction for a cyclic fan', () => {
    const { scene, fan, clips } = buildAnimatedScene()
    const kinds = build(scene, clips).entries[fan.uuid].interactions.map((item) => item.kind)

    expect(kinds).toContain('toggle-loop')
    expect(kinds).toContain('speed')
    expect(kinds).toContain('direction')
  })

  it('withholds direction when the clip does not return to its start pose', () => {
    const { scene, door, clips } = buildAnimatedScene()
    const kinds = build(scene, clips).entries[door.uuid].interactions.map((item) => item.kind)

    expect(kinds).not.toContain('direction')
  })

  it('exposes unknown animations as plain playable clips', () => {
    const { scene, mystery, clips } = buildAnimatedScene()
    const capabilities = build(scene, clips)
    const entry = capabilities.entries[mystery.uuid]

    expect(entry.semantic).toBe('animated')
    expect(entry.category).toBe('other')
    expect(entry.interactions.map((item) => item.kind)).toEqual(['play'])
    expect(capabilities.categories.other).toContain(mystery.uuid)
  })

  it('sorts detected components into configurator categories', () => {
    const { scene, door, fan, drawer, button, clips } = buildAnimatedScene()
    const capabilities = build(scene, clips)

    expect(capabilities.categories.doors).toContain(door.uuid)
    expect(capabilities.categories.cooling).toContain(fan.uuid)
    expect(capabilities.categories.drawers).toContain(drawer.uuid)
    expect(capabilities.categories.switches).toContain(button.uuid)
  })

  it('keeps a name-only door as a non-operable candidate', () => {
    const { scene, decoy, clips } = buildAnimatedScene()
    const entry = build(scene, clips).entries[decoy.uuid]

    expect(entry.animated).toBe(false)
    expect(entry.operable).toBe(false)
    expect(entry.interactions).toEqual([])
    expect(entry.inConfigurator).toBe(true)
  })

  it('leaves static clutter out of the configurator entirely', () => {
    const scene = new THREE.Group()
    const screw = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01))
    screw.name = 'Screw_004'
    scene.add(screw)

    const capabilities = build(scene, [])
    const entry = capabilities.entries[screw.uuid]

    expect(entry.inConfigurator).toBe(false)
    expect(Object.values(capabilities.categories).flat()).not.toContain(screw.uuid)
  })

  it('maps clips back to the entries they drive', () => {
    const { scene, door, fan, clips } = buildAnimatedScene()
    const capabilities = build(scene, clips)

    expect(capabilities.clipTargets['clip-0']).toEqual([door.uuid])
    expect(capabilities.clipTargets['clip-1']).toEqual([fan.uuid])
  })

  it('keeps every object queryable, not only configurable ones', () => {
    const { scene, handle, clips } = buildAnimatedScene()
    const capabilities = build(scene, clips)

    expect(capabilities.entries[handle.uuid]).toBeDefined()
    expect(capabilities.entries[handle.uuid].animated).toBe(false)
  })
})
