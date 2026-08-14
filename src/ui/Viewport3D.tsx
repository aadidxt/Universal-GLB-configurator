import { useEffect, useRef, useState } from 'react'
import { useEngine } from '../state/useEngine'
import { useEditorStore } from '../state/editorStore'

export function Viewport3D() {
  const engine = useEngine()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Drag events fire per-child; a counter avoids flicker on nested enters/leaves.
  const dragDepth = useRef(0)
  const [isDragOver, setIsDragOver] = useState(false)

  const loadState = useEditorStore((state) => state.loadState)
  const model = useEditorStore((state) => state.model)
  const error = useEditorStore((state) => state.error)
  const clearError = useEditorStore((state) => state.clearError)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    return engine.mount(container)
  }, [engine])

  const openPicker = () => fileInputRef.current?.click()

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    void engine.loadFile(file)
  }

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragEnter = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepth.current += 1
    setIsDragOver(true)
  }

  const onDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragOver(false)
  }

  // Pointer picking: only treat it as a click when the pointer barely moved,
  // otherwise every orbit drag would clear or change the selection.
  const pointerDown = useRef<{ x: number; y: number; button: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent) => {
    pointerDown.current = { x: event.clientX, y: event.clientY, button: event.button }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const start = pointerDown.current
    pointerDown.current = null
    if (!start || start.button !== 0 || event.button !== 0) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
    if (engine.getEngine()?.transforms.isDragging) return

    const rect = event.currentTarget.getBoundingClientRect()
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
    engine.pickAt(ndcX, ndcY, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey })
  }

  const onDoubleClick = () => {
    engine.focusSelected()
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragOver(false)
    handleFiles(event.dataTransfer.files)
  }

  const showDropTarget = !model

  return (
    <div
      className="viewport"
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div ref={containerRef} className="viewport-canvas" />

      {isDragOver && !showDropTarget && <div className="viewport-drag-hint">Drop to replace model</div>}

      {showDropTarget && (
        <div className={`dropzone${isDragOver ? ' dropzone--active' : ''}`}>
          <div className="dropzone-inner">
            <div className="dropzone-icon" aria-hidden>
              ⬡
            </div>
            <h2>Drop a .glb file here</h2>
            <p>The model is loaded entirely in your browser. Nothing is uploaded.</p>
            <button type="button" className="button button--primary" onClick={openPicker}>
              Open GLB
            </button>
          </div>
        </div>
      )}

      {loadState === 'loading' && (
        <div className="viewport-status">
          <span className="spinner" aria-hidden /> Loading model…
        </div>
      )}

      {error && (
        <div className="viewport-error" role="alert">
          <span className="viewport-error-icon" aria-hidden>
            !
          </span>
          <span className="viewport-error-text">{error}</span>
          <button type="button" className="button button--ghost" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="hidden-input"
        onChange={(event) => {
          handleFiles(event.target.files)
          // Allow re-picking the same file back to back.
          event.target.value = ''
        }}
      />
    </div>
  )
}
