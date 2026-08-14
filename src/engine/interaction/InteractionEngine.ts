import * as THREE from 'three'
import { PivotService, type PivotBinding } from './PivotService'
import type {
  Axis,
  Easing,
  InteractionDefinition,
  InteractionRuntimeState,
  Vec3,
} from './types'

export interface AnimationBridge {
  play: (clipId: string, direction?: 1 | -1) => void
  pause: (clipId: string) => void
  stop: (clipId: string) => void
  setLoop: (clipId: string, loop: boolean) => void
  setSpeed: (clipId: string, speed: number) => void
  isPlaying: (clipId: string) => boolean
}

interface RuntimeEntry {
  definition: InteractionDefinition
  binding: PivotBinding | null
  /** Rest pose of the driver, captured when the interaction is bound. */
  base: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 } | null
  value: number
  target: number
  running: boolean
  direction: 1 | -1
  speedDegPerSec: number
  spinAngleDeg: number
  visible: boolean
  /** Ping-pong direction for looping motions. */
  loopDirection: 1 | -1
}

/**
 * Runs serializable interaction definitions against the live scene.
 * Framework-agnostic: it only needs an id -> Object3D resolver and an optional
 * bridge to the clip player, so React never touches Three.js here.
 */
export class InteractionEngine {
  private readonly pivots = new PivotService()
  private entries = new Map<string, RuntimeEntry>()
  private resolve: (id: string) => THREE.Object3D | null = () => null
  private bridge: AnimationBridge | null = null
  private listeners = new Set<() => void>()

  setResolver(resolve: (id: string) => THREE.Object3D | null): void {
    this.resolve = resolve
  }

  setAnimationBridge(bridge: AnimationBridge | null): void {
    this.bridge = bridge
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Replaces the whole set, e.g. when a project is loaded. */
  setDefinitions(definitions: InteractionDefinition[]): void {
    this.clear()
    for (const definition of definitions) this.add(definition)
  }

  add(definition: InteractionDefinition): void {
    this.remove(definition.id)

    const entry: RuntimeEntry = {
      definition,
      binding: null,
      base: null,
      value: 0,
      target: 0,
      running: definition.config.kind === 'continuousSpin' ? definition.config.running : false,
      direction: definition.config.kind === 'continuousSpin' ? definition.config.direction : 1,
      speedDegPerSec: definition.config.kind === 'continuousSpin' ? definition.config.speedDegPerSec : 0,
      spinAngleDeg: 0,
      visible: definition.config.kind === 'toggleVisibility' ? !definition.config.hiddenByDefault : true,
      loopDirection: 1,
    }

    this.entries.set(definition.id, entry)
    this.bind(entry)

    // A manual override owns the pose: park the baked clips at their rest frame.
    for (const clipId of definition.overrideClipIds ?? []) this.bridge?.stop(clipId)

    this.apply(entry)
    this.emit()
  }

  /** Edits keep the current 0..1 state so tweaking a door does not slam it shut. */
  update(definition: InteractionDefinition): void {
    const previous = this.entries.get(definition.id)
    const value = previous?.value ?? 0
    const target = previous?.target ?? 0

    this.remove(definition.id)
    this.add(definition)

    const entry = this.entries.get(definition.id)
    if (!entry) return
    entry.value = value
    entry.target = target
    this.apply(entry)
    this.emit()
  }

  remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return

    // Return the driver to its rest pose before unwrapping the proxy group.
    entry.value = 0
    entry.target = 0
    entry.spinAngleDeg = 0
    this.apply(entry)

    if (entry.definition.config.kind === 'toggleVisibility') {
      for (const object of this.targetsOf(entry.definition)) object.visible = true
    }

    this.pivots.release(id)
    this.entries.delete(id)
    this.emit()
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.remove(id)
    this.pivots.releaseAll()
    this.entries.clear()
    this.emit()
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  getDefinitions(): InteractionDefinition[] {
    return [...this.entries.values()].map((entry) => entry.definition)
  }

  getState(id: string): InteractionRuntimeState | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    return {
      id,
      value: entry.value,
      target: entry.target,
      moving: Math.abs(entry.target - entry.value) > 1e-4,
      running: entry.running,
      speedDegPerSec: entry.speedDegPerSec,
      direction: entry.direction,
      visible: entry.visible,
    }
  }

