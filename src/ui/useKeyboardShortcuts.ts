import { useEffect } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'

/** Editor-wide shortcuts. Ignored while the user is typing in a field. */
export function useKeyboardShortcuts(): void {
  const engine = useEngine()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      // Undo/redo stay available while a slider or colour swatch has focus;
      // only real text entry keeps its native undo.
      if (event.ctrlKey || event.metaKey) {
        if (isTextEntry(target)) return
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) {
          engine.undo()
          event.preventDefault()
        } else if ((key === 'z' && event.shiftKey) || key === 'y') {
          engine.redo()
          event.preventDefault()
        }
        return
      }

      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return
      if (event.altKey) return

      const store = useEditorStore.getState()

      switch (event.key.toLowerCase()) {
        case 'w':
          store.setTransformMode('translate')
          break
        case 'e':
          store.setTransformMode('rotate')
          break
        case 'r':
          store.setTransformMode('scale')
          break
        case 'x':
          store.setTransformSpace(store.transformSpace === 'world' ? 'local' : 'world')
          break
        case 'q':
          store.setGizmoEnabled(!store.gizmoEnabled)
          break
        case 'f':
          engine.focusSelected()
          break
        case 'a':
          engine.frameModel()
          break
        case 'escape':
          engine.select(null)
          break
        default:
          return
      }

      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [engine])
}

/** True for fields where the browser's own undo should win. */
function isTextEntry(target: HTMLElement | null): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  if (target.tagName.toLowerCase() === 'textarea') return true
  if (target.tagName.toLowerCase() !== 'input') return false

  const type = (target as HTMLInputElement).type
  return ['text', 'search', 'number', 'email', 'url', 'password', 'tel'].includes(type)
}
