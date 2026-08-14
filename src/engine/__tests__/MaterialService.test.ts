import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MaterialService } from '../MaterialService'
import { scanModel } from '../scanner/ModelScanner'
import { buildTestScene } from './fixtures'

function setup() {
  const fixture = buildTestScene()
  const scan = scanModel(fixture.scene)
  const service = new MaterialService()
  service.setIndex(scan.objects, scan.materials)
  return { ...fixture, service, manifest: scan.manifest }
}

describe('MaterialService', () => {
  it('reports sharing accurately', () => {
    const { service, sharedMat, uniqueMat, panelA, multi } = setup()

    expect(service.userCount(sharedMat.uuid)).toBe(3)
    expect(service.isShared(sharedMat.uuid, panelA.uuid)).toBe(true)
    expect(service.isShared(uniqueMat.uuid, multi.uuid)).toBe(false)
  })

  it('isolate mode clones so only the edited object changes', () => {
    const { service, panelA, panelB, sharedMat } = setup()

    const result = service.edit(panelA.uuid, 0, { color: '#0000ff' }, 'isolate')

    expect(result?.cloned).toBe(true)
    expect(result?.materialId).not.toBe(sharedMat.uuid)
    expect((panelA.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('0000ff')
    // The other user keeps the original material untouched.
    expect(panelB.material).toBe(sharedMat)
    expect(sharedMat.color.getHexString()).toBe('ff0000')
    expect(service.userCount(sharedMat.uuid)).toBe(2)
  })

  it('shared mode writes through to every user', () => {
    const { service, panelA, panelB, sharedMat } = setup()

    service.edit(panelA.uuid, 0, { color: '#123456' }, 'shared')

    expect(sharedMat.color.getHexString()).toBe('123456')
    expect(panelA.material).toBe(sharedMat)
    expect(panelB.material).toBe(sharedMat)
  })

  it('does not clone when the object is already the only user', () => {
    const { service, multi, uniqueMat } = setup()

    const result = service.edit(multi.uuid, 1, { color: '#ffffff' }, 'isolate')

    expect(result?.cloned).toBe(false)
    expect(result?.materialId).toBe(uniqueMat.uuid)
    expect(uniqueMat.color.getHexString()).toBe('ffffff')
  })

  it('edits one slot of a material array without touching the others', () => {
    const { service, multi, uniqueMat } = setup()

    const result = service.edit(multi.uuid, 0, { color: '#abcdef' }, 'isolate')
    const slots = multi.material as THREE.MeshStandardMaterial[]

    expect(Array.isArray(multi.material)).toBe(true)
    expect(slots).toHaveLength(2)
    expect(slots[0].color.getHexString()).toBe('abcdef')
    expect(slots[1]).toBe(uniqueMat)
    expect(result?.objectMaterialIds).toEqual([slots[0].uuid, uniqueMat.uuid])
  })

  it('preserves textures when cloning and recoloring', () => {
    const { service, panelA, texture } = setup()

    service.edit(panelA.uuid, 0, { color: '#00ff00' }, 'isolate')
    const material = panelA.material as THREE.MeshStandardMaterial

    expect(material.map).toBe(texture)
    expect(material.color.getHexString()).toBe('00ff00')
  })

  it('applies numeric and transparency patches, flipping transparent with opacity', () => {
    const { service, multi } = setup()

    service.edit(multi.uuid, 1, { metalness: 0.75, roughness: 0.1, opacity: 0.4 }, 'shared')
    const material = (multi.material as THREE.MeshStandardMaterial[])[1]

    expect(material.metalness).toBeCloseTo(0.75)
    expect(material.roughness).toBeCloseTo(0.1)
    expect(material.opacity).toBeCloseTo(0.4)
    expect(material.transparent).toBe(true)
  })

  it('describes materials with their current users', () => {
    const { service, sharedMat, panelA } = setup()

    service.edit(panelA.uuid, 0, { color: '#111111' }, 'isolate')
    const entry = service.describe(sharedMat.uuid)

    expect(entry.userIds).not.toContain(panelA.uuid)
    expect(entry.userIds).toHaveLength(2)
  })

  it('returns null for unknown objects and slots instead of throwing', () => {
    const { service, panelA } = setup()

    expect(service.edit('missing-id', 0, { color: '#fff' }, 'shared')).toBeNull()
    expect(service.edit(panelA.uuid, 5, { color: '#fff' }, 'shared')).toBeNull()
  })

  it('clear() drops the registry so a new model starts empty', () => {
    const { service, sharedMat } = setup()

    service.clear()

    expect(service.getMaterial(sharedMat.uuid)).toBeNull()
    expect(service.userCount(sharedMat.uuid)).toBe(0)
  })
})