  getStates(): InteractionRuntimeState[] {
    return [...this.entries.keys()]
      .map((id) => this.getState(id))
      .filter((state): state is InteractionRuntimeState => !!state)
  }

  /**
   * The object an interaction actually drives (the pivot proxy when one exists).
   * Baking needs this so exported tracks target the same node the editor moves.
   */
  getDriver(id: string): THREE.Object3D | null {
    return this.entries.get(id)?.binding?.driver ?? null
  }

  /** Puts every interaction back at its rest pose, e.g. before exporting. */
  resetAll(): void {
    for (const id of this.entries.keys()) this.reset(id)
  }

  /** World-space pivot currently in use, for helper rendering. */
  getPivotPoint(id: string): Vec3 | null {
    const binding = this.pivots.get(id)
    return binding ? (binding.point.toArray() as Vec3) : null
  }

  // --- commands -----------------------------------------------------------

  open(id: string): void {
    this.setTarget(id, 1)
  }

  close(id: string): void {
    this.setTarget(id, 0)
  }

  toggle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return

    if (entry.definition.config.kind === 'continuousSpin') {
      this.setRunning(id, !entry.running)
      return
    }

    if (entry.definition.config.kind === 'toggleVisibility') {
      this.setVisible(id, !entry.visible)
      return
    }

    if (entry.definition.config.kind === 'playAnimation') {
      const clipIds = entry.definition.config.clipIds
      const playing = clipIds.some((clipId) => this.bridge?.isPlaying(clipId))
      for (const clipId of clipIds) {
        if (playing) this.bridge?.pause(clipId)
        else this.bridge?.play(clipId, 1)
      }
      entry.target = playing ? 0 : 1
      entry.value = entry.target
      this.emit()
      return
    }

