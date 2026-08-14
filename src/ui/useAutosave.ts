import { useEffect, useRef } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'

const DEBOUNCE_MS = 900

/**
 * Debounced autosave. Any change that belongs in a project file marks the
 * session dirty; the write itself happens once the user stops fiddling.
 */
export function useAutosave(): void {
  const engine = useEngine()
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (!state.model || !state.modelHash) return

      const changed =
        state.interactions !== previous.interactions ||
        state.semanticOverrides !== previous.semanticOverrides ||
        state.manifest !== previous.manifest ||
        state.gridVisible !== previous.gridVisible ||
        state.transformMode !== previous.transformMode ||
        state.transformSpace !== previous.transformSpace ||
        state.snapTranslation !== previous.snapTranslation ||
        state.snapRotationDeg !== previous.snapRotationDeg ||
        state.materialScope !== previous.materialScope

      if (!changed) return
      // A fresh import already reflects whatever was restored.
      if (state.model !== previous.model) return

      if (state.saveState !== 'dirty' && state.saveState !== 'saving') {
        useEditorStore.getState().setSaveState('dirty')
      }
      if (!state.autosave) return

      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        void engine.saveProject()
      }, DEBOUNCE_MS)
    })

    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      unsubscribe()
    }
  }, [engine])
}
