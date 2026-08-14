import { useEffect, useState } from 'react'
import type { ClipPlaybackState } from '../engine/animation/AnimationManager'
import { useEngine } from '../state/useEngine'

function signature(states: ClipPlaybackState[]): string {
  return states
    .map((state) =>
      [
        state.clipId,
        state.playing ? 1 : 0,
        state.loop ? 1 : 0,
        state.direction,
        state.speed,
        // Two decimals is enough for a timeline readout and keeps React quiet.
        state.time.toFixed(2),
      ].join(':'),
    )
    .join('|')
}

/**
 * Mirrors live mixer state into React at frame rate, but only rerenders when
 * something actually changed. Panels that are not mounted cost nothing.
 */
export function useAnimationStates(active = true): ClipPlaybackState[] {
  const engine = useEngine()
  const [states, setStates] = useState<ClipPlaybackState[]>([])

  useEffect(() => {
    if (!active) return

    let handle = 0
    let previous = ''

    const tick = () => {
      handle = requestAnimationFrame(tick)
      const next = engine.getAnimations()?.getStates() ?? []
      const nextSignature = signature(next)
      if (nextSignature !== previous) {
        previous = nextSignature
        setStates(next)
      }
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [engine, active])

  return states
}