    this.setTarget(id, entry.target >= 0.5 ? 0 : 1)
  }

  /** Jumps straight to a normalized position, used by 0-100% sliders. */
  setValue(id: string, value: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.value = THREE.MathUtils.clamp(value, 0, 1)
    entry.target = entry.value
    this.apply(entry)
    this.emit()
  }

  setTarget(id: string, target: number): void {
    const entry = this.entries.get(id)
    if (!entry) return

    const clamped = THREE.MathUtils.clamp(target, 0, 1)

    if (entry.definition.config.kind === 'playAnimation') {
      const config = entry.definition.config
      for (const clipId of config.clipIds) {
        this.bridge?.setLoop(clipId, config.mode === 'toggle' ? config.loop : false)
        this.bridge?.play(clipId, clamped >= 0.5 ? 1 : -1)
      }
      entry.target = clamped
      entry.value = clamped
      this.emit()
      return
    }

    entry.target = clamped
    this.emit()
  }

  setRunning(id: string, running: boolean): void {
    const entry = this.entries.get(id)
    if (!entry) return

    entry.running = running
    if (entry.definition.config.kind === 'playAnimation') {
      for (const clipId of entry.definition.config.clipIds) {
        if (running) this.bridge?.play(clipId, entry.direction)
        else this.bridge?.pause(clipId)
      }
    }
    this.emit()
  }

  setSpeed(id: string, speedDegPerSec: number): void {
    const entry = this.entries.get(id)
    if (!entry) return

    const max = entry.definition.config.kind === 'continuousSpin'
      ? entry.definition.config.maxSpeedDegPerSec
      : Number.POSITIVE_INFINITY
    entry.speedDegPerSec = THREE.MathUtils.clamp(speedDegPerSec, 0, max)
    this.emit()
  }

  setDirection(id: string, direction: 1 | -1): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.direction = direction
    this.emit()
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.visible = visible
    for (const object of this.targetsOf(entry.definition)) object.visible = visible
    this.emit()
  }

  /** Resets to the rest pose without removing the interaction. */
  reset(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.value = 0
    entry.target = 0
    entry.spinAngleDeg = 0
    entry.running = false
    entry.visible = true
    this.apply(entry)
    this.emit()
  }

  // --- frame loop ---------------------------------------------------------

  tick(deltaSeconds: number): void {
    let changed = false

    for (const entry of this.entries.values()) {
      const config = entry.definition.config

      if (config.kind === 'continuousSpin') {
        if (entry.running && entry.speedDegPerSec > 0) {
          entry.spinAngleDeg += entry.speedDegPerSec * entry.direction * deltaSeconds
          this.apply(entry)
          changed = true
        }
        continue
      }

      if (config.kind === 'playAnimation' || config.kind === 'toggleVisibility') continue

      const duration = Math.max(config.durationMs, 1) / 1000
      const loop = config.loop

      if (loop !== 'none' && entry.target > 0) {
        // Looping motion runs on its own; ping-pong bounces at the ends.
        entry.value += (deltaSeconds / duration) * entry.loopDirection
        if (entry.value >= 1) {
          entry.value = loop === 'pingpong' ? 1 : 0
          if (loop === 'pingpong') entry.loopDirection = -1
        } else if (entry.value <= 0) {
          entry.value = 0
          entry.loopDirection = 1
        }
        this.apply(entry)
        changed = true
        continue
      }

      if (Math.abs(entry.target - entry.value) > 1e-4) {
        const step = deltaSeconds / duration
        const delta = entry.target - entry.value
        entry.value += Math.sign(delta) * Math.min(step, Math.abs(delta))
        this.apply(entry)
        changed = true
      }
    }

    if (changed) this.emit()
  }

  dispose(): void {
    this.clear()
    this.listeners.clear()
    this.bridge = null
  }

  // --- internals ----------------------------------------------------------

  private bind(entry: RuntimeEntry): void {
    const definition = entry.definition
    const targets = this.targetsOf(definition)
    if (targets.length === 0) return

    const binding = this.pivots.bind(definition.id, targets, definition.pivot, {
      includeChildren: definition.includeChildren,
    })
    if (!binding) return

    entry.binding = binding
    entry.base = {
      position: binding.driver.position.clone(),
      quaternion: binding.driver.quaternion.clone(),
      scale: binding.driver.scale.clone(),
    }
  }

  private targetsOf(definition: InteractionDefinition): THREE.Object3D[] {
    return [definition.targetId, ...definition.extraTargetIds]
      .map((id) => this.resolve(id))
      .filter((object): object is THREE.Object3D => !!object)
  }

  /** Writes the current state onto the driver, always relative to the rest pose. */
  private apply(entry: RuntimeEntry): void {
    const binding = entry.binding
    const base = entry.base
    if (!binding || !base) return

    const driver = binding.driver
    const config = entry.definition.config

    switch (config.kind) {
      case 'rotateBetween': {
        const angle = THREE.MathUtils.degToRad(
          lerp(config.closedDeg, config.openDeg, ease(entry.value, config.easing)),
        )
        driver.quaternion.copy(base.quaternion).multiply(quaternionAbout(config.axis, angle))
        break
      }

      case 'continuousSpin': {
        driver.quaternion
          .copy(base.quaternion)
          .multiply(quaternionAbout(config.axis, THREE.MathUtils.degToRad(entry.spinAngleDeg)))
        break
      }

      case 'translateBetween': {
        const offset = lerp(config.closed, config.open, ease(entry.value, config.easing))
        driver.position.copy(base.position).add(axisVector(config.axis).multiplyScalar(offset))
        break
      }

      case 'transform': {
        const t = ease(entry.value, config.easing)
        const position = lerpVec(config.from.position, config.to.position, t)
        const rotation = lerpVec(config.from.rotationDeg, config.to.rotationDeg, t)
        const scale = lerpVec(config.from.scale, config.to.scale, t)

        driver.position.copy(base.position)
        if (position) driver.position.add(new THREE.Vector3().fromArray(position))

        driver.quaternion.copy(base.quaternion)
        if (rotation) {
          driver.quaternion.multiply(
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                THREE.MathUtils.degToRad(rotation[0]),
                THREE.MathUtils.degToRad(rotation[1]),
                THREE.MathUtils.degToRad(rotation[2]),
              ),
            ),
          )
        }

        driver.scale.copy(base.scale)
        if (scale) driver.scale.multiply(new THREE.Vector3().fromArray(scale))
        break
      }

      default:
        break
    }

    driver.updateMatrixWorld(true)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function axisVector(axis: Axis): THREE.Vector3 {
  return new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
}

function quaternionAbout(axis: Axis, angleRad: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(axisVector(axis), angleRad)
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function lerpVec(from?: Vec3, to?: Vec3, t = 0): Vec3 | null {
  if (!from && !to) return null
  const a = from ?? [0, 0, 0]
  const b = to ?? a
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

export function ease(t: number, easing: Easing): number {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  switch (easing) {
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    default:
      return x
  }
}
