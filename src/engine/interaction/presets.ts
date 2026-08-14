import type { SemanticType } from '../semantic/types'
import type { ObjectAnimationCapability } from '../animation/types'
import type { Axis, InteractionDefinition, InteractionPreset, PivotSpec } from './types'

export interface PresetInfo {
  id: InteractionPreset
  label: string
  description: string
  semantic: SemanticType
}

export const PRESETS: PresetInfo[] = [
  { id: 'door', label: 'Door', description: 'Hinged swing between a closed and open angle', semantic: 'door' },
  { id: 'fan', label: 'Fan / Spin', description: 'Continuous rotation with on/off and speed', semantic: 'fan' },
  { id: 'drawer', label: 'Drawer / Slider', description: 'Linear travel with open/close and 0-100%', semantic: 'drawer' },
  { id: 'button', label: 'Button / Switch', description: 'Short push that springs back', semantic: 'switch' },
  { id: 'lever', label: 'Lever', description: 'Short throw rotation between two states', semantic: 'switch' },
  { id: 'genericRotation', label: 'Generic Rotation', description: 'Any axis, any angle range', semantic: 'rotating' },
  { id: 'genericTranslation', label: 'Generic Translation', description: 'Any axis, any distance', semantic: 'animated' },
  { id: 'existingAnimation', label: 'Existing Animation', description: 'Bind a control to discovered clips', semantic: 'animated' },
  { id: 'visibility', label: 'Show / Hide', description: 'Toggle visibility of the target', semantic: 'animated' },
]

export interface PresetContext {
  targetId: string
  name: string
  includeChildren?: boolean
  /** Largest bounding-box extent, used to size default drawer travel. */
  extent?: [number, number, number]
  /** Clip ids offered to the existingAnimation preset. */
  clipIds?: string[]
  /** Axis suggested by Phase 3 analysis. */
  suggestedAxis?: Axis
  pivot?: PivotSpec
}

let counter = 0

/** Stable-enough id without pulling in a uuid dependency. */
export function createInteractionId(seed = 'ix'): string {
  counter += 1
  return `${seed}-${counter.toString(36)}-${Math.floor(performance.now() % 1e6).toString(36)}`
}

/**
 * Sensible starting values per preset. Everything here is editable afterwards;
 * the point is that a user can add a working door in two clicks.
 */
export function createInteractionFromPreset(preset: InteractionPreset, context: PresetContext): InteractionDefinition {
  const base = {
    id: createInteractionId(preset),
    name: `${labelFor(preset)} — ${context.name}`,
    preset,
    targetId: context.targetId,
    extraTargetIds: [] as string[],
    includeChildren: context.includeChildren ?? true,
    pivot: context.pivot ?? ({ mode: 'original' } as PivotSpec),
    createdFrom: 'manual' as const,
  }

  const axis = context.suggestedAxis ?? 'y'
  const travel = defaultTravel(context.extent, axis)

  switch (preset) {
    case 'door':
      return {
        ...base,
        semantic: 'door',
        // A hinge on the panel edge is what makes a door look right.
        pivot: context.pivot ?? { mode: 'left' },
        labels: { on: 'Open', off: 'Close' },
        config: { kind: 'rotateBetween', axis, closedDeg: 0, openDeg: 105, durationMs: 900, easing: 'easeInOut', loop: 'none' },
      }

    case 'fan':
      return {
        ...base,
        semantic: 'fan',
        pivot: context.pivot ?? { mode: 'center' },
        labels: { on: 'On', off: 'Off' },
        config: {
          kind: 'continuousSpin',
          axis: context.suggestedAxis ?? 'z',
          speedDegPerSec: 360,
          maxSpeedDegPerSec: 1800,
          direction: 1,
          running: false,
        },
      }

    case 'drawer':
      return {
        ...base,
        semantic: 'drawer',
        labels: { on: 'Open', off: 'Close' },
        config: {
          kind: 'translateBetween',
          axis: context.suggestedAxis ?? 'z',
          closed: 0,
          open: travel,
          durationMs: 700,
          easing: 'easeOut',
          loop: 'none',
        },
      }

    case 'button':
      return {
        ...base,
        semantic: 'switch',
        labels: { on: 'Press', off: 'Release' },
        config: {
          kind: 'translateBetween',
          axis: context.suggestedAxis ?? 'y',
          closed: 0,
          open: -Math.max(travel * 0.05, 0.005),
          durationMs: 120,
          easing: 'easeOut',
          loop: 'none',
        },
      }

    case 'lever':
      return {
        ...base,
        semantic: 'switch',
        pivot: context.pivot ?? { mode: 'bottom' },
        labels: { on: 'Up', off: 'Down' },
        config: { kind: 'rotateBetween', axis: context.suggestedAxis ?? 'x', closedDeg: 0, openDeg: 35, durationMs: 250, easing: 'easeOut', loop: 'none' },
      }

    case 'genericRotation':
      return {
        ...base,
        semantic: 'rotating',
        labels: { on: 'Rotate', off: 'Reset' },
        config: { kind: 'rotateBetween', axis, closedDeg: 0, openDeg: 90, durationMs: 1000, easing: 'linear', loop: 'none' },
      }

    case 'genericTranslation':
      return {
        ...base,
        semantic: 'animated',
        labels: { on: 'Move', off: 'Reset' },
        config: {
          kind: 'translateBetween',
          axis,
          closed: 0,
          open: travel,
          durationMs: 1000,
          easing: 'linear',
          loop: 'none',
        },
      }

    case 'visibility':
      return {
        ...base,
        semantic: 'animated',
        labels: { on: 'Show', off: 'Hide' },
        config: { kind: 'toggleVisibility', hiddenByDefault: false },
      }

    case 'existingAnimation':
    default:
      return {
        ...base,
        semantic: 'animated',
        labels: { on: 'Play', off: 'Stop' },
        config: {
          kind: 'playAnimation',
          clipIds: context.clipIds ?? [],
          mode: 'toggle',
          loop: true,
          speed: 1,
        },
      }
  }
}

