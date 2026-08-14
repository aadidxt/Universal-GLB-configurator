/**
 * Classic command pattern. Commands hold closures, so they live only in memory —
 * persisted project data stores the resulting state, never the commands.
 */
export interface Command {
  label: string
  execute: () => void
  undo: () => void
  /** Optional merge key: consecutive commands with the same key collapse. */
  mergeKey?: string
}

export interface HistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  depth: number
}

export class CommandHistory {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private listeners = new Set<(snapshot: HistorySnapshot) => void>()
  private readonly limit: number
  /** Guards against commands re-entering the history while they replay. */
  private applying = false

  constructor(limit = 200) {
    this.limit = limit
  }

  onChange(listener: (snapshot: HistorySnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Runs a command and records it. */
  execute(command: Command): void {
    if (this.applying) {
      command.execute()
      return
    }

    this.applying = true
    try {
      command.execute()
    } finally {
      this.applying = false
    }

    const previous = this.undoStack[this.undoStack.length - 1]
    if (command.mergeKey && previous?.mergeKey === command.mergeKey) {
      // Keep the older undo (the true "before" state) and the newer redo.
      this.undoStack[this.undoStack.length - 1] = {
        label: command.label,
        mergeKey: command.mergeKey,
        execute: command.execute,
        undo: previous.undo,
      }
    } else {
      this.undoStack.push(command)
      if (this.undoStack.length > this.limit) this.undoStack.shift()
    }

    this.redoStack = []
    this.emit()
  }

  undo(): boolean {
    const command = this.undoStack.pop()
    if (!command) return false

    this.applying = true
    try {
      command.undo()
    } finally {
      this.applying = false
    }

    this.redoStack.push(command)
    this.emit()
    return true
  }

  redo(): boolean {
    const command = this.redoStack.pop()
    if (!command) return false

    this.applying = true
    try {
      command.execute()
    } finally {
      this.applying = false
    }

    this.undoStack.push(command)
    this.emit()
    return true
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.emit()
  }

  snapshot(): HistorySnapshot {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
      depth: this.undoStack.length,
    }
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
