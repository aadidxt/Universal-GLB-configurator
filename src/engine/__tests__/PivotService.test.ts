import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PivotService, resolvePivotPoint } from '../interaction/PivotService'

/** Door-like panel: 1 x 2 x 0.1, centred at x = 1 with its origin at x = 0. */
function buildDoor() {
  const scene = new THREE.Group()
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1))
  door.name = 'Door'
  door.geometry.translate(0.5, 0, 0)
  scene.add(door)

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05))
  handle.name = 'Handle'
  handle.position.set(0.9, 0, 0.06)
  door.add(handle)

  scene.updateMatrixWorld(true)
  return { scene, door, handle }
}

describe('PivotService', () => {
  it('derives pivot points from world bounds', () => {
    const { door } = buildDoor()

    expect(resolvePivotPoint([door], { mode: 'center' }).x).toBeCloseTo(0.5, 5)
    expect(resolvePivotPoint([door], { mode: 'left' }).x).toBeCloseTo(0, 5)
    expect(resolvePivotPoint([door], { mode: 'right' }).x).toBeCloseTo(1, 5)
    expect(resolvePivotPoint([door], { mode: 'top' }).y).toBeCloseTo(1, 5)
    expect(resolvePivotPoint([door], { mode: 'bottom' }).y).toBeCloseTo(-1, 5)
    expect(resolvePivotPoint([door], { mode: 'original' }).x).toBeCloseTo(0, 5)
    expect(resolvePivotPoint([door], { mode: 'custom', point: [3, 4, 5] }).toArray()).toEqual([3, 4, 5])
  })

  it('does not move the model when a proxy pivot is created', () => {
    const { door, handle } = buildDoor()
    const doorWorld = door.getWorldPosition(new THREE.Vector3()).clone()
    const handleWorld = handle.getWorldPosition(new THREE.Vector3()).clone()

    const service = new PivotService()
    const binding = service.bind('ix', [door], { mode: 'right' })

    expect(binding?.proxy).toBe(true)
    expect(door.getWorldPosition(new THREE.Vector3()).distanceTo(doorWorld)).toBeLessThan(1e-6)
    expect(handle.getWorldPosition(new THREE.Vector3()).distanceTo(handleWorld)).toBeLessThan(1e-6)
  })

  it('places the proxy at the requested hinge point', () => {
    const { door } = buildDoor()
    const service = new PivotService()
    const binding = service.bind('ix', [door], { mode: 'right' })

    expect(binding?.driver.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(1, 5)
    expect(binding?.point.x).toBeCloseTo(1, 5)
  })

  it('rotating the proxy swings the panel around the hinge, not its own origin', () => {
    const { door } = buildDoor()
    const service = new PivotService()
    const binding = service.bind('ix', [door], { mode: 'right' })!

    // The pivot point itself is the fixed point of the rotation.
    const pivotLocal = door.worldToLocal(binding.point.clone())
    const hingeBefore = binding.point.clone()

    binding.driver.rotateY(Math.PI / 2)
    binding.driver.updateMatrixWorld(true)

    expect(door.localToWorld(pivotLocal.clone()).distanceTo(hingeBefore)).toBeLessThan(1e-6)

    // The free edge swings out of the original plane, the hinge edge barely moves.
    const free = door.localToWorld(new THREE.Vector3(0, 0, 0))
    const hingeEdge = door.localToWorld(new THREE.Vector3(1, 0, 0))
    expect(Math.abs(free.z)).toBeGreaterThan(0.9)
    expect(Math.abs(hingeEdge.x - 1)).toBeLessThan(0.05)
  })

  it('release() restores the original parent and world pose', () => {
    const { scene, door } = buildDoor()
    const world = door.getWorldPosition(new THREE.Vector3()).clone()

    const service = new PivotService()
    service.bind('ix', [door], { mode: 'left' })
    service.release('ix')

    expect(door.parent).toBe(scene)
    expect(scene.children.some((child) => child.name.startsWith('__pivot_'))).toBe(false)
    expect(door.getWorldPosition(new THREE.Vector3()).distanceTo(world)).toBeLessThan(1e-6)
  })

  it('re-binding the same key does not stack proxy groups', () => {
    const { scene, door } = buildDoor()
    const service = new PivotService()

    service.bind('ix', [door], { mode: 'left' })
    service.bind('ix', [door], { mode: 'right' })

    const proxies = scene.children.filter((child) => child.name.startsWith('__pivot_'))
    expect(proxies).toHaveLength(1)
    expect(service.get('ix')?.driver.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(1, 5)
  })

  it('groups several objects into one logical part', () => {
    const scene = new THREE.Group()
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1))
    frame.name = 'Frame'
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.02))
    glass.name = 'Glass'
    glass.position.set(0.2, 0, 0.06)
    scene.add(frame, glass)
    scene.updateMatrixWorld(true)

    const service = new PivotService()
    const binding = service.bind('ix', [frame, glass], { mode: 'left' })!

    expect(binding.proxy).toBe(true)
    expect(frame.parent).toBe(binding.driver)
    expect(glass.parent).toBe(binding.driver)

    const glassBefore = glass.getWorldPosition(new THREE.Vector3()).clone()
    binding.driver.rotateY(0.5)
    binding.driver.updateMatrixWorld(true)
    // Both parts moved, and they moved together.
    expect(glass.getWorldPosition(new THREE.Vector3()).distanceTo(glassBefore)).toBeGreaterThan(0.01)
    expect(glass.parent).toBe(frame.parent)
  })

  it('keeps the object itself as driver for mode "original"', () => {
    const { door } = buildDoor()
    const service = new PivotService()
    const binding = service.bind('ix', [door], { mode: 'original' })

    expect(binding?.proxy).toBe(false)
    expect(binding?.driver).toBe(door)
  })
})
