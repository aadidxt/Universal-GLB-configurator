import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'
import { PRESETS, createInteractionFromPreset } from '../engine/interaction/presets'
import type {
  Axis,
  Easing,
  InteractionDefinition,
  InteractionPreset,
  LoopMode,
  PivotMode,
  PivotSpec,
  Vec3,
} from '../engine/interaction/types'

const AXES: Axis[] = ['x', 'y', 'z']
const EASINGS: Easing[] = ['linear', 'easeInOut', 'easeIn', 'easeOut']
const LOOPS: LoopMode[] = ['none', 'loop', 'pingpong']
const PIVOT_MODES: PivotMode[] = ['original', 'center', 'left', 'right', 'top', 'bottom', 'custom']
const QUICK_ANGLES = [45, 60, 90, 105, 120, 180]

interface Props {
  objectId: string
  /** Existing definition when editing; undefined when adding. */
  existing?: InteractionDefinition
  onClose: () => void
}

/**
 * Add/edit form for one interaction. It only ever produces plain JSON
 * definitions, which the InteractionEngine turns into behaviour.
 */
export function InteractionEditor({ objectId, existing, onClose }: Props) {
  const engine = useEngine()
  const manifest = useEditorStore((state) => state.manifest)
  const capabilities = useEditorStore((state) => state.capabilities)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const pivotEditingFor = useEditorStore((state) => state.pivotEditingFor)

  const node = manifest.nodes[objectId]
  const clips = capabilities.animation.clips

  const [preset, setPreset] = useState<InteractionPreset>(existing?.preset ?? 'door')
  const [draft, setDraft] = useState<InteractionDefinition>(
    () =>
      existing ??
      createInteractionFromPreset('door', {
        targetId: objectId,
        name: node?.name ?? 'Object',
        includeChildren: (node?.childIds.length ?? 0) > 0,
        extent: node?.worldBounds?.size,
        clipIds: capabilities.entries[objectId]?.clipIds ?? [],
      }),
  )

  // Switching preset rebuilds the defaults but keeps target/labels intent.
  useEffect(() => {
    if (existing || !node) return
    setDraft((current) => ({
      ...createInteractionFromPreset(preset, {
        targetId: objectId,
        name: node.name,
        includeChildren: current.includeChildren,
        extent: node.worldBounds?.size,
        clipIds: capabilities.entries[objectId]?.clipIds ?? [],
      }),
      extraTargetIds: current.extraTargetIds,
    }))
  }, [preset, existing, node, objectId, capabilities])

  const pivotOptions = useMemo(
    () => engine.getPivotOptions(draft.targetId, draft.extraTargetIds, draft.includeChildren),
    [engine, draft.targetId, draft.extraTargetIds, draft.includeChildren],
  )

  const editingPivot = pivotEditingFor === draft.id

  const patch = (changes: Partial<InteractionDefinition>) => setDraft((current) => ({ ...current, ...changes }))
  const patchConfig = (changes: Record<string, unknown>) =>
    setDraft((current) => ({ ...current, config: { ...current.config, ...changes } as InteractionDefinition['config'] }))

  const setPivot = (spec: PivotSpec) => patch({ pivot: spec })

  const startPivotEdit = () => {
    const point =
      draft.pivot.mode === 'custom' && draft.pivot.point
        ? draft.pivot.point
        : (engine.resolvePivot(draft.targetId, draft.extraTargetIds, draft.pivot, draft.includeChildren) ?? [0, 0, 0])

    engine.beginPivotEdit(draft.id, point as Vec3, (moved) => setPivot({ mode: 'custom', point: moved }))
    setPivot({ mode: 'custom', point: point as Vec3 })
  }

  const save = () => {
    if (editingPivot) engine.endPivotEdit()
    if (existing) engine.updateInteraction(draft)
    else engine.addInteraction(draft)
    onClose()
  }

  const cancel = () => {
    if (editingPivot) engine.endPivotEdit()
    onClose()
  }

  if (!node) return null

  const extraCandidates = selectedIds.filter((id) => id !== draft.targetId && !draft.extraTargetIds.includes(id))

  return (
    <div className="interaction-editor">
      <div className="editor-head">
        <strong>{existing ? 'Edit interaction' : 'Add interaction'}</strong>
        <span className="muted">{node.name}</span>
      </div>

      {!existing && (
        <label className="field">
          <span>Preset</span>
          <select className="input" value={preset} onChange={(event) => setPreset(event.target.value as InteractionPreset)}>
            {PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted">{PRESETS.find((entry) => entry.id === (existing?.preset ?? preset))?.description}</p>

      <label className="field">
        <span>Name</span>
        <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </label>

      <label className="field field--inline">
        <span>Include children</span>
        <input
          type="checkbox"
          checked={draft.includeChildren}
          onChange={(event) => patch({ includeChildren: event.target.checked })}
        />
        <span className="muted">Move the whole subtree (glass, frame, handle)</span>
      </label>

      <div className="field">
        <span>Extra parts</span>
        <div className="target-list">
          {draft.extraTargetIds.length === 0 && <span className="muted">Only {node.name}</span>}
          {draft.extraTargetIds.map((id) => (
            <button
              key={id}
              type="button"
              className="chip chip--button"
              title="Remove from this logical part"
              onClick={() => patch({ extraTargetIds: draft.extraTargetIds.filter((entry) => entry !== id) })}
            >
              {manifest.nodes[id]?.name ?? id} ✕
            </button>
          ))}
          {extraCandidates.length > 0 && (
            <button
              type="button"
              className="button"
              onClick={() => patch({ extraTargetIds: [...draft.extraTargetIds, ...extraCandidates] })}
            >
              Add {extraCandidates.length} selected
            </button>
          )}
        </div>
      </div>

      {/* Pivot / hinge */}
      {(draft.config.kind === 'rotateBetween' || draft.config.kind === 'continuousSpin') && (
        <div className="field">
          <span>Hinge / pivot</span>
          <div className="pivot-controls">
            <select
              className="input"
              value={draft.pivot.mode}
              onChange={(event) => {
                const mode = event.target.value as PivotMode
                if (mode === 'custom') {
                  const point =
                    engine.resolvePivot(draft.targetId, draft.extraTargetIds, { mode: 'center' }, draft.includeChildren) ??
                    [0, 0, 0]
                  setPivot({ mode, point: point as Vec3 })
                } else {
                  setPivot({ mode })
                }
              }}
            >
              {PIVOT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <button type="button" className="button" onClick={editingPivot ? engine.endPivotEdit : startPivotEdit}>
              {editingPivot ? 'Done' : 'Edit in viewport'}
            </button>
          </div>
          <code className="muted">
            {formatPoint(
              draft.pivot.mode === 'custom' ? (draft.pivot.point ?? null) : (pivotOptions[draft.pivot.mode] ?? null),
            )}
          </code>
        </div>
      )}

      {/* Kind-specific fields */}
      {draft.config.kind === 'rotateBetween' && (
        <>
          <SelectField label="Axis" value={draft.config.axis} options={AXES} onChange={(axis) => patchConfig({ axis })} />
          <NumberField
            label="Closed angle°"
            value={draft.config.closedDeg}
            onChange={(closedDeg) => patchConfig({ closedDeg })}
          />
          <NumberField label="Open angle°" value={draft.config.openDeg} onChange={(openDeg) => patchConfig({ openDeg })} />
          <div className="field">
            <span>Quick angle</span>
            <div className="quick-angles">
              {QUICK_ANGLES.map((angle) => (
                <button
                  key={angle}
                  type="button"
                  className="button"
                  onClick={() => {
                    if (draft.config.kind !== 'rotateBetween') return
                    const sign = draft.config.openDeg < 0 ? -1 : 1
                    patchConfig({ openDeg: angle * sign })
                  }}
                >
                  {angle}°
                </button>
              ))}
              <button
                type="button"
                className="button"
                title="Reverse the swing"
                onClick={() => {
                  if (draft.config.kind !== 'rotateBetween') return
                  patchConfig({ openDeg: -draft.config.openDeg, closedDeg: -draft.config.closedDeg })
                }}
              >
                ⇄ Flip
              </button>
            </div>
          </div>
          <NumberField
            label="Duration ms"
            value={draft.config.durationMs}
            min={10}
            onChange={(durationMs) => patchConfig({ durationMs })}
          />
          <SelectField label="Easing" value={draft.config.easing} options={EASINGS} onChange={(easing) => patchConfig({ easing })} />
          <SelectField label="Loop" value={draft.config.loop} options={LOOPS} onChange={(loop) => patchConfig({ loop })} />
        </>
      )}

      {draft.config.kind === 'translateBetween' && (
        <>
          <SelectField label="Axis" value={draft.config.axis} options={AXES} onChange={(axis) => patchConfig({ axis })} />
          <NumberField label="Closed offset" value={draft.config.closed} step={0.01} onChange={(closed) => patchConfig({ closed })} />
          <NumberField label="Open offset" value={draft.config.open} step={0.01} onChange={(open) => patchConfig({ open })} />
          <NumberField
            label="Duration ms"
            value={draft.config.durationMs}
            min={10}
            onChange={(durationMs) => patchConfig({ durationMs })}
          />
          <SelectField label="Easing" value={draft.config.easing} options={EASINGS} onChange={(easing) => patchConfig({ easing })} />
          <SelectField label="Loop" value={draft.config.loop} options={LOOPS} onChange={(loop) => patchConfig({ loop })} />
        </>
      )}

      {draft.config.kind === 'continuousSpin' && (
        <>
          <SelectField label="Axis" value={draft.config.axis} options={AXES} onChange={(axis) => patchConfig({ axis })} />
          <NumberField
            label="Speed °/s"
            value={draft.config.speedDegPerSec}
            min={0}
            onChange={(speedDegPerSec) => patchConfig({ speedDegPerSec })}
          />
          <NumberField
            label="Max speed °/s"
            value={draft.config.maxSpeedDegPerSec}
            min={1}
            onChange={(maxSpeedDegPerSec) => patchConfig({ maxSpeedDegPerSec })}
          />
          <SelectField
            label="Direction"
            value={draft.config.direction === 1 ? 'forward' : 'reverse'}
            options={['forward', 'reverse']}
            onChange={(value) => patchConfig({ direction: value === 'forward' ? 1 : -1 })}
          />
          <label className="field field--inline">
            <span>Start running</span>
            <input
              type="checkbox"
              checked={draft.config.running}
              onChange={(event) => patchConfig({ running: event.target.checked })}
            />
          </label>
        </>
      )}

      {draft.config.kind === 'playAnimation' && (
        <>
          <div className="field">
            <span>Clips</span>
            <div className="target-list">
              {clips.length === 0 && <span className="muted">This model has no clips.</span>}
              {clips.map((clip) => {
                const checked = draft.config.kind === 'playAnimation' && draft.config.clipIds.includes(clip.id)
                return (
                  <label key={clip.id} className="chip">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        if (draft.config.kind !== 'playAnimation') return
                        const clipIds = event.target.checked
                          ? [...draft.config.clipIds, clip.id]
                          : draft.config.clipIds.filter((id) => id !== clip.id)
                        patchConfig({ clipIds })
                      }}
                    />
                    {clip.name}
                  </label>
                )
              })}
            </div>
          </div>
          <SelectField
            label="Mode"
            value={draft.config.mode}
            options={['toggle', 'openClose', 'once']}
            onChange={(mode) => patchConfig({ mode })}
          />
          <label className="field field--inline">
            <span>Loop</span>
            <input
              type="checkbox"
              checked={draft.config.loop}
              onChange={(event) => patchConfig({ loop: event.target.checked })}
            />
          </label>
        </>
      )}

      {draft.config.kind === 'toggleVisibility' && (
        <label className="field field--inline">
          <span>Hidden by default</span>
          <input
            type="checkbox"
            checked={draft.config.hiddenByDefault}
            onChange={(event) => patchConfig({ hiddenByDefault: event.target.checked })}
          />
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span>On label</span>
          <input
            className="input"
            value={draft.labels.on}
            onChange={(event) => patch({ labels: { ...draft.labels, on: event.target.value } })}
          />
        </label>
        <label className="field">
          <span>Off label</span>
          <input
            className="input"
            value={draft.labels.off}
            onChange={(event) => patch({ labels: { ...draft.labels, off: event.target.value } })}
          />
        </label>
      </div>

      <div className="editor-actions">
        <button type="button" className="button button--primary" onClick={save}>
          {existing ? 'Save' : 'Create interaction'}
        </button>
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatPoint(point: Vec3 | null): string {
  if (!point) return '—'
  return point.map((value) => value.toFixed(3)).join(', ')
}
