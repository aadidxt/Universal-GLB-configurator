import { EngineProvider } from './state/EngineContext'
import { EditorLayout } from './ui/EditorLayout'
import './ui/editor.css'

export default function App() {
  return (
    <EngineProvider>
      <EditorLayout />
    </EngineProvider>
  )
}
