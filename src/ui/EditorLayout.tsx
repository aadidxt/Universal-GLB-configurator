import { BottomPanel } from './BottomPanel'
import { Inspector } from './Inspector'
import { Outliner } from './Outliner'
import { Toolbar } from './Toolbar'
import { Viewport3D } from './Viewport3D'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useAutosave } from './useAutosave'

export function EditorLayout() {
  useKeyboardShortcuts()
  useAutosave()

  return (
    <div className="editor">
      <Toolbar />
      <div className="editor-main">
        <Outliner />
        <Viewport3D />
        <Inspector />
      </div>
      <BottomPanel />
    </div>
  )
}
