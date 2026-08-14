import * as THREE from 'three'
import type { ClipInfo } from './types'

export interface ClipPlaybackState {
  clipId: string
  playing: boolean
  /** True while the action exists but is paused mid-clip. */
  paused: boolean
  time: number
  duration: number
  loop: boolean
  /** Absolute playback rate; direction is reported separately. */
  speed: number
  direction: 1 | -1
  /** Clip finished in LoopOnce mode and is clamped at its end pose. */
  finished: boolean
}

/**
 * Owns the AnimationMixer and one AnimationAction per clip.
 * Lives in the engine, not in React, so it survives rerenders; every model
 * change tears the whole thing down (actions, cache, mixer) before rebuilding.
 */
export class AnimationManager {
  private mixer: THREE.AnimationMixer | null = null
  private root: THREE.Object3D | null = null
  private actions = new Map<string, THREE.AnimationAction>()
  private clips = new Map<string, THREE.AnimationClip>()
  private info = new Map<string, ClipInfo>()
  private speeds = new Map<string, number>()
  private directions = new Map<string, 1 | -1>()
  private loops = new Map<string, boolean>()
  private listeners = new Set<() => void>()

  setModel(root: THREE.Object3D | null, clips: THREE.AnimationClip[], infos: ClipInfo[]): void {
    this.dispose()
    if (!root || clips.length === 0) return

    this.root = root
    this.mixer = new THREE.AnimationMixer(root)
    this.mixer.addEventListener('finished', () => this.emit())

    clips.forEach((clip, index) => {
      const info = infos[index]
      const clipId = info?.id ?? `clip-${index}`
      const action = this.mixer!.clipAction(clip)
      action.clampWhenFinished = true
      action.enabled = true
      action.paused = true
      action.setLoop(THREE.LoopRepeat, Infinity)

      this.actions.set(clipId, action)
      this.clips.set(clipId, clip)
      if (info) this.info.set(clipId, info)
      // Cyclic clips default to looping; one-shot motions (doors) do not.
      this.loops.set(clipId, info ? info.cyclic : true)
      this.speeds.set(clipId, 1)
      this.directions.set(clipId, 1)
    })
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get hasClips(): boolean {
    return this.actions.size > 0
  }

  update(delta: number): void {
    this.mixer?.update(delta)
  }

  play(clipId: string, direction: 1 | -1 = this.directions.get(clipId) ?? 1): void {
    const action = this.actions.get(clipId)
    if (!action) return

    this.directions.set(clipId, direction)
    this.applyLoop(clipId)
    this.applyTimeScale(clipId)

    // Reversing from a clamped end pose (or forward from the start) needs the
    // playhead nudged inside the clip or the action finishes immediately.
    const duration = action.getClip().duration
    if (direction === -1 && action.time <= 0) action.time = duration
    if (direction === 1 && action.time >= duration && !this.loops.get(clipId)) action.time = 0

    action.paused = false
    action.enabled = true
    if (!action.isRunning()) action.play()
    this.emit()
  }

  pause(clipId: string): void {
    const action = this.actions.get(clipId)
    if (!action) return
    action.paused = true
    this.emit()
  }

  toggle(clipId: string): void {
    const state = this.getState(clipId)
    if (!state) return
    if (state.playing) this.pause(clipId)
    else this.play(clipId)
  }

  /** Stops and returns the object to the clip's first frame. */
  stop(clipId: string): void {
    const action = this.actions.get(clipId)
    if (!action) return
    action.stop()
    action.reset()
    action.time = 0
    action.paused = true
    action.enabled = true
    // A zero-delta update writes the reset pose back onto the scene graph.
    this.mixer?.update(0)
    this.emit()
  }

  stopAll(): void {
    for (const clipId of this.actions.keys()) this.stop(clipId)
  }

  setLoop(clipId: string, loop: boolean): void {
    this.loops.set(clipId, loop)
    this.applyLoop(clipId)
    this.emit()
  }

  setSpeed(clipId: string, speed: number): void {
    this.speeds.set(clipId, Math.max(0.01, speed))
    this.applyTimeScale(clipId)
    this.emit()
  }

  setDirection(clipId: string, direction: 1 | -1): void {
    this.directions.set(clipId, direction)
    this.applyTimeScale(clipId)
    this.emit()
  }

  /** Scrubs to an absolute time; keeps the paused/playing state intact. */
  seek(clipId: string, time: number): void {
    const action = this.actions.get(clipId)
    if (!action) return

    const duration = action.getClip().duration
    action.enabled = true
    action.time = THREE.MathUtils.clamp(time, 0, duration)
    this.mixer?.update(0)
    this.emit()
  }

  /** Normalized 0..1 scrub, used by drawer/slider style controls. */
  seekNormalized(clipId: string, value: number): void {
    const action = this.actions.get(clipId)
    if (!action) return
    this.seek(clipId, THREE.MathUtils.clamp(value, 0, 1) * action.getClip().duration)
  }

  /** Jumps to the end pose without playing — "already open" style states. */
  jumpToEnd(clipId: string): void {
    const action = this.actions.get(clipId)
    if (!action) return
    action.paused = true
    this.seek(clipId, action.getClip().duration)
  }

  getState(clipId: string): ClipPlaybackState | null {
    const action = this.actions.get(clipId)
    if (!action) return null

    const duration = action.getClip().duration
    const loop = this.loops.get(clipId) ?? true
    const direction = this.directions.get(clipId) ?? 1
    const running = action.isRunning() && !action.paused
    const finished = !loop && (direction === 1 ? action.time >= duration - 1e-4 : action.time <= 1e-4)

    return {
      clipId,
      playing: running,
      paused: action.paused && action.time > 0,
      time: action.time,
      duration,
      loop,
      speed: this.speeds.get(clipId) ?? 1,
      direction,
      finished,
    }
  }

  getStates(): ClipPlaybackState[] {
    return [...this.actions.keys()]
      .map((clipId) => this.getState(clipId))
      .filter((state): state is ClipPlaybackState => !!state)
  }

  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction()
      for (const clip of this.clips.values()) this.mixer.uncacheClip(clip)
      if (this.root) this.mixer.uncacheRoot(this.root)
    }
    this.mixer = null
    this.root = null
    this.actions.clear()
    this.clips.clear()
    this.info.clear()
    this.speeds.clear()
    this.directions.clear()
    this.loops.clear()
    this.emit()
  }

  private applyLoop(clipId: string): void {
    const action = this.actions.get(clipId)
    if (!action) return
    const loop = this.loops.get(clipId) ?? true
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    action.clampWhenFinished = true
  }

  private applyTimeScale(clipId: string): void {
    const action = this.actions.get(clipId)
    if (!action) return
    action.timeScale = (this.speeds.get(clipId) ?? 1) * (this.directions.get(clipId) ?? 1)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
