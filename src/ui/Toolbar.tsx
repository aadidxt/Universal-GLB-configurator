import { useRef } from 'react'
import { useEngine } from '../state/useEngine'
import { formatBytes, useEditorStore } from '../state/editorStore'
import type { TransformMode } from '../engine/TransformManager'

const MODES: Array<{ id: TransformMode; label: string; key: string }> = [
  { id: 'translate', label: 'Move', key: 'W' },
  { id: 'rotate', label: 'Rotate', key: 'E' },
  { id: 'scale', label: 'Scale', key: 'R' },
]

export function Toolbar() {
  const engine = useEngine()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const model = useEditorStore((state) => state.model)
  const loadState = useEditorStore((state) => state.loadState)
  const gridVisible = useEditorStore((state) => state.gridVisible)
  const primaryId = useEditorStore((state) => state.primaryId)
  const history = useEditorStore((state) => state.history)
  const saveState = useEditorStore((state) => state.saveState)
  const lastSavedAt = useEditorStore((state) => state.lastSavedAt)
  const autosave = useEditorStore((state) => state.autosave)
  const setAutosave = useEditorStore((state) => state.setAutosave)
  const projectMessage = useEditorStore((state) => state.projectMessage)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const transformMode = useEditorStore((state) => state.transformMode)
  const transformSpace = useEditorStore((state) => state.transformSpace)
  const gizmoEnabled = useEditorStore((state) => state.gizmoEnabled)
  const snapTranslation = useEditorStore((state) => state.snapTranslation)
  const snapRotationDeg = useEditorStore((state) => state.snapRotationDeg)

  const setTransformMode = useEditorStore((state) => state.setTransformMode)
  const setTransformSpace = useEditorStore((state) => state.setTransformSpace)
  const setGizmoEnabled = useEditorStore((state) => state.setGizmoEnabled)
  const setSnapTranslation = useEditorStore((state) => state.setSnapTranslation)
  const setSnapRotationDeg = useEditorStore((state) => state.setSnapRotationDeg)

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <span className="brand">Universal GLB Configurator</span>
        <span className="brand-phase">Phase 4</span>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="button button--primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={loadState === 'loading'}
        >
          {model ? 'Replace GLB' : 'Open GLB'}
        </button>
        <button type="button" className="button" onClick={engine.frameModel} disabled={!model}>
          Frame Model
        </button>
        <button type="button" className="button" onClick={engine.focusSelected} disabled={!primaryId} title="F">
          Focus Selected
        </button>
        <button type="button" className="button" onClick={engine.resetView}>
          Reset View
        </button>
        <button
          type="button"
          className="button"
          onClick={engine.undo}
          disabled={!history.canUndo}
          title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
        >
          Undo
        </button>
        <button
          type="button"
          className="button"
          onClick={engine.redo}
          disabled={!history.canRedo}
          title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}
        >
          Redo
        </button>
      </div>

      <div className="toolbar-group toolbar-group--divider">
        <div className="segmented">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`segment${transformMode === mode.id ? ' segment--active' : ''}`}
              onClick={() => setTransformMode(mode.id)}
              title={`${mode.label} (${mode.key})`}
              disabled={!gizmoEnabled}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="button"
          onClick={() => setTransformSpace(transformSpace === 'world' ? 'local' : 'world')}
          title="Toggle transform space (X)"
          disabled={!gizmoEnabled}
        >
          {transformSpace === 'world' ? 'World' : 'Local'}
        </button>

        <label className="toggle" title="Show the transform gizmo (Q)">
          <input type="checkbox" checked={gizmoEnabled} onChange={(event) => setGizmoEnabled(event.target.checked)} />
          Gizmo
        </label>

        <label className="toggle" title="Translate snap in world units">
          Snap
          <input
            className="input input--tiny"
            type="number"
            min={0}
            step={0.1}
            value={snapTranslation ?? ''}
            placeholder="off"
            onChange={(event) => setSnapTranslation(parseSnap(event.target.value))}
          />
        </label>

        <label className="toggle" title="Rotate snap in degrees">
          Rot°
          <input
            className="input input--tiny"
            type="number"
            min={0}
            step={5}
            value={snapRotationDeg ?? ''}
            placeholder="off"
            onChange={(event) => setSnapRotationDeg(parseSnap(event.target.value))}
          />
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={gridVisible}
            onChange={(event) => engine.setGridVisible(event.target.checked)}
          />
          Grid
        </label>
      </div>

      <div className="toolbar-group toolbar-group--divider">
        <button
          type="button"
          className="button"
          onClick={() => void engine.saveProject()}
          disabled={!model}
          title="Save this configuration for this GLB (stored in your browser)"
        >
          Save
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void engine.loadSavedProject()}
          disabled={!model}
          title="Restore the saved configuration for this GLB"
        >
          Load
        </button>
        <button type="button" className="button" onClick={engine.exportProject} disabled={!model} title="Download the configuration as JSON">
          Export JSON
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void engine.exportBakedGlb()}
          disabled={!model}
          title="Bake the configured motion into animation clips and download a new .glb"
        >
          Export GLB
        </button>
        <button
          type="button"
          className="button"
          onClick={() => importInputRef.current?.click()}
          disabled={!model}
          title="Apply a configuration JSON file"
        >
          Import
        </button>
        <label className="toggle" title="Save automatically after every change">
          <input type="checkbox" checked={autosave} onChange={(event) => setAutosave(event.target.checked)} />
          Auto
        </label>
        <span className={`save-state save-state--${saveState}`} title={projectMessage ?? undefined}>
          {describeSave(saveState, lastSavedAt)}
        </span>
      </div>

      <div className="toolbar-group toolbar-group--end">
        <span className={`status status--${loadState}`}>
          {loadState === 'loading' ? 'Loading…' : loadState === 'error' ? 'Load failed' : model ? 'Ready' : 'No model'}
        </span>
        {model && (
          <span className="file-chip" title={model.name}>
            {model.name} · {formatBytes(model.size)}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void engine.loadFile(file)
          event.target.value = ''
        }}
      />

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void engine.importProject(file)
          event.target.value = ''
        }}
      />
    </header>
  )
}

function describeSave(state: 'idle' | 'dirty' | 'saving' | 'saved' | 'error', lastSavedAt: number | null): string {
  switch (state) {
    case 'saving':
      return 'Saving…'
    case 'saved':
      return lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Saved'
    case 'dirty':
      return 'Unsaved changes'
    case 'error':
      return 'Save failed'
    default:
      return 'Not saved'
  }
}

function parseSnap(raw: string): number | null {
  const value = Number(raw)
  if (!raw.trim() || !isFinite(value) || value <= 0) return null
  return value
}
