import { describe, expect, it } from 'vitest'
import { CommandHistory } from '../commands/CommandHistory'

function counterCommand(state: { value: number }, delta: number, label = 'add') {
  return {
    label,
    execute: () => {
      state.value += delta
    },
    undo: () => {
      state.value -= delta
    },
  }
}

describe('CommandHistory', () => {
  it('executes, undoes and redoes in order', () => {
    const state = { value: 0 }
    const history = new CommandHistory()

    history.execute(counterCommand(state, 1))
    history.execute(counterCommand(state, 10))
    expect(state.value).toBe(11)

    history.undo()
    expect(state.value).toBe(1)
    history.undo()
    expect(state.value).toBe(0)

    history.redo()
    history.redo()
    expect(state.value).toBe(11)
  })

  it('reports what undo/redo would do', () => {
    const state = { value: 0 }
    const history = new CommandHistory()

    expect(history.snapshot()).toMatchObject({ canUndo: false, canRedo: false, undoLabel: null })

    history.execute(counterCommand(state, 1, 'Add door'))
    expect(history.snapshot()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Add door', depth: 1 })

    history.undo()
    expect(history.snapshot()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Add door' })
  })

  it('a new command clears the redo branch', () => {
    const state = { value: 0 }
    const history = new CommandHistory()

    history.execute(counterCommand(state, 1))
    history.undo()
    history.execute(counterCommand(state, 5))

    expect(history.snapshot().canRedo).toBe(false)
    expect(state.value).toBe(5)
  })

  it('merges consecutive commands that share a merge key', () => {
    const state = { value: 0 }
    const history = new CommandHistory()

    history.execute({ ...counterCommand(state, 1, 'Colour'), mergeKey: 'color' })
    history.execute({ ...counterCommand(state, 1, 'Colour'), mergeKey: 'color' })
    history.execute({ ...counterCommand(state, 1, 'Colour'), mergeKey: 'color' })

    expect(state.value).toBe(3)
    expect(history.snapshot().depth).toBe(1)

    history.undo()
    // Undo rewinds to before the whole drag, not one step of it.
    expect(state.value).toBe(2)
  })

  it('does not merge across a different command', () => {
    const state = { value: 0 }
    const history = new CommandHistory()

    history.execute({ ...counterCommand(state, 1), mergeKey: 'a' })
    history.execute(counterCommand(state, 100, 'other'))
    history.execute({ ...counterCommand(state, 1), mergeKey: 'a' })

    expect(history.snapshot().depth).toBe(3)
  })

  it('undo/redo on an empty history is a no-op', () => {
    const history = new CommandHistory()

    expect(history.undo()).toBe(false)
    expect(history.redo()).toBe(false)
  })

  it('notifies listeners on every change', () => {
    const state = { value: 0 }
    const history = new CommandHistory()
    let calls = 0
    const unsubscribe = history.onChange(() => (calls += 1))

    history.execute(counterCommand(state, 1))
    history.undo()
    history.redo()
    unsubscribe()
    history.undo()

    expect(calls).toBe(3)
  })

  it('respects the stack limit', () => {
    const state = { value: 0 }
    const history = new CommandHistory(3)

    for (let i = 0; i < 5; i++) history.execute(counterCommand(state, 1))

    expect(history.snapshot().depth).toBe(3)
  })

  it('clear() empties both stacks', () => {
    const state = { value: 0 }
    const history = new CommandHistory()

    history.execute(counterCommand(state, 1))
    history.undo()
    history.clear()

    expect(history.snapshot()).toMatchObject({ canUndo: false, canRedo: false })
  })
})
