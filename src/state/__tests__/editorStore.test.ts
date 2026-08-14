import { beforeEach, describe, expect, it } from 'vitest'
import { scanModel } from '../../engine/scanner/ModelScanner'
import { scanAnimations } from '../../engine/animation/AnimationScanner'
import { buildCapabilityManifest } from '../../engine/capability/CapabilityManifest'
import type { ModelManifest } from '../../engine/scanner/types'
import { buildTestScene } from '../../engine/__tests__/fixtures'
import { ancestorsOf, useEditorStore } from '../editorStore'
import type { LoadedModelInfo } from '../editorStore'

function caps(manifest: ModelManifest) {
  return buildCapabilityManifest(manifest, scanAnimations(buildTestScene().scene, []))
}

function modelInfo(name: string): LoadedModelInfo {
  return {
    name,
    size: 100,
    loadedAt: 0,
    stats: {
      objects: 0,
      meshes: 0,
      triangles: 0,
      vertices: 0,
      materials: 0,
      textures: 0,
      animations: [],
    },
    bounds: null,
  }
}

describe('editorStore', () => {
  beforeEach(() => {
    useEditorStore.getState().clearModel()
  })

  it('loading a model seeds the manifest and expands top-level nodes', () => {
    const { scene, root } = buildTestScene()
    const { manifest } = scanModel(scene)

    useEditorStore.getState().loadSucceeded(modelInfo('a.glb'), manifest, caps(manifest))
    const state = useEditorStore.getState()

    expect(state.loadState).toBe('loaded')
    expect(state.manifest.order).toHaveLength(7)
    expect(state.expandedIds[root.uuid]).toBe(true)
  })

  it('loading another model clears selection, search and the old registry', () => {
    const first = scanModel(buildTestScene().scene)
    const second = scanModel(buildTestScene().scene)

    const store = useEditorStore.getState()
    store.loadSucceeded(modelInfo('a.glb'), first.manifest, caps(first.manifest))
    store.setSelection([first.manifest.order[0]])
    store.setSearch('panel')

    useEditorStore.getState().loadSucceeded(modelInfo('b.glb'), second.manifest, caps(second.manifest))
    const state = useEditorStore.getState()

    expect(state.selectedIds).toEqual([])
    expect(state.primaryId).toBeNull()
    expect(state.search).toBe('')
    expect(state.model?.name).toBe('b.glb')
    // No id from the previous model survives.
    for (const id of first.manifest.order) expect(state.manifest.nodes[id]).toBeUndefined()
    for (const id of Object.keys(first.manifest.materials)) {
      expect(state.manifest.materials[id]).toBeUndefined()
    }
  })

  it('a failed load keeps the current model on screen', () => {
    const { manifest } = scanModel(buildTestScene().scene)
    useEditorStore.getState().loadSucceeded(modelInfo('a.glb'), manifest, caps(manifest))

    useEditorStore.getState().loadFailed('bad file')
    const state = useEditorStore.getState()

    expect(state.loadState).toBe('loaded')
    expect(state.error).toBe('bad file')
    expect(state.model?.name).toBe('a.glb')
  })

  it('material updates merge into the manifest and drop removed ids', () => {
    const { scene, sharedMat } = buildTestScene()
    const { manifest } = scanModel(scene)
    useEditorStore.getState().loadSucceeded(modelInfo('a.glb'), manifest, caps(manifest))

    const clone = { ...manifest.materials[sharedMat.uuid], id: 'clone-1', name: 'Clone', userIds: ['obj'] }
    useEditorStore.getState().applyMaterialUpdates([clone], [sharedMat.uuid])
    const state = useEditorStore.getState()

    expect(state.manifest.materials['clone-1'].name).toBe('Clone')
    expect(state.manifest.materials[sharedMat.uuid]).toBeUndefined()
    expect(state.manifest.materialOrder).toContain('clone-1')
    expect(state.manifest.stats.materials).toBe(state.manifest.materialOrder.length)
  })

  it('node updates replace entries without rebuilding the manifest order', () => {
    const { scene, panelA } = buildTestScene()
    const { manifest } = scanModel(scene)
    useEditorStore.getState().loadSucceeded(modelInfo('a.glb'), manifest, caps(manifest))

    const node = useEditorStore.getState().manifest.nodes[panelA.uuid]
    useEditorStore.getState().applyNodeUpdates([{ ...node, visible: false, effectiveVisible: false }])
    const state = useEditorStore.getState()

    expect(state.manifest.nodes[panelA.uuid].visible).toBe(false)
    expect(state.manifest.order).toEqual(manifest.order)
  })

  it('ancestorsOf walks from the root down to the node parent', () => {
    const { scene, root, body, panelA } = buildTestScene()
    const { manifest } = scanModel(scene)

    expect(ancestorsOf(manifest, panelA.uuid)).toEqual([root.uuid, body.uuid])
    expect(ancestorsOf(manifest, root.uuid)).toEqual([])
  })
})
