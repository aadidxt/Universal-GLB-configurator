import { useMemo, useState } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'
import { useAnimationStates } from './useAnimationStates'
import { CATEGORY_LABELS, type CapabilityEntry, type ConfiguratorCategory, type Interaction } from '../engine/capability/types'
import type { ClipPlaybackState } from '../engine/animation/AnimationManager'
import { SEMANTIC_LABELS, type SemanticType } from '../engine/semantic/types'
import { useInteractionStates } from './useInteractionStates'
import type { InteractionDefinition, InteractionRuntimeState } from '../engine/interaction/types'

const SPEEDS = [0.25, 0.5, 1, 2]
/** One-click swing amounts; anything else goes in the editor. */
const QUICK_ANGLES = [45, 60, 90, 105, 120, 180]
const CATEGORY_ORDER: ConfiguratorCategory[] = ['doors', 'cooling', 'drawers', 'switches', 'other']

/**
 * Generated controls only. The Outliner keeps showing every node; this panel
 * lists just the parts with real interactions or strong semantic candidates.
 */
export function ConfiguratorPanel() {
  const capabilities = useEditorStore((state) => state.capabilities)
  const interactions = useEditorStore((state) => state.interactions)
  const overrides = useEditorStore((state) => state.semanticOverrides)
  const states = useAnimationStates()
  const interactionStates = useInteractionStates()
  const stateByClip = useMemo(() => new Map(states.map((state) => [state.clipId, state])), [states])

  // Manual interactions are grouped by their own semantic, next to detected parts.
  const manualByCategory = useMemo(() => {
    const map = new Map<ConfiguratorCategory, InteractionDefinition[]>()
    for (const interaction of interactions) {
      const category = categoryOf(interaction.semantic)
      map.set(category, [...(map.get(category) ?? []), interaction])
    }
    return map
  }, [interactions])

  const detectedByCategory = useMemo(() => {
    const map = new Map<ConfiguratorCategory, string[]>()
    for (const category of CATEGORY_ORDER) {
      const ids = capabilities.categories[category].filter((id) => {
        if (overrides[id]?.status === 'ignored') return false
        // A part with a manual interaction is presented through that card.
        return !interactions.some((entry) => entry.targetId === id)
      })
      map.set(category, ids)
    }
    return map
  }, [capabilities, interactions, overrides])

  const populated = CATEGORY_ORDER.filter(
    (category) => (detectedByCategory.get(category)?.length ?? 0) > 0 || (manualByCategory.get(category)?.length ?? 0) > 0,
  )

  if (populated.length === 0) {
    return (
      <p className="placeholder">
        Nothing configured yet. Select any object and use Add Interaction in the Inspector — detected parts appear
        here automatically.
      </p>
    )
  }

  return (
    <div className="configurator">
      {populated.map((category) => {
        const manual = manualByCategory.get(category) ?? []
        const detected = detectedByCategory.get(category) ?? []
        return (
          <section key={category} className="config-category">
            <h3 className="config-category-title">
              {CATEGORY_LABELS[category]}
              <span className="panel-count">{manual.length + detected.length}</span>
            </h3>
            <div className="config-cards">
              {manual.map((interaction) => (
                <ManualCard key={interaction.id} interaction={interaction} state={interactionStates.get(interaction.id)} />
              ))}
              {detected.map((id) => (
                <ComponentCard key={id} entry={capabilities.entries[id]} stateByClip={stateByClip} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function categoryOf(semantic: SemanticType): ConfiguratorCategory {
  switch (semantic) {
    case 'door':
      return 'doors'
    case 'fan':
    case 'rotating':
      return 'cooling'
    case 'drawer':
      return 'drawers'
    case 'switch':
      return 'switches'
    default:
      return 'other'
  }
}

/** Controls generated from a user-authored interaction definition. */
function ManualCard({
  interaction,
  state,
}: {
  interaction: InteractionDefinition
  state?: InteractionRuntimeState
}) {
  const engine = useEngine()
  const primaryId = useEditorStore((store) => store.primaryId)
  const value = state?.value ?? 0
  const running = state?.running ?? false
  const config = interaction.config

  return (
    <article className={`config-card config-card--manual${primaryId === interaction.targetId ? ' config-card--active' : ''}`}>
      <header className="config-card-head">
        <button
          type="button"
          className="config-card-title"
          onClick={() => {
            engine.select(interaction.targetId)
            engine.focusObject(interaction.targetId)
          }}
        >
          {interaction.name}
        </button>
        <span className="confidence confidence--manual">manual · {interaction.preset}</span>
      </header>

      {(config.kind === 'rotateBetween' || config.kind === 'translateBetween' || config.kind === 'transform') && (
        <>
          <div className="control-row">
            <span className="control-label">{interaction.labels.on} / {interaction.labels.off}</span>
            <button type="button" className="button" onClick={() => engine.openInteraction(interaction.id)}>
              {interaction.labels.on}
            </button>
            <button type="button" className="button" onClick={() => engine.closeInteraction(interaction.id)}>
              {interaction.labels.off}
            </button>
            <button
              type="button"
              className="button"
              title="Snap straight back to the rest position"
              onClick={() => engine.resetInteraction(interaction.id)}
            >
              Return to normal
            </button>
            <span className="muted">{Math.round(value * 100)}%</span>
          </div>

          {config.kind === 'rotateBetween' && (
            <>
              <div className="control-row">
                <span className="control-label">Angle</span>
                <div className="segmented segmented--small">
                  {QUICK_ANGLES.map((angle) => (
                    <button
                      key={angle}
                      type="button"
                      className={`segment${Math.abs(Math.abs(config.openDeg) - angle) < 0.5 ? ' segment--active' : ''}`}
                      onClick={() => engine.setInteractionAngle(interaction.id, angle)}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>
                <input
                  className="input input--tiny"
                  type="number"
                  step={5}
                  value={Math.round(Math.abs(config.openDeg))}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next)) engine.setInteractionAngle(interaction.id, next)
                  }}
                />
              </div>
              <div className="control-row">
                <span className="control-label">Direction</span>
                <button
                  type="button"
                  className="button"
                  title="Swing the other way (inward becomes outward)"
                  onClick={() => engine.flipInteraction(interaction.id)}
                >
                  ⇄ Flip direction
                </button>
                <span className="muted">
                  axis {config.axis} · {config.openDeg > 0 ? '+' : ''}
                  {Math.round(config.openDeg)}°
                </span>
              </div>
            </>
          )}

          {config.kind === 'translateBetween' && (
            <div className="control-row">
              <span className="control-label">Direction</span>
              <button type="button" className="button" onClick={() => engine.flipInteraction(interaction.id)}>
                ⇄ Flip direction
              </button>
              <span className="muted">
                axis {config.axis} · {config.open > 0 ? '+' : ''}
                {config.open.toFixed(3)}
              </span>
            </div>
          )}
          <div className="control-row">
            <span className="control-label">Position</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={value}
              onChange={(event) => engine.setInteractionValue(interaction.id, Number(event.target.value))}
            />
          </div>
        </>
      )}

      {config.kind === 'continuousSpin' && (
        <>
          <div className="control-row">
            <span className="control-label">{interaction.labels.on} / {interaction.labels.off}</span>
            <button
              type="button"
              className={`button${running ? ' button--primary' : ''}`}
              onClick={() => engine.setInteractionRunning(interaction.id, !running)}
            >
              {running ? interaction.labels.on : interaction.labels.off}
            </button>
            <button type="button" className="button" onClick={() => engine.resetInteraction(interaction.id)}>
              Reset
            </button>
          </div>
          <div className="control-row">
            <span className="control-label">Speed °/s</span>
            <input
              type="range"
              min={0}
              max={config.maxSpeedDegPerSec}
              step={10}
              value={state?.speedDegPerSec ?? config.speedDegPerSec}
              onChange={(event) => engine.setInteractionSpeed(interaction.id, Number(event.target.value))}
            />
            <code>{Math.round(state?.speedDegPerSec ?? config.speedDegPerSec)}</code>
          </div>
          <div className="control-row">
            <span className="control-label">Direction</span>
            <div className="segmented segmented--small">
              <button
                type="button"
                className={`segment${(state?.direction ?? 1) === 1 ? ' segment--active' : ''}`}
                onClick={() => engine.setInteractionDirection(interaction.id, 1)}
              >
                Forward
              </button>
              <button
                type="button"
                className={`segment${(state?.direction ?? 1) === -1 ? ' segment--active' : ''}`}
                onClick={() => engine.setInteractionDirection(interaction.id, -1)}
              >
                Reverse
              </button>
            </div>
          </div>
        </>
      )}

      {config.kind === 'toggleVisibility' && (
        <div className="control-row">
          <span className="control-label">{interaction.labels.on} / {interaction.labels.off}</span>
          <button type="button" className="button" onClick={() => engine.toggleInteraction(interaction.id)}>
            {state?.visible === false ? interaction.labels.on : interaction.labels.off}
          </button>
        </div>
      )}

      {config.kind === 'playAnimation' && (
        <div className="control-row">
          <span className="control-label">{interaction.labels.on} / {interaction.labels.off}</span>
          <button type="button" className="button" onClick={() => engine.toggleInteraction(interaction.id)}>
            {interaction.labels.on}
          </button>
          <button type="button" className="button" onClick={() => engine.resetInteraction(interaction.id)}>
            {interaction.labels.off}
          </button>
          <span className="muted">{config.clipIds.length} clip(s)</span>
        </div>
      )}
    </article>
  )
}

function ComponentCard({
  entry,
  stateByClip,
}: {
  entry: CapabilityEntry
  stateByClip: Map<string, ClipPlaybackState>
}) {
  const engine = useEngine()
  const primaryId = useEditorStore((state) => state.primaryId)

  return (
    <article className={`config-card${primaryId === entry.id ? ' config-card--active' : ''}`}>
      <header className="config-card-head">
        <button
          type="button"
          className="config-card-title"
          onClick={() => {
            engine.select(entry.id)
            engine.focusObject(entry.id)
          }}
          title="Select and focus this object"
        >
          {entry.name}
        </button>
        <span className={`confidence confidence--${confidenceBand(entry.confidence)}`}>
          {SEMANTIC_LABELS[entry.semantic]} · {Math.round(entry.confidence * 100)}%
        </span>
      </header>

      {entry.reasons.length > 0 && (
        <ul className="reasons">
          {entry.reasons.slice(0, 3).map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}

      {!entry.operable ? (
        <SuggestionActions entry={entry} />
      ) : (
        <div className="config-controls">
          {entry.interactions.map((interaction, index) => (
            <InteractionControl
              key={`${interaction.kind}-${interaction.clipId}-${index}`}
              interaction={interaction}
              state={stateByClip.get(interaction.clipId)}
            />
          ))}

          <div className="control-row">
            <span className="control-label">Wrong direction?</span>
            <button
              type="button"
              className="button"
              title="Replace the baked clip with an editable rotation you control"
              onClick={() => engine.overrideAnimation(entry.id)}
            >
              Take manual control
            </button>
          </div>
        </div>
      )}
    </article>
  )
}


const SUGGESTION_TYPES: SemanticType[] = ['door', 'fan', 'drawer', 'switch', 'rotating']

/**
 * Lower-confidence candidates from Phase 3. Accepting one creates a real,
 * serializable interaction; ignoring hides it. Manual setup is always available
 * regardless of what detection concluded.
 */
function SuggestionActions({ entry }: { entry: CapabilityEntry }) {
  const engine = useEngine()
  const override = useEditorStore((state) => state.semanticOverrides[entry.id])
  const [type, setType] = useState<SemanticType>(entry.semantic === 'unknown' ? 'door' : entry.semantic)

  if (override?.status === 'accepted') {
    return <p className="muted">Accepted as {SEMANTIC_LABELS[override.type]} — controls are in this category.</p>
  }

  return (
    <div className="suggestion">
      <p className="candidate-note">
        Suggested: {SEMANTIC_LABELS[entry.semantic]} ({Math.round(entry.confidence * 100)}%) — no animation data, so
        this is a candidate only.
      </p>
      <div className="control-row">
        <select className="input" value={type} onChange={(event) => setType(event.target.value as SemanticType)}>
          {SUGGESTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {SEMANTIC_LABELS[option]}
            </option>
          ))}
        </select>
        <button type="button" className="button button--primary" onClick={() => engine.acceptSuggestion(entry.id, type)}>
          Accept
        </button>
        <button type="button" className="button" onClick={() => engine.ignoreSuggestion(entry.id)}>
          Ignore
        </button>
        <button
          type="button"
          className="button"
          title="Select the object and open the Inspector to configure it by hand"
          onClick={() => {
            engine.select(entry.id)
            engine.focusObject(entry.id)
          }}
        >
          Configure manually
        </button>
      </div>
    </div>
  )
}

function InteractionControl({
  interaction,
  state,
}: {
  interaction: Interaction
  state?: ClipPlaybackState
}) {
  const engine = useEngine()
  const duration = state?.duration ?? interaction.duration
  const time = state?.time ?? 0
  const playing = state?.playing ?? false
  const speed = state?.speed ?? 1
  const direction = state?.direction ?? 1

  switch (interaction.kind) {
    case 'open-close':
      return (
        <div className="control-row">
          <span className="control-label">{interaction.label}</span>
          <button type="button" className="button" onClick={() => engine.openWithClip(interaction.clipId)}>
            Open
          </button>
          <button type="button" className="button" onClick={() => engine.closeWithClip(interaction.clipId)}>
            Close
          </button>
          <button
            type="button"
            className="button"
            title="Jump straight back to the closed pose"
            onClick={() => engine.stopClip(interaction.clipId)}
          >
            Reset
          </button>
          <span className="muted">{describeOpenState(time, duration, playing)}</span>
        </div>
      )

    case 'toggle-loop':
      return (
        <div className="control-row">
          <span className="control-label">{interaction.label}</span>
          <button
            type="button"
            className={`button${playing ? ' button--primary' : ''}`}
            onClick={() => {
              if (playing) {
                engine.pauseClip(interaction.clipId)
              } else {
                engine.setClipLoop(interaction.clipId, true)
                engine.playClip(interaction.clipId)
              }
            }}
          >
            {playing ? 'On' : 'Off'}
          </button>
          <button type="button" className="button" onClick={() => engine.stopClip(interaction.clipId)}>
            Reset
          </button>
        </div>
      )

    case 'speed':
      return (
        <div className="control-row">
          <span className="control-label">Speed</span>
          <div className="segmented segmented--small">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                className={`segment${Math.abs(speed - value) < 1e-6 ? ' segment--active' : ''}`}
                onClick={() => engine.setClipSpeed(interaction.clipId, value)}
              >
                {value}x
              </button>
            ))}
          </div>
        </div>
      )

    case 'direction':
      return (
        <div className="control-row">
          <span className="control-label">Direction</span>
          <div className="segmented segmented--small">
            <button
              type="button"
              className={`segment${direction === 1 ? ' segment--active' : ''}`}
              onClick={() => engine.setClipDirection(interaction.clipId, 1)}
            >
              Forward
            </button>
            <button
              type="button"
              className={`segment${direction === -1 ? ' segment--active' : ''}`}
              onClick={() => engine.setClipDirection(interaction.clipId, -1)}
            >
              Reverse
            </button>
          </div>
        </div>
      )

    case 'scrub':
      return (
        <div className="control-row">
          <span className="control-label">{interaction.label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={duration > 0 ? Math.min(time / duration, 1) : 0}
            onChange={(event) => engine.seekClipNormalized(interaction.clipId, Number(event.target.value))}
          />
          <code>{duration > 0 ? `${Math.round((time / duration) * 100)}%` : '—'}</code>
        </div>
      )

    case 'trigger':
      return (
        <div className="control-row">
          <span className="control-label">{interaction.label}</span>
          <button type="button" className="button" onClick={() => engine.triggerClip(interaction.clipId)}>
            Actuate
          </button>
          <button type="button" className="button" onClick={() => engine.stopClip(interaction.clipId)}>
            Reset
          </button>
        </div>
      )

    default:
      return (
        <div className="control-row">
          <span className="control-label">{interaction.label}</span>
          <button type="button" className="button" onClick={() => engine.toggleClip(interaction.clipId)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="button" onClick={() => engine.stopClip(interaction.clipId)}>
            Stop
          </button>
          <span className="muted">
            {time.toFixed(2)} / {duration.toFixed(2)}s
          </span>
        </div>
      )
  }
}

function describeOpenState(time: number, duration: number, playing: boolean): string {
  if (playing) return 'moving…'
  if (duration <= 0) return ''
  if (time <= 1e-3) return 'closed'
  if (time >= duration - 1e-3) return 'open'
  return `${Math.round((time / duration) * 100)}% open`
}

function confidenceBand(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.7) return 'high'
  if (confidence >= 0.4) return 'medium'
  return 'low'
}
