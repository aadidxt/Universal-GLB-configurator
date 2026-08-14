import { create } from 'zustand'
import type { ModelStats } from '../engine/ModelManager'
import { EMPTY_MANIFEST, type MaterialEntry, type ModelManifest, type NodeEntry } from '../engine/scanner/types'
import type { TransformMode, TransformSpace } from '../engine/TransformManager'
import type { MaterialEditScope } from '../engine/MaterialService'
import { EMPTY_CAPABILITY_MANIFEST } from '../engine/capability/CapabilityManifest'
import type { CapabilityManifest } from '../engine/capability/types'
import type { InteractionDefinition } from '../engine/interaction/types'
import type { HistorySnapshot } from '../engine/commands/CommandHistory'
import type { EditorSettings, SemanticOverride } from '../project/schema'

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

export type BottomTab = 'configurator' | 'animations' | 'materials' | 'info' | 'rotation'

export interface LoadedModelInfo {
  name: string
  size: number
  loadedAt: number
  stats: ModelStats
  bounds: { size: [number, number, number]; center: [number, number, number] } | null
}

interface EditorState {
  loadState: LoadState
  error: string | null
  model: LoadedModelInfo | null
  manifest: ModelManifest
  /** Derived description everything in the UI queries. */
  capabilities: CapabilityManifest
  activeTab: BottomTab
  gridVisible: boolean

  // Outliner
  selectedIds: string[]
  primaryId: string | null
  expandedIds: Record<string, boolean>
  search: string

  // Transform gizmo
  transformMode: TransformMode
  transformSpace: TransformSpace
  gizmoEnabled: boolean
  snapTranslation: number | null
  snapRotationDeg: number | null

  // Material editing
  materialScope: MaterialEditScope

  // Phase 4: manual interactions, suggestions, undo/redo
  interactions: InteractionDefinition[]
  semanticOverrides: Record<string, SemanticOverride>
  history: HistorySnapshot
  /** Interaction id whose pivot is being edited with the gizmo, if any. */
  pivotEditingFor: string | null

  // Persistence
  /** Hash of the loaded GLB; the key a saved configuration is stored under. */
  modelHash: string | null
  saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  lastSavedAt: number | null
  autosave: boolean
  projectMessage: string | null

  beginLoad: () => void
  loadSucceeded: (model: LoadedModelInfo, manifest: ModelManifest, capabilities: CapabilityManifest) => void
  loadFailed: (message: string) => void
  clearModel: () => void
  clearError: () => void
  setActiveTab: (tab: BottomTab) => void
  setGridVisible: (visible: boolean) => void

  setSelection: (ids: string[], primaryId?: string | null) => void
  setExpanded: (id: string, expanded: boolean) => void
  expandMany: (ids: string[]) => void
  collapseAll: () => void
  expandAll: () => void
  setSearch: (search: string) => void

  applyNodeUpdates: (entries: NodeEntry[]) => void
  applyMaterialUpdates: (entries: MaterialEntry[], removedIds?: string[]) => void
  setObjectMaterialIds: (objectId: string, materialIds: string[]) => void

  setTransformMode: (mode: TransformMode) => void
  setTransformSpace: (space: TransformSpace) => void
  setGizmoEnabled: (enabled: boolean) => void
  setSnapTranslation: (value: number | null) => void
  setSnapRotationDeg: (value: number | null) => void
  setMaterialScope: (scope: MaterialEditScope) => void

  setInteractions: (interactions: InteractionDefinition[]) => void
  upsertInteraction: (interaction: InteractionDefinition) => void
  removeInteraction: (id: string) => void
  setSemanticOverride: (objectId: string, override: SemanticOverride | null) => void
  setHistory: (history: HistorySnapshot) => void
  setPivotEditingFor: (id: string | null) => void

