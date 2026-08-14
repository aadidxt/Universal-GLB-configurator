import { useMemo } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'
import { useAnimationStates } from './useAnimationStates'
import type { ClipInfo } from '../engine/animation/types'

const SPEEDS = [0.25, 0.5, 1, 2]

export function AnimationsPanel() {
  const engine = useEngine()
  const capabilities = useEditorStore((state) => state.capabilities)
  const states = useAnimationStates()
  const clips = capabilities.animation.clips

  const stateByClip = useMemo(() => new Map(states.map((state) => [state.clipId, state])), [states])

  if (clips.length === 0) {
    return <p className="placeholder">This model contains no animation clips.</p>
  }

  return (
    <div className="animations-panel">
      <div className="animations-toolbar">
        <span className="muted">
          {clips.length} clip{clips.length === 1 ? '' : 's'}
        </span>
        <button type="button" className="button" onClick={engine.stopAllClips}>
          Stop all
        </button>
      </div>

      <div className="clip-list">
        {clips.map((clip) => (
          <ClipRow key={clip.id} clip={clip} state={stateByClip.get(clip.id)} />
        ))}
      </div>
    </div>
  )
}

function ClipRow({ clip, state }: { clip: ClipInfo; state?: { playing: boolean; time: number; duration: number; loop: boolean; speed: number; direction: 1 | -1 } }) {
  const engine = useEngine()
  const capabilities = useEditorStore((state) => state.capabilities)
  const manifest = useEditorStore((state) => state.manifest)

  const playing = state?.playing ?? false
  const time = state?.time ?? 0
  const duration = state?.duration ?? clip.duration
  const loop = state?.loop ?? clip.cyclic
  const speed = state?.speed ?? 1

  const targets = clip.objectIds.map((id) => ({
    id,
    name: manifest.nodes[id]?.name ?? capabilities.entries[id]?.name ?? id,
    properties: capabilities.entries[id]?.animatedProperties ?? [],
  }))

  return (
    <div className={`clip-card${playing ? ' clip-card--playing' : ''}`}>
      <div className="clip-head">
        <span className="clip-name" title={clip.name}>
          {clip.name}
        </span>
        <span className="muted">
          {clip.duration.toFixed(2)}s · {clip.trackCount} tracks · {clip.objectIds.length} objects
          {clip.cyclic ? ' · cyclic' : ''}
          {clip.unresolvedTracks > 0 ? ` · ${clip.unresolvedTracks} unresolved` : ''}
        </span>
      </div>

      <div className="clip-controls">
        <button type="button" className="button" onClick={() => engine.toggleClip(clip.id)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="button" onClick={() => engine.stopClip(clip.id)}>
          Stop
        </button>
        <label className="toggle">
          <input type="checkbox" checked={loop} onChange={(event) => engine.setClipLoop(clip.id, event.target.checked)} />
          Loop
        </label>
        <div className="segmented segmented--small">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={`segment${Math.abs(speed - value) < 1e-6 ? ' segment--active' : ''}`}
              onClick={() => engine.setClipSpeed(clip.id, value)}
            >
              {value}x
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button"
          title="Play the clip backwards"
          onClick={() => engine.playClip(clip.id, -1)}
        >
          ◀ Reverse
        </button>
      </div>

      <div className="clip-timeline">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.01}
          value={Math.min(time, duration)}
          onChange={(event) => engine.seekClip(clip.id, Number(event.target.value))}
        />
        <code>
          {time.toFixed(2)} / {duration.toFixed(2)}s
        </code>
      </div>

      <div className="clip-targets">
        {targets.length === 0 ? (
          <span className="muted">No track targets could be resolved in this scene.</span>
        ) : (
          targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className="chip chip--button"
              title={`Select and focus ${target.name}`}
              onClick={() => {
                engine.select(target.id)
                engine.focusObject(target.id)
              }}
            >
              {target.name}
              <span className="chip-sub">{target.properties.join(', ')}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
