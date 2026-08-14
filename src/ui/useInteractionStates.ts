import { useEffect, useState } from 'react'
import type { InteractionRuntimeState } from '../engine/interaction/types'
import { useEngine } from '../state/useEngine'

function signature(states: InteractionRuntimeState[]): string {
  return states
    .map((state) =>
      [state.id, state.value.toFixed(3), state.running ? 1 : 0, state.speedDegPerSec, state.direction, state.visible ? 1 : 0].join(':'),
    )
    .join('|')
}

/** Mirrors interaction runtime state into React, rerendering only on change. */
export function useInteractionStates(active = true): Map<string, InteractionRuntimeState> {
  const engine = useEngine()
  const [states, setStates] = useState<InteractionRuntimeState[]>([])

  useEffect(() => {
    if (!active) return

    let handle = 0
    let previous = ''

    const tick = () => {
      handle = requestAnimationFrame(tick)
      const next = engine.getInteractionEngine()?.getStates() ?? []
      const nextSignature = signature(next)
      if (nextSignature !== previous) {
        previous = nextSignature
        setStates(next)
      }
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [engine, active])

  return new Map(states.map((state) => [state.id, state]))
}