  setModelHash: (hash: string | null) => void
  setSaveState: (state: 'idle' | 'dirty' | 'saving' | 'saved' | 'error', savedAt?: number | null) => void
  setAutosave: (autosave: boolean) => void
  setProjectMessage: (message: string | null) => void
  setSemanticOverrides: (overrides: Record<string, SemanticOverride>) => void
  applyEditorSettings: (settings: EditorSettings) => void
}

const EMPTY_HISTORY: HistorySnapshot = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  depth: 0,
}

const initialModelState = {
  model: null,
  manifest: EMPTY_MANIFEST,
  capabilities: EMPTY_CAPABILITY_MANIFEST,
  interactions: [] as InteractionDefinition[],
  semanticOverrides: {} as Record<string, SemanticOverride>,
  history: EMPTY_HISTORY,
  pivotEditingFor: null as string | null,
  modelHash: null as string | null,
  saveState: 'idle' as 'idle' | 'dirty' | 'saving' | 'saved' | 'error',
  lastSavedAt: null as number | null,
  projectMessage: null as string | null,
  selectedIds: [] as string[],
  primaryId: null as string | null,
  expandedIds: {} as Record<string, boolean>,
  search: '',
}

export const useEditorStore = create<EditorState>((set) => ({
  loadState: 'idle',
  error: null,
  activeTab: 'info',
  gridVisible: true,
  transformMode: 'translate',
  transformSpace: 'world',
  gizmoEnabled: true,
  snapTranslation: null,
  snapRotationDeg: null,
  materialScope: 'isolate',
  autosave: true,
  ...initialModelState,

  beginLoad: () => set({ loadState: 'loading', error: null }),

  loadSucceeded: (model, manifest, capabilities) =>
    set({
      loadState: 'loaded',
      error: null,
      model,
      manifest,
      capabilities,
      // A new model invalidates every id from the previous one.
      interactions: [],
      semanticOverrides: {},
      history: EMPTY_HISTORY,
      pivotEditingFor: null,
      selectedIds: [],
      primaryId: null,
      expandedIds: Object.fromEntries(
        manifest.order.filter((id) => manifest.nodes[id].depth < 1).map((id) => [id, true]),
      ),
      search: '',
    }),

  loadFailed: (message) =>
    set((state) => ({
      // A failed import must not discard a model that is already on screen.
      loadState: state.model ? 'loaded' : 'error',
      error: message,
    })),

  clearModel: () => set({ loadState: 'idle', error: null, ...initialModelState }),
  clearError: () => set({ error: null }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setGridVisible: (gridVisible) => set({ gridVisible }),

  setSelection: (ids, primaryId) =>
    set({ selectedIds: ids, primaryId: primaryId !== undefined ? primaryId : (ids[ids.length - 1] ?? null) }),

  setExpanded: (id, expanded) => set((state) => ({ expandedIds: { ...state.expandedIds, [id]: expanded } })),

  expandMany: (ids) =>
    set((state) => {
      if (ids.length === 0) return state
      const next = { ...state.expandedIds }
      for (const id of ids) next[id] = true
      return { expandedIds: next }
    }),

  collapseAll: () => set({ expandedIds: {} }),

  expandAll: () =>
    set((state) => ({
      expandedIds: Object.fromEntries(state.manifest.order.map((id) => [id, true])),
    })),

  setSearch: (search) => set({ search }),

  applyNodeUpdates: (entries) =>
    set((state) => {
      if (entries.length === 0) return state
      const nodes = { ...state.manifest.nodes }
      for (const entry of entries) nodes[entry.id] = entry
      return { manifest: { ...state.manifest, nodes } }
    }),

  applyMaterialUpdates: (entries, removedIds = []) =>
    set((state) => {
      if (entries.length === 0 && removedIds.length === 0) return state

      const materials = { ...state.manifest.materials }
      for (const id of removedIds) delete materials[id]
      for (const entry of entries) materials[entry.id] = entry

      const existingOrder = state.manifest.materialOrder.filter((id) => materials[id])
      const added = entries.map((entry) => entry.id).filter((id) => !existingOrder.includes(id))
      const materialOrder = [...existingOrder, ...added]

      return {
        manifest: {
          ...state.manifest,
          materials,
          materialOrder,
          stats: { ...state.manifest.stats, materials: materialOrder.length },
        },
      }
    }),

  setObjectMaterialIds: (objectId, materialIds) =>
    set((state) => {
      const node = state.manifest.nodes[objectId]
      if (!node) return state
      return {
        manifest: {
          ...state.manifest,
          nodes: { ...state.manifest.nodes, [objectId]: { ...node, materialIds } },
        },
      }
    }),

  setTransformMode: (transformMode) => set({ transformMode }),
  setTransformSpace: (transformSpace) => set({ transformSpace }),
  setGizmoEnabled: (gizmoEnabled) => set({ gizmoEnabled }),
  setSnapTranslation: (snapTranslation) => set({ snapTranslation }),
  setSnapRotationDeg: (snapRotationDeg) => set({ snapRotationDeg }),
  setMaterialScope: (materialScope) => set({ materialScope }),

  setInteractions: (interactions) => set({ interactions }),

  upsertInteraction: (interaction) =>
    set((state) => {
      const index = state.interactions.findIndex((entry) => entry.id === interaction.id)
      if (index < 0) return { interactions: [...state.interactions, interaction] }
      const next = state.interactions.slice()
      next[index] = interaction
      return { interactions: next }
    }),

  removeInteraction: (id) =>
    set((state) => ({ interactions: state.interactions.filter((entry) => entry.id !== id) })),

  setSemanticOverride: (objectId, override) =>
    set((state) => {
      const next = { ...state.semanticOverrides }
      if (override) next[objectId] = override
      else delete next[objectId]
      return { semanticOverrides: next }
    }),

  setHistory: (history) => set({ history }),
  setPivotEditingFor: (pivotEditingFor) => set({ pivotEditingFor }),

  setModelHash: (modelHash) => set({ modelHash }),
  setSaveState: (saveState, savedAt) =>
    set((state) => ({ saveState, lastSavedAt: savedAt === undefined ? state.lastSavedAt : savedAt })),
  setAutosave: (autosave) => set({ autosave }),
  setProjectMessage: (projectMessage) => set({ projectMessage }),
  setSemanticOverrides: (semanticOverrides) => set({ semanticOverrides }),

  applyEditorSettings: (settings) =>
    set({
      gridVisible: settings.gridVisible,
      transformMode: settings.transformMode,
      transformSpace: settings.transformSpace,
      snapTranslation: settings.snapTranslation,
      snapRotationDeg: settings.snapRotationDeg,
      materialScope: settings.materialScope,
    }),
}))

/** Manual interactions attached to one object (directly or as an extra target). */
export function interactionsForObject(
  interactions: InteractionDefinition[],
  objectId: string,
): InteractionDefinition[] {
  return interactions.filter(
    (entry) => entry.targetId === objectId || entry.extraTargetIds.includes(objectId),
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

/** Ancestor chain for a node, outermost first. Used to reveal search hits. */
export function ancestorsOf(manifest: ModelManifest, id: string): string[] {
  const chain: string[] = []
  let current = manifest.nodes[id]?.parentId ?? null
  while (current) {
    chain.unshift(current)
    current = manifest.nodes[current]?.parentId ?? null
  }
  return chain
}

/** Editor settings slice in the shape the project schema expects. */
export function editorSettingsOf(state: {
  gridVisible: boolean
  transformMode: EditorSettings['transformMode']
  transformSpace: EditorSettings['transformSpace']
  snapTranslation: number | null
  snapRotationDeg: number | null
  materialScope: EditorSettings['materialScope']
}): EditorSettings {
  return {
    gridVisible: state.gridVisible,
    transformMode: state.transformMode,
    transformSpace: state.transformSpace,
    snapTranslation: state.snapTranslation,
    snapRotationDeg: state.snapRotationDeg,
    materialScope: state.materialScope,
  }
}
