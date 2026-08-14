import { useMemo } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'
import { useInteractionStates } from './useInteractionStates'
import { createInteractionFromPreset } from '../engine/interaction/presets'
import type { Axis, InteractionDefinition, PivotMode } from '../engine/interaction/types'

const QUICK_ANGLES = [45, 60, 90, 105, 120, 180]
const AXES: Axis[] = ['x', 'y', 'z']
const PIVOTS: PivotMode[] = ['original', 'center', 'left', 'right', 'top', 'bottom']

/**
 * Button-only angle control: set a target angle for any object, rotate exactly
 * that much, and put it back at 0° — no gizmo, no timeline, no animation clip
 * required. Each row is an ordinary interaction definition, so it saves and
 * restores with the rest of the project.
 */
export function RotationPanel() {
  const engine = useEngine()
  const manifest = useEditorStore((state) => state.manifest)
  const interactions = useEditorStore((state) => state.interactions)
  const primaryId = useEditorStore((state) => state.primaryId)
  const saveState = useEditorStore((state) => state.saveState)
  const states = useInteractionStates()

  // Only rotation-style controls belong in this tab.
  const rows = useMemo(
    () => interactions.filter((entry) => entry.config.kind === 'rotateBetween'),
    [interactions],
  )

  const selected = primaryId ? manifest.nodes[primaryId] : null

  const addControl = () => {
    if (!selected) return

    const definition = createInteractionFromPreset('genericRotation', {
      targetId: selected.id,
      name: selected.name,
      includeChildren: selected.childIds.length > 0,
      extent: selected.worldBounds?.size,
    })

    // The generic-rotation preset always produces a rotateBetween config.
    if (definition.config.kind !== 'rotateBetween') return

    engine.addInteraction({
      ...definition,
      name: `${selected.name} rotation`,
      labels: { on: 'Rotate', off: 'Back to 0°' },
      config: { ...definition.config, openDeg: 90, durationMs: 800, easing: 'easeInOut' },
    })
  }

  return (
    <div className="rotation-panel">
      <div className="rotation-toolbar">
        <button type="button" className="button button--primary" onClick={addControl} disabled={!selected}>
          {selected ? `Add rotation control for "${selected.name}"` : 'Select an object first'}
        </button>
        <button type="button" className="button" onClick={() => void engine.saveProject()} disabled={rows.length === 0}>
          Save setup
        </button>
        <span className="muted">
          {saveState === 'saved' ? 'saved' : saveState === 'dirty' ? 'unsaved changes' : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="placeholder">
          No rotation controls yet. Pick any object in the Outliner or viewport, then add one — set the angle, press
          Rotate, press Back to 0° to return. Works with or without animation in the GLB.
        </p>
      ) : (
        <div className="rotation-rows">
          {rows.map((row) => (
            <RotationRow key={row.id} definition={row} value={states.get(row.id)?.value ?? 0} />
          ))}
        </div>
      )}
    </div>
  )
}

function RotationRow({ definition, value }: { definition: InteractionDefinition; value: number }) {
  const engine = useEngine()
  const manifest = useEditorStore((state) => state.manifest)
  const config = definition.config
  if (config.kind !== 'rotateBetween') return null

  const target = manifest.nodes[definition.targetId]
  const currentDeg = config.closedDeg + (config.openDeg - config.closedDeg) * value
  const atRest = Math.abs(value) < 1e-3

  const update = (changes: Partial<typeof config>) =>
    engine.updateInteraction({ ...definition, config: { ...config, ...changes } })

  return (
    <article className="rotation-row">
      <header className="rotation-head">
        <button
          type="button"
          className="config-card-title"
          onClick={() => {
            engine.select(definition.targetId)
            engine.focusObject(definition.targetId)
          }}
        >
          {target?.name ?? definition.name}
        </button>
        <span className={`rotation-readout${atRest ? '' : ' rotation-readout--moved'}`}>
          {currentDeg.toFixed(1)}° {atRest ? '(at 0)' : ''}
        </span>
        <button type="button" className="icon-button" title="Remove this control" onClick={() => engine.deleteInteraction(definition.id)}>
          ✕
        </button>
      </header>

      <div className="control-row">
        <span className="control-label">Angle</span>
        <input
          className="input input--tiny"
          type="number"
          step={5}
          value={Math.round(config.openDeg)}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) update({ openDeg: next })
          }}
        />
        <div className="segmented segmented--small">
          {QUICK_ANGLES.map((angle) => (
            <button
              key={angle}
              type="button"
              className={`segment${Math.abs(Math.abs(config.openDeg) - angle) < 0.5 ? ' segment--active' : ''}`}
              onClick={() => update({ openDeg: config.openDeg < 0 ? -angle : angle })}
            >
              {angle}°
            </button>
          ))}
        </div>
        <button type="button" className="button" title="Rotate the other way" onClick={() => engine.flipInteraction(definition.id)}>
          ⇄ Flip
        </button>
      </div>

      <div className="control-row">
        <span className="control-label">Axis / pivot</span>
        <div className="segmented segmented--small">
          {AXES.map((axis) => (
            <button
              key={axis}
              type="button"
              className={`segment${config.axis === axis ? ' segment--active' : ''}`}
              onClick={() => update({ axis })}
            >
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
        <select
          className="input input--small"
          value={definition.pivot.mode}
          onChange={(event) =>
            engine.updateInteraction({ ...definition, pivot: { mode: event.target.value as PivotMode } })
          }
        >
          {PIVOTS.map((mode) => (
            <option key={mode} value={mode}>
              pivot: {mode}
            </option>
          ))}
        </select>
        <label className="toggle" title="Move child parts too">
          <input
            type="checkbox"
            checked={definition.includeChildren}
            onChange={(event) => engine.updateInteraction({ ...definition, includeChildren: event.target.checked })}
          />
          children
        </label>
      </div>

      <div className="control-row">
        <span className="control-label">Move</span>
        <button
          type="button"
          className="button button--primary"
          onClick={() => engine.openInteraction(definition.id)}
        >
          Rotate to {Math.round(config.openDeg)}°
        </button>
        <button type="button" className="button" onClick={() => engine.closeInteraction(definition.id)}>
          Back to 0°
        </button>
        <button
          type="button"
          className="button"
          title="Snap to 0° instantly, without the animation"
          onClick={() => engine.resetInteraction(definition.id)}
        >
          Snap to 0°
        </button>
        <input
          className="input input--tiny"
          type="number"
          step={50}
          min={50}
          value={config.durationMs}
          title="Duration in milliseconds"
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next) && next > 0) update({ durationMs: next })
          }}
        />
        <span className="muted">ms</span>
      </div>
    </article>
  )
}
