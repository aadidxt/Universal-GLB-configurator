import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { scanModel } from '../scanner/ModelScanner'
import { buildTestScene } from './fixtures'

describe('scanModel', () => {
  it('captures the full hierarchy without flattening it', () => {
    const { scene, root, body, panelA } = buildTestScene()
    const { manifest } = scanModel(scene)

    expect(manifest.rootIds).toEqual([root.uuid])

    const rootEntry = manifest.nodes[root.uuid]
    expect(rootEntry.parentId).toBeNull()
    expect(rootEntry.depth).toBe(0)
    expect(rootEntry.childIds).toHaveLength(3)

    const bodyEntry = manifest.nodes[body.uuid]
    expect(bodyEntry.parentId).toBe(root.uuid)
    expect(bodyEntry.depth).toBe(1)
    expect(bodyEntry.childIds).toEqual([panelA.uuid, expect.any(String)])

    expect(manifest.nodes[panelA.uuid].depth).toBe(2)
  })

  it('keys nodes by uuid so duplicate names stay distinct', () => {
    const { scene, panelA, panelB } = buildTestScene()
    const { manifest } = scanModel(scene)

    expect(panelA.uuid).not.toBe(panelB.uuid)
    expect(manifest.nodes[panelA.uuid].name).toBe('Panel')
    expect(manifest.nodes[panelB.uuid].name).toBe('Panel')
    expect(manifest.order.filter((id) => manifest.nodes[id].name === 'Panel')).toHaveLength(2)
  })

  it('falls back to a type label for unnamed objects and counts them', () => {
    const { scene, multi } = buildTestScene()
    const { manifest } = scanModel(scene)

    expect(manifest.nodes[multi.uuid].rawName).toBe('')
    expect(manifest.nodes[multi.uuid].name).toBe('<Mesh>')
    expect(manifest.stats.unnamed).toBe(1)
  })

  it('records type flags, transforms and geometry statistics', () => {
    const { scene, panelB, bone, multi } = buildTestScene()
    const { manifest } = scanModel(scene)

    const panel = manifest.nodes[panelB.uuid]
    expect(panel.isMesh).toBe(true)
    expect(panel.isGroup).toBe(false)
    expect(panel.isRenderable).toBe(true)
    expect(panel.position).toEqual([2, 0, 0])
    expect(panel.quaternion).toHaveLength(4)
    expect(panel.scale).toEqual([1, 1, 1])
    expect(panel.geometry?.vertices).toBe(24)
    expect(panel.geometry?.triangles).toBe(12)
    expect(panel.geometry?.indexed).toBe(true)
    expect(panel.geometry?.attributes).toContain('position')
    expect(panel.worldBounds?.size).toEqual([1, 1, 1])

    expect(manifest.nodes[bone.uuid].isBone).toBe(true)
    expect(manifest.nodes[multi.uuid].materialIds).toHaveLength(2)
  })

  it('builds a material registry with reverse references', () => {
    const { scene, sharedMat, uniqueMat, panelA, panelB, multi } = buildTestScene()
    const { manifest } = scanModel(scene)

    const shared = manifest.materials[sharedMat.uuid]
    expect(shared.name).toBe('Shared')
    expect(shared.color).toBe('#ff0000')
    expect(shared.metalness).toBeCloseTo(0.2)
    expect(shared.roughness).toBeCloseTo(0.8)
    expect(shared.maps).toContain('map')
    expect(new Set(shared.userIds)).toEqual(new Set([panelA.uuid, panelB.uuid, multi.uuid]))

    expect(manifest.materials[uniqueMat.uuid].userIds).toEqual([multi.uuid])
    expect(manifest.stats.materials).toBe(2)
    expect(manifest.stats.textures).toBe(1)
  })

  it('produces model-wide statistics', () => {
    const { scene } = buildTestScene()
    const clip = new THREE.AnimationClip('Spin', 1, [
      new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 1, 0, 0]),
    ])
    const { manifest } = scanModel(scene, { animations: [clip] })

    expect(manifest.stats.objects).toBe(7)
    expect(manifest.stats.meshes).toBe(3)
    expect(manifest.stats.groups).toBe(2)
    expect(manifest.stats.bones).toBe(2)
    expect(manifest.stats.triangles).toBe(36)
    expect(manifest.stats.animations).toBe(1)
    expect(manifest.stats.maxDepth).toBe(2)
    expect(manifest.animations[0]).toEqual({ name: 'Spin', duration: 1, tracks: 1 })
  })

  it('carries userData/extras through to the manifest', () => {
    const { scene, panelA } = buildTestScene()
    panelA.userData.gltfExtras = { role: 'panel' }
    const { manifest } = scanModel(scene)

    expect(manifest.nodes[panelA.uuid].userData).toEqual({ gltfExtras: { role: 'panel' } })
    // Phase 3 hook exists but is never populated here.
    expect(manifest.nodes[panelA.uuid].semantic).toBeNull()
  })

  it('returns live lookup maps for every node and material', () => {
    const { scene, panelA, sharedMat } = buildTestScene()
    const { objects, materials } = scanModel(scene)

    expect(objects.get(panelA.uuid)).toBe(panelA)
    expect(materials.get(sharedMat.uuid)).toBe(sharedMat)
  })
})
