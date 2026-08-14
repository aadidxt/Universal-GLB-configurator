import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { EditorEngine } from '../engine/EditorEngine'
import { GLBLoadError, loadGLBFromFile } from '../glb/GLBLoader'
import type { MaterialEditScope, MaterialPatch } from '../engine/MaterialService'
import type { InteractionDefinition, PivotSpec, Vec3 } from '../engine/interaction/types'
import {
  createInteractionFromPreset,
  createOverrideFromDetection,
  flipDirection,
  presetForSemantic,
  withOpenAngle,
} from '../engine/interaction/presets'
import type { SemanticType } from '../engine/semantic/types'
import { EngineContext, type EngineApi } from './engineApi'
import { ancestorsOf, editorSettingsOf, useEditorStore } from './editorStore'
import { applyProject, buildProject, readProjectFile, serializeProject } from '../project/projectIO'
import { deleteProject, loadProject, saveProject as persistProject } from '../project/storage'
import { downloadBlob } from '../glb/GLBExporter'
import type { ModelIdentity } from '../project/schema'

export function EngineProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<EditorEngine | null>(null)
  // Guards against a slow import finishing after a newer one already landed.
  const loadTokenRef = useRef(0)

  const mount = useCallback((container: HTMLElement) => {
    const engine = new EditorEngine(container)
    engineRef.current = engine

    const store = useEditorStore.getState()
    engine.setGridVisible(store.gridVisible)
    engine.transforms.setMode(store.transformMode)
    engine.transforms.setSpace(store.transformSpace)
    engine.transforms.setSnapping({
      translation: store.snapTranslation,
      rotationDeg: store.snapRotationDeg,
      scale: null,
    })

    // Engine -> store: selection made in the viewport reaches Outliner/Inspector.
    const unsubscribeSelection = engine.selection.onChange(({ ids, primaryId }) => {
      useEditorStore.getState().setSelection(ids, primaryId)
      if (primaryId) {
        useEditorStore.getState().expandMany(ancestorsOf(useEditorStore.getState().manifest, primaryId))
      }
    })

    // Gizmo -> store: transform values in the Inspector follow the drag.
    const unsubscribeTransform = engine.transforms.onObjectChange((object) => {
      if (engine.isPivotHelper(object)) {
        // Pivot edit mode drives a helper, never a model node.
        engine.notifyPivotHelperMoved()
        return
      }

      const updated = engine.readTransform(object.uuid)
      const node = useEditorStore.getState().manifest.nodes[object.uuid]
      if (!updated || !node) return
      useEditorStore.getState().applyNodeUpdates([{ ...node, ...updated }])
      engine.selection.refreshHighlight()
    })

    // One undo entry per gizmo drag: snapshot on grab, command on release.
    let dragSnapshot: { id: string; transform: ReturnType<EditorEngine['readTransform']> } | null = null
    const unsubscribeDrag = engine.transforms.onDraggingChanged((dragging) => {
      const target = engine.selection.primary
      if (engine.isEditingPivot || !target) return

      if (dragging) {
        dragSnapshot = { id: target.uuid, transform: engine.readTransform(target.uuid) }
        return
      }

      const before = dragSnapshot
      dragSnapshot = null
      if (!before?.transform) return

      const after = engine.readTransform(before.id)
      if (!after || sameTransform(before.transform, after)) return

      const applyTransform = (values: NonNullable<ReturnType<EditorEngine['readTransform']>>) => {
        const object = engine.selection.getObject(before.id)
        if (!object) return
        object.position.fromArray(values.position)
        object.quaternion.fromArray(values.quaternion)
        object.scale.fromArray(values.scale)
        object.updateMatrixWorld(true)

        const node = useEditorStore.getState().manifest.nodes[before.id]
        const refreshed = engine.readTransform(before.id)
        if (node && refreshed) useEditorStore.getState().applyNodeUpdates([{ ...node, ...refreshed }])
        engine.selection.refreshHighlight()
      }

      engine.history.execute({
        label: 'Transform object',
        execute: () => applyTransform(after),
        undo: () => applyTransform(before.transform!),
      })
    })

    const unsubscribeHistory = engine.history.onChange((snapshot) => {
      useEditorStore.getState().setHistory(snapshot)
    })

    const unsubscribeInteractions = engine.interactions.onChange(() => {
      useEditorStore.getState().setInteractions(engine.interactions.getDefinitions())
    })

    // Store -> engine: gizmo settings are plain UI state.
    const unsubscribeStore = useEditorStore.subscribe((state, previous) => {
      if (state.transformMode !== previous.transformMode) engine.transforms.setMode(state.transformMode)
      if (state.transformSpace !== previous.transformSpace) engine.transforms.setSpace(state.transformSpace)
      if (state.gizmoEnabled !== previous.gizmoEnabled) engine.transforms.setEnabled(state.gizmoEnabled)
      if (
        state.snapTranslation !== previous.snapTranslation ||
        state.snapRotationDeg !== previous.snapRotationDeg
      ) {
        engine.transforms.setSnapping({
          translation: state.snapTranslation,
          rotationDeg: state.snapRotationDeg,
          scale: null,
        })
      }
    })

    if (import.meta.env.DEV) {
      const globals = window as unknown as Record<string, unknown>
      globals.__engineDebug = () => engine.debugSnapshot()
      globals.__matDebug = () => engine.debugMaterialColors()
      globals.__nodeDebug = (name: string) => engine.debugNode(name)
      globals.__gizmoDebug = () => engine.debugGizmo()
      globals.__capDebug = () => engine.debugCapabilities()
      globals.__interactionDebug = () => engine.getInteractions()
      globals.__projectDebug = async () => {
        const hash = useEditorStore.getState().modelHash
        return { hash, stored: hash ? await loadProject(hash) : null }
      }
    }

    return () => {
      unsubscribeSelection()
      unsubscribeTransform()
      unsubscribeDrag()
      unsubscribeHistory()
      unsubscribeInteractions()
      unsubscribeStore()
      engine.dispose()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [])

  // loadFile runs before applyStoredProject is defined, so it reaches it by ref.
  const applyStoredProjectRef = useRef<((project: Parameters<typeof applyProject>[1], origin: string) => void) | null>(
    null,
  )

  const loadFile = useCallback(async (file: File) => {
    const token = ++loadTokenRef.current
    useEditorStore.getState().beginLoad()

    try {
      const { gltf, info } = await loadGLBFromFile(file)
      const engine = engineRef.current

      if (!engine || token !== loadTokenRef.current) {
        // Superseded or unmounted: drop the parsed result instead of showing it.
        return
      }

      const { stats, bounds, manifest, capabilities } = engine.setModel(gltf)

      useEditorStore.getState().loadSucceeded(
        {
          name: info.name,
          size: info.size,
          loadedAt: Date.now(),
          stats,
          bounds: bounds
            ? {
                size: [bounds.size.x, bounds.size.y, bounds.size.z],
                center: [bounds.center.x, bounds.center.y, bounds.center.z],
              }
            : null,
        },
        manifest,
        capabilities,
      )
      useEditorStore.getState().setModelHash(info.hash)

      // Same GLB as before? Bring its saved configuration straight back.
      const stored = await loadProject(info.hash)
      if (stored && engineRef.current === engine && token === loadTokenRef.current) {
        applyStoredProjectRef.current?.(stored, 'Saved configuration restored')
      }
    } catch (error) {
      if (token !== loadTokenRef.current) return
      const message =
        error instanceof GLBLoadError
          ? error.message
          : `Unexpected error while loading "${file.name}": ${error instanceof Error ? error.message : String(error)}`
      useEditorStore.getState().loadFailed(message)
    }
  }, [])

  const select = useCallback((id: string | null, modifiers: { additive?: boolean; range?: boolean } = {}) => {
    const engine = engineRef.current
    if (!engine) return

    if (!id) {
      engine.setSelection([])
      return
    }

    if (modifiers.additive) {
      engine.toggleSelection(id)
      return
    }

    if (modifiers.range) {
      // Shift extends over the visible depth-first order, like a file tree.
      const state = useEditorStore.getState()
      const anchor = state.primaryId
      const order = state.manifest.order
      const from = anchor ? order.indexOf(anchor) : -1
      const to = order.indexOf(id)

      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from]
        engine.setSelection(order.slice(start, end + 1))
        return
      }
    }

    engine.setSelection([id])
  }, [])

  const pickAt = useCallback(
    (ndcX: number, ndcY: number, modifiers: { additive?: boolean; range?: boolean } = {}) => {
      const engine = engineRef.current
      if (!engine) return
      select(engine.pickAt(ndcX, ndcY), modifiers)
    },
    [select],
  )

  const focusObject = useCallback((id: string) => {
    engineRef.current?.focusObject(id)
  }, [])

  const animationsOf = useCallback(() => engineRef.current?.animations ?? null, [])


  const runCommand = useCallback((label: string, execute: () => void, undo: () => void) => {
    engineRef.current?.history.execute({ label, execute, undo })
  }, [])

  const applyMaterialResult = useCallback((result: ReturnType<EditorEngine['materials']['edit']>) => {
    if (!result) return
    const store = useEditorStore.getState()
    store.applyMaterialUpdates(result.materials, result.removedMaterialIds)
    store.setObjectMaterialIds(result.objectId, result.objectMaterialIds)
  }, [])

  const addInteraction = useCallback(
    (definition: InteractionDefinition) => {
      const engine = engineRef.current
      if (!engine) return

      runCommand(
        `Add ${definition.name}`,
        () => {
          engine.interactions.add(definition)
          useEditorStore.getState().upsertInteraction(definition)
        },
        () => {
          engine.interactions.remove(definition.id)
          useEditorStore.getState().removeInteraction(definition.id)
        },
      )
    },
    [runCommand],
  )

  const updateInteraction = useCallback(
    (definition: InteractionDefinition) => {
      const engine = engineRef.current
      if (!engine) return

      const previous = useEditorStore.getState().interactions.find((entry) => entry.id === definition.id)
      if (!previous) {
        addInteraction(definition)
        return
      }

      const label = previous.pivot.mode !== definition.pivot.mode ? 'Change pivot' : `Edit ${definition.name}`
      runCommand(
        label,
        () => {
          engine.interactions.update(definition)
          useEditorStore.getState().upsertInteraction(definition)
        },
        () => {
          engine.interactions.update(previous)
          useEditorStore.getState().upsertInteraction(previous)
        },
      )
    },
    [addInteraction, runCommand],
  )

  const deleteInteraction = useCallback(
    (id: string) => {
      const engine = engineRef.current
      if (!engine) return

      const previous = useEditorStore.getState().interactions.find((entry) => entry.id === id)
      if (!previous) return

      runCommand(
        `Remove ${previous.name}`,
        () => {
          engine.interactions.remove(id)
          useEditorStore.getState().removeInteraction(id)
        },
        () => {
          engine.interactions.add(previous)
          useEditorStore.getState().upsertInteraction(previous)
        },
      )
    },
    [runCommand],
  )

  const acceptSuggestion = useCallback(
    (objectId: string, semantic: SemanticType) => {
      const engine = engineRef.current
      if (!engine) return

      const state = useEditorStore.getState()
      const node = state.manifest.nodes[objectId]
      const capability = state.capabilities.entries[objectId]
      if (!node) return

      const preset = presetForSemantic(semantic)
      const definition = createInteractionFromPreset(preset, {
        targetId: objectId,
        name: node.name,
        includeChildren: node.childIds.length > 0,
        extent: node.worldBounds?.size,
        clipIds: capability?.clipIds ?? [],
      })
      definition.semantic = semantic
      definition.createdFrom = 'suggestion'

      const previousOverride = state.semanticOverrides[objectId] ?? null
      runCommand(
        `Accept ${semantic} suggestion`,
        () => {
          engine.interactions.add(definition)
          const store = useEditorStore.getState()
          store.upsertInteraction(definition)
          store.setSemanticOverride(objectId, { type: semantic, status: 'accepted' })
        },
        () => {
          engine.interactions.remove(definition.id)
          const store = useEditorStore.getState()
          store.removeInteraction(definition.id)
          store.setSemanticOverride(objectId, previousOverride)
        },
      )
    },
    [runCommand],
  )

  const ignoreSuggestion = useCallback(
    (objectId: string) => {
      const state = useEditorStore.getState()
      const previous = state.semanticOverrides[objectId] ?? null
      const semantic = state.capabilities.entries[objectId]?.semantic ?? 'unknown'

      runCommand(
        'Ignore suggestion',
        () => useEditorStore.getState().setSemanticOverride(objectId, { type: semantic, status: 'ignored' }),
        () => useEditorStore.getState().setSemanticOverride(objectId, previous),
      )
    },
    [runCommand],
  )

  const overrideAnimation = useCallback(
    (objectId: string) => {
      const engine = engineRef.current
      if (!engine) return

      const state = useEditorStore.getState()
      const node = state.manifest.nodes[objectId]
      const capability = engine.getAnimationCapability(objectId)
      if (!node || !capability) return

      const definition = createOverrideFromDetection({
        targetId: objectId,
        name: node.name,
        capability,
        extent: node.worldBounds?.size,
        includeChildren: node.childIds.length > 0,
        semantic: state.capabilities.entries[objectId]?.semantic,
      })

      addInteraction(definition)
    },
    [addInteraction],
  )

  const editInteractionById = useCallback(
    (id: string, transform: (definition: InteractionDefinition) => InteractionDefinition) => {
      const previous = useEditorStore.getState().interactions.find((entry) => entry.id === id)
      if (!previous) return
      const next = transform(previous)
      if (next === previous) return
      updateInteraction(next)
    },
    [updateInteraction],
  )


  const modelIdentity = useCallback((): ModelIdentity | null => {
    const state = useEditorStore.getState()
    if (!state.model || !state.modelHash) return null

    return {
      fileName: state.model.name,
      fileSize: state.model.size,
      hash: state.modelHash,
      objectCount: state.manifest.order.length,
      clipCount: state.capabilities.animation.clips.length,
    }
  }, [])

  const snapshotProject = useCallback(() => {
    const engine = engineRef.current
    const model = modelIdentity()
    if (!engine || !model) return null

    const state = useEditorStore.getState()
    return buildProject(engine, {
      model,
      editor: editorSettingsOf(state),
      interactions: state.interactions,
      semanticOverrides: state.semanticOverrides,
      savedAt: Date.now(),
    })
  }, [modelIdentity])

  const saveProject = useCallback(async () => {
    const project = snapshotProject()
    const store = useEditorStore.getState()
    if (!project) {
      store.setProjectMessage('Load a GLB before saving.')
      return
    }

    store.setSaveState('saving')
    try {
      await persistProject(project)
      useEditorStore.getState().setSaveState('saved', project.savedAt)
      useEditorStore.getState().setProjectMessage(null)
    } catch (error) {
      useEditorStore.getState().setSaveState('error')
      useEditorStore.getState().setProjectMessage(`Save failed: ${(error as Error).message}`)
    }
  }, [snapshotProject])

  const applyStoredProject = useCallback((project: Parameters<typeof applyProject>[1], origin: string) => {
    const engine = engineRef.current
    if (!engine) return

    const result = applyProject(engine, project)
    const store = useEditorStore.getState()

    store.setInteractions(engine.interactions.getDefinitions())
    store.setSemanticOverrides(result.semanticOverrides)
    store.applyEditorSettings(result.editor)
    engine.setGridVisible(result.editor.gridVisible)
    if (result.restoredObjects.length > 0) {
      store.applyNodeUpdates(
        result.restoredObjects
          .map((id) => useEditorStore.getState().manifest.nodes[id])
          .filter((node): node is NonNullable<typeof node> => !!node),
      )
    }
    // Restoring is not an undo step; it is the new starting point.
    engine.history.clear()
    store.setSaveState('saved', project.savedAt)
    store.setProjectMessage(
      result.warnings.length > 0
        ? `${origin} with ${result.warnings.length} warning(s): ${result.warnings[0]}`
        : origin,
    )
  }, [])

  applyStoredProjectRef.current = applyStoredProject

  const loadSavedProject = useCallback(async () => {
    const store = useEditorStore.getState()
    const hash = store.modelHash
    if (!hash) return

    const project = await loadProject(hash)
    if (!project) {
      store.setProjectMessage('No saved configuration for this model.')
      return
    }
    applyStoredProject(project, 'Saved configuration restored')
  }, [applyStoredProject])

  const deleteSavedProject = useCallback(async () => {
    const hash = useEditorStore.getState().modelHash
    if (!hash) return
    await deleteProject(hash)
    useEditorStore.getState().setSaveState('idle', null)
    useEditorStore.getState().setProjectMessage('Saved configuration deleted.')
  }, [])

  const exportProject = useCallback(() => {
    const project = snapshotProject()
    if (!project) return

    const blob = new Blob([serializeProject(project)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.model.fileName.replace(/\.glb$/i, '')}.config.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [snapshotProject])

  const exportBakedGlb = useCallback(async () => {
    const engine = engineRef.current
    const store = useEditorStore.getState()
    if (!engine || !store.model) return

    store.setProjectMessage('Baking animations…')
    try {
      const result = await engine.exportBakedGLB()
      if (!result) {
        useEditorStore.getState().setProjectMessage('Nothing to export.')
        return
      }

      const name = store.model.name.replace(/\.glb$/i, '')
      downloadBlob(result.blob, `${name}.configured.glb`)
      useEditorStore.getState().setProjectMessage(
        `Exported ${result.clipNames.length} clip(s), ${Math.round(result.byteLength / 1024)} KB` +
          (result.warnings.length > 0 ? ` — ${result.warnings[0]}` : ''),
      )
    } catch (error) {
      useEditorStore.getState().setProjectMessage(`GLB export failed: ${(error as Error).message}`)
    }
  }, [])

  const importProject = useCallback(
    async (file: File) => {
      const store = useEditorStore.getState()
      const text = await file.text()
      const result = readProjectFile(text, store.modelHash)

      if (!result.project) {
        store.setProjectMessage(`Import failed — ${result.errors[0] ?? 'unknown error'}`)
        return
      }

      applyStoredProject(
        result.project,
        result.modelMismatch
          ? 'Imported (saved for a different GLB — ids may not match)'
          : 'Configuration imported',
      )
    },
    [applyStoredProject],
  )

  const api = useMemo<EngineApi>(
    () => ({
      mount,
      getEngine: () => engineRef.current,
      loadFile,
      frameModel: () => engineRef.current?.frameModel(),
      resetView: () => engineRef.current?.resetView(),
      setGridVisible: (visible: boolean) => {
        engineRef.current?.setGridVisible(visible)
        useEditorStore.getState().setGridVisible(visible)
      },
      select,
      pickAt,
      focusObject,
      focusSelected: () => {
        const primaryId = useEditorStore.getState().primaryId
        if (primaryId) focusObject(primaryId)
      },
      setObjectVisible: (id: string, visible: boolean) => {
        const engine = engineRef.current
        if (!engine) return

        const apply = (next: boolean) => {
          useEditorStore.getState().applyNodeUpdates(engine.setObjectVisible(id, next))
        }
        runCommand(visible ? 'Show object' : 'Hide object', () => apply(visible), () => apply(!visible))
      },

      renameObject: (id: string, name: string) => {
        const engine = engineRef.current
        if (!engine) return

        const previous = useEditorStore.getState().manifest.nodes[id]?.name ?? ''
        if (previous === name) return

        const apply = (value: string) => {
          const updated = engine.setObjectName(id, value)
          if (updated) useEditorStore.getState().applyNodeUpdates([updated])
        }
        runCommand('Rename object', () => apply(name), () => apply(previous))
      },

      editMaterial: (objectId: string, slot: number, patch: MaterialPatch, scope?: MaterialEditScope) => {
        const engine = engineRef.current
        if (!engine) return

        const store = useEditorStore.getState()
        const effectiveScope = scope ?? store.materialScope
        const beforeId = engine.materials.getSlotMaterialId(objectId, slot)
        if (!beforeId) return
        const beforeValues = engine.materials.readValues(beforeId, patch)

        const result = engine.materials.edit(objectId, slot, patch, effectiveScope)
        if (!result) return
        applyMaterialResult(result)

        const afterId = result.materialId
        engine.history.execute({
          // Dragging a colour picker merges into a single history entry.
          mergeKey: `material:${objectId}:${slot}:${Object.keys(patch).join(',')}`,
          label: 'Edit material',
          execute: () => {
            const current = engineRef.current
            if (!current) return
            if (current.materials.getSlotMaterialId(objectId, slot) !== afterId) {
              applyMaterialResult(current.materials.assign(objectId, slot, afterId))
            }
            const entry = current.materials.applyTo(afterId, patch)
            if (entry) useEditorStore.getState().applyMaterialUpdates([entry])
          },
          undo: () => {
            const current = engineRef.current
            if (!current) return
            if (afterId !== beforeId) {
              applyMaterialResult(current.materials.assign(objectId, slot, beforeId))
            }
            const entry = current.materials.applyTo(beforeId, beforeValues)
            if (entry) useEditorStore.getState().applyMaterialUpdates([entry])
          },
        })
      },

      getInteractionEngine: () => engineRef.current?.interactions ?? null,
      addInteraction,
      updateInteraction,
      deleteInteraction,

      toggleInteraction: (id: string) => engineRef.current?.interactions.toggle(id),
      openInteraction: (id: string) => engineRef.current?.interactions.open(id),
      closeInteraction: (id: string) => engineRef.current?.interactions.close(id),
      setInteractionValue: (id: string, value: number) => engineRef.current?.interactions.setValue(id, value),
      setInteractionRunning: (id: string, running: boolean) =>
        engineRef.current?.interactions.setRunning(id, running),
      setInteractionSpeed: (id: string, speed: number) => engineRef.current?.interactions.setSpeed(id, speed),
      setInteractionDirection: (id: string, direction: 1 | -1) =>
        engineRef.current?.interactions.setDirection(id, direction),
      resetInteraction: (id: string) => engineRef.current?.interactions.reset(id),

      getPivotOptions: (targetId: string, extraIds: string[], includeChildren: boolean) =>
        engineRef.current?.getPivotOptions(targetId, extraIds, includeChildren) ?? {
          original: null,
          center: null,
          left: null,
          right: null,
          top: null,
          bottom: null,
          custom: null,
        },
      resolvePivot: (targetId: string, extraIds: string[], spec: PivotSpec, includeChildren: boolean) =>
        engineRef.current?.resolvePivot(targetId, extraIds, spec, includeChildren) ?? null,

      beginPivotEdit: (interactionId: string, point: Vec3, onMove: (point: Vec3) => void) => {
        engineRef.current?.enterPivotEdit(point, onMove)
        useEditorStore.getState().setPivotEditingFor(interactionId)
      },
      endPivotEdit: () => {
        engineRef.current?.exitPivotEdit()
        useEditorStore.getState().setPivotEditingFor(null)
      },

      acceptSuggestion,
      ignoreSuggestion,
      clearSuggestionOverride: (objectId: string) =>
        useEditorStore.getState().setSemanticOverride(objectId, null),

      overrideAnimation,
      flipInteraction: (id: string) => editInteractionById(id, flipDirection),
      setInteractionAngle: (id: string, degrees: number) =>
        editInteractionById(id, (definition) => withOpenAngle(definition, degrees)),

      saveProject,
      loadSavedProject,
      deleteSavedProject,
      exportProject,
      exportBakedGlb,
      importProject,

      undo: () => engineRef.current?.history.undo(),
      redo: () => engineRef.current?.history.redo(),

      getAnimations: animationsOf,
      playClip: (clipId, direction) => animationsOf()?.play(clipId, direction),
      pauseClip: (clipId) => animationsOf()?.pause(clipId),
      toggleClip: (clipId) => animationsOf()?.toggle(clipId),
      stopClip: (clipId) => animationsOf()?.stop(clipId),
      stopAllClips: () => animationsOf()?.stopAll(),
      setClipLoop: (clipId, loop) => animationsOf()?.setLoop(clipId, loop),
      setClipSpeed: (clipId, speed) => animationsOf()?.setSpeed(clipId, speed),
      setClipDirection: (clipId, direction) => animationsOf()?.setDirection(clipId, direction),
      seekClip: (clipId, time) => animationsOf()?.seek(clipId, time),
      seekClipNormalized: (clipId, value) => animationsOf()?.seekNormalized(clipId, value),

      openWithClip: (clipId) => {
        const animations = animationsOf()
        if (!animations) return
        // One-shot forward run that clamps at the open pose.
        animations.setLoop(clipId, false)
        animations.play(clipId, 1)
      },
      closeWithClip: (clipId) => {
        const animations = animationsOf()
        if (!animations) return
        // Reversing the same clip is the reliable way back when the GLB ships
        // only a forward "open" animation.
        animations.setLoop(clipId, false)
        animations.play(clipId, -1)
      },
      triggerClip: (clipId) => {
        const animations = animationsOf()
        if (!animations) return
        animations.setLoop(clipId, false)
        animations.stop(clipId)
        animations.play(clipId, 1)
      },
    }),
    [
      mount,
      loadFile,
      select,
      pickAt,
      focusObject,
      animationsOf,
      runCommand,
      applyMaterialResult,
      addInteraction,
      updateInteraction,
      deleteInteraction,
      acceptSuggestion,
      ignoreSuggestion,
      overrideAnimation,
      editInteractionById,
      saveProject,
      loadSavedProject,
      deleteSavedProject,
      exportProject,
      exportBakedGlb,
      importProject,
    ],
  )

  return <EngineContext.Provider value={api}>{children}</EngineContext.Provider>
}

/** Structural comparison used to skip no-op gizmo drags. */
function sameTransform(
  a: NonNullable<ReturnType<EditorEngine['readTransform']>>,
  b: NonNullable<ReturnType<EditorEngine['readTransform']>>,
): boolean {
  const equal = (x: number[], y: number[]) => x.every((value, index) => Math.abs(value - y[index]) < 1e-6)
  return equal(a.position, b.position) && equal(a.quaternion, b.quaternion) && equal(a.scale, b.scale)
}