/** Preset that best matches a Phase 3 suggestion, for the Accept button. */
export function presetForSemantic(semantic: SemanticType): InteractionPreset {
  switch (semantic) {
    case 'door':
      return 'door'
    case 'fan':
    case 'rotating':
      return 'fan'
    case 'drawer':
      return 'drawer'
    case 'switch':
      return 'button'
    default:
      return 'genericRotation'
  }
}

export function labelFor(preset: InteractionPreset): string {
  return PRESETS.find((entry) => entry.id === preset)?.label ?? preset
}

function defaultTravel(extent: [number, number, number] | undefined, axis: Axis): number {
  if (!extent) return 0.5
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const value = extent[index] || Math.max(...extent) || 1
  return Number((value * 0.8).toFixed(4))
}

export interface OverrideContext {
  targetId: string
  name: string
  /** Animation capability discovered in Phase 3 for this object. */
  capability: ObjectAnimationCapability
  extent?: [number, number, number]
  includeChildren?: boolean
  semantic?: SemanticType
}

/**
 * Turns a baked clip into an editable manual motion, seeded with the axis and
 * amount the scanner measured. This is the escape hatch for a GLB whose door
 * swings the wrong way: flip the sign, change the angle, keep the same hinge.
 */
export function createOverrideFromDetection(context: OverrideContext): InteractionDefinition {
  const { capability } = context
  const rotation = capability.rotation
  const translation = capability.translation
  const semantic = context.semantic ?? 'animated'

  const base = {
    id: createInteractionId('override'),
    name: `Manual — ${context.name}`,
    targetId: context.targetId,
    extraTargetIds: [] as string[],
    includeChildren: context.includeChildren ?? true,
    // The clip drove this node directly, so its own origin already is the hinge.
    pivot: { mode: 'original' } as PivotSpec,
    createdFrom: 'override' as const,
    overrideClipIds: [...capability.clipIds],
  }

  const rotationAmount = rotation ? Math.round(rotation.totalDeg) : 0

  if (rotation && rotationAmount > 0 && !rotation.cyclic) {
    return {
      ...base,
      preset: 'genericRotation',
      semantic: semantic === 'unknown' ? 'door' : semantic,
      labels: { on: 'Open', off: 'Close' },
      config: {
        kind: 'rotateBetween',
        axis: rotation.axis ?? 'y',
        closedDeg: 0,
        // Same amount the clip used; flipping the sign reverses the swing.
        openDeg: Math.min(rotationAmount, 180),
        durationMs: 900,
        easing: 'easeInOut',
        loop: 'none',
      },
    }
  }

  if (rotation && rotation.cyclic) {
    return {
      ...base,
      preset: 'fan',
      semantic: semantic === 'unknown' ? 'rotating' : semantic,
      labels: { on: 'On', off: 'Off' },
      config: {
        kind: 'continuousSpin',
        axis: rotation.axis ?? 'y',
        speedDegPerSec: 360,
        maxSpeedDegPerSec: 1800,
        direction: 1,
        running: false,
      },
    }
  }

  if (translation && translation.distance > 0) {
    return {
      ...base,
      preset: 'genericTranslation',
      semantic: semantic === 'unknown' ? 'drawer' : semantic,
      labels: { on: 'Open', off: 'Close' },
      config: {
        kind: 'translateBetween',
        axis: translation.axis ?? 'z',
        closed: 0,
        open: Number(translation.distance.toFixed(4)),
        durationMs: 800,
        easing: 'easeOut',
        loop: 'none',
      },
    }
  }

  return {
    ...base,
    preset: 'genericRotation',
    semantic,
    labels: { on: 'Open', off: 'Close' },
    config: { kind: 'rotateBetween', axis: 'y', closedDeg: 0, openDeg: 90, durationMs: 900, easing: 'easeInOut', loop: 'none' },
  }
}

/** Reverses a rotation/translation without touching anything else. */
export function flipDirection(definition: InteractionDefinition): InteractionDefinition {
  const config = definition.config

  if (config.kind === 'rotateBetween') {
    return { ...definition, config: { ...config, openDeg: -config.openDeg, closedDeg: -config.closedDeg } }
  }
  if (config.kind === 'translateBetween') {
    return { ...definition, config: { ...config, open: -config.open, closed: -config.closed } }
  }
  if (config.kind === 'continuousSpin') {
    return { ...definition, config: { ...config, direction: config.direction === 1 ? -1 : 1 } }
  }
  return definition
}

/** Sets the open angle while preserving the current direction sign. */
export function withOpenAngle(definition: InteractionDefinition, degrees: number): InteractionDefinition {
  if (definition.config.kind !== 'rotateBetween') return definition

  const sign = definition.config.openDeg < 0 ? -1 : 1
  return { ...definition, config: { ...definition.config, openDeg: Math.abs(degrees) * sign } }
}
