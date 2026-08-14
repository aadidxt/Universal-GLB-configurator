import type { AnimatedProperty, AnimationScanResult } from '../animation/types'
import type { SemanticResult, SemanticType } from '../semantic/types'

/** Configurator groupings. The Outliner still shows everything. */
export type ConfiguratorCategory = 'doors' | 'cooling' | 'drawers' | 'switches' | 'other'

export const CATEGORY_LABELS: Record<ConfiguratorCategory, string> = {
  doors: 'Doors',
  cooling: 'Cooling / Rotating',
  drawers: 'Drawers / Sliders',
  switches: 'Switches / Levers',
  other: 'Other Animations',
}

export type InteractionKind =
  /** Open / Close driven by one clip, closing by reversing it. */
  | 'open-close'
  /** Looping on/off, used by fans and motors. */
  | 'toggle-loop'
  /** Playback-rate control, always paired with toggle-loop. */
  | 'speed'
  /** Normalized position scrub along the clip. */
  | 'scrub'
  /** Fire the clip once and return to its rest pose. */
  | 'trigger'
  /** Raw clip transport, used when nothing smarter applies. */
  | 'play'
  /** Reverse playback, offered only when it is safe (cyclic clips). */
  | 'direction'

export interface Interaction {
  kind: InteractionKind
  clipId: string
  clipName: string
  label: string
  /** Duration of the driving clip, for slider ranges. */
  duration: number
}

export interface CapabilityEntry {
  /** Object3D uuid — same key space as the scene manifest. */
  id: string
  name: string
  type: string
  parentId: string | null

  selectable: boolean
  recolorable: boolean
  transformable: boolean
  animated: boolean

  animatedProperties: AnimatedProperty[]
  clipIds: string[]

  semantic: SemanticType
  confidence: number
  reasons: string[]

  /** Real animation data exists, so the generated controls actually do something. */
  operable: boolean
  interactions: Interaction[]
  category: ConfiguratorCategory
  /** Shown in the Configurator (animated, or a strong-enough candidate). */
  inConfigurator: boolean
}

export interface CapabilityManifest {
  entries: Record<string, CapabilityEntry>
  order: string[]
  /** Category -> entry ids, Configurator members only. */
  categories: Record<ConfiguratorCategory, string[]>
  /** Clip id -> entry ids it drives. */
  clipTargets: Record<string, string[]>
  animation: AnimationScanResult
  semantics: Record<string, SemanticResult>
}

export const EMPTY_CATEGORIES: Record<ConfiguratorCategory, string[]> = {
  doors: [],
  cooling: [],
  drawers: [],
  switches: [],
  other: [],
}
