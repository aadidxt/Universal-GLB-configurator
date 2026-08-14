import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { scanAnimations } from '../animation/AnimationScanner'
import { buildAnimatedScene, quaternionTrack } from './animationFixtures'

describe('scanAnimations', () => {
  it('resolves every track to the real object, not to a name guess', () => {
    const { scene, door, fan, drawer, clips } = buildAnimatedScene()
    const scan = scanAnimations(scene, clips)

    const doorTrack = scan.clips[0].tracks[0]
    expect(doorTrack.objectId).toBe(door.uuid)
    expect(doorTrack.property).toBe('quaternion')
    expect(scan.clips[1].tracks[0].objectId).toBe(fan.uuid)
    expect(scan.clips[2].tracks[0].objectId).toBe(drawer.uuid)
    expect(scan.clips.every((clip) => clip.unresolvedTracks === 0)).toBe(true)
  })

  it('resolves tracks addressed by uuid, which duplicate names cannot break', () => {
    const scene = new THREE.Group()
    const first = new THREE.Object3D()
    first.name = 'Part'
    const second = new THREE.Object3D()
    second.name = 'Part'
    scene.add(first, second)

    const clip = new THREE.AnimationClip('ByUuid', 1, [
      quaternionTrack(second.uuid, new THREE.Vector3(0, 1, 0), 30),
    ])
    const scan = scanAnimations(scene, [clip])

    expect(scan.clips[0].tracks[0].objectId).toBe(second.uuid)
    expect(scan.clips[0].tracks[0].objectId).not.toBe(first.uuid)
  })

  it('reports unresolved tracks instead of throwing', () => {
    const scene = new THREE.Group()
    const clip = new THREE.AnimationClip('Ghost', 1, [
      quaternionTrack('NotInScene', new THREE.Vector3(0, 1, 0), 30),
    ])
    const scan = scanAnimations(scene, [clip])

    expect(scan.clips[0].unresolvedTracks).toBe(1)
    expect(scan.clips[0].tracks[0].objectId).toBeNull()
    expect(scan.clips[0].objectIds).toEqual([])
  })

  it('captures clip metadata, keyframe counts and time ranges', () => {
    const { scene, clips } = buildAnimatedScene()
    const scan = scanAnimations(scene, clips)
    const doorClip = scan.clips[0]

    expect(doorClip.id).toBe('clip-0')
    expect(doorClip.name).toBe('DoorOpen')
    expect(doorClip.duration).toBe(2)
    expect(doorClip.trackCount).toBe(1)
    expect(doorClip.tracks[0].keyframeCount).toBe(9)
    expect(doorClip.tracks[0].timeStart).toBe(0)
    expect(doorClip.tracks[0].timeEnd).toBe(2)
    expect(doorClip.properties).toEqual(['quaternion'])
  })

  it('measures swing angle and axis for a hinged rotation', () => {
    const { scene, clips } = buildAnimatedScene()
    const track = scanAnimations(scene, clips).clips[0].tracks[0]

    expect(track.totalRotationDeg).toBeGreaterThan(90)
    expect(track.totalRotationDeg).toBeLessThan(100)
    expect(track.dominantAxis).toBe('y')
    expect(track.cyclic).toBe(false)
    expect(track.returnsToStart).toBe(false)
  })

  it('flags a full turn as cyclic even though it ends where it started', () => {
    const { scene, clips } = buildAnimatedScene()
    const track = scanAnimations(scene, clips).clips[1].tracks[0]

    expect(track.totalRotationDeg).toBeGreaterThan(350)
    expect(track.dominantAxis).toBe('z')
    expect(track.cyclic).toBe(true)
    expect(scanAnimations(scene, clips).clips[1].cyclic).toBe(true)
  })

  it('measures translation distance and axis for a sliding part', () => {
    const { scene, clips } = buildAnimatedScene()
    const track = scanAnimations(scene, clips).clips[2].tracks[0]

    expect(track.property).toBe('position')
    expect(track.dominantAxis).toBe('z')
    expect(track.translationDistance).toBeCloseTo(0.6, 5)
  })

  it('builds a per-object capability registry answering "what animates me?"', () => {
    const { scene, door, fan, drawer, decoy, clips } = buildAnimatedScene()
    const scan = scanAnimations(scene, clips)

    expect(scan.objects[door.uuid].clipIds).toEqual(['clip-0'])
    expect(scan.objects[door.uuid].properties).toEqual(['quaternion'])
    expect(scan.objects[door.uuid].rotation?.cyclic).toBe(false)

    expect(scan.objects[fan.uuid].rotation?.cyclic).toBe(true)
    expect(scan.objects[fan.uuid].rotation?.axis).toBe('z')

    expect(scan.objects[drawer.uuid].translation?.distance).toBeCloseTo(0.6, 5)
    // The unanimated decoy has no capability entry at all.
    expect(scan.objects[decoy.uuid]).toBeUndefined()
  })

  it('merges several clips that drive the same object', () => {
    const { scene, door, clips } = buildAnimatedScene()
    const extra = new THREE.AnimationClip('DoorShut', 1, [
      quaternionTrack('FrontDoor', new THREE.Vector3(0, 1, 0), 20, 4, 1),
    ])
    const scan = scanAnimations(scene, [...clips, extra])

    expect(scan.objects[door.uuid].clipIds).toEqual(['clip-0', 'clip-5'])
    expect(scan.objects[door.uuid].trackIds).toHaveLength(2)
  })

  it('handles morph target tracks', () => {
    const scene = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry())
    mesh.name = 'Morphy'
    scene.add(mesh)

    const clip = new THREE.AnimationClip('Morph', 1, [
      new THREE.NumberKeyframeTrack('Morphy.morphTargetInfluences[0]', [0, 1], [0, 1]),
    ])
    const scan = scanAnimations(scene, [clip])

    expect(scan.clips[0].tracks[0].property).toBe('morphTargetInfluences')
    expect(scan.objects[mesh.uuid].morphing).toBe(true)
  })
})
