import type { ModelManifest, NodeEntry } from '../scanner/types'
import { EMPTY_ANIMATION_SCAN, type AnimationScanResult, type ClipInfo } from '../animation/types'
import { detectSemantics } from '../semantic/SemanticDetector'
import type { SemanticResult, SemanticType } from '../semantic/types'
import {
  EMPTY_CATEGORIES,
  type CapabilityEntry,
  type CapabilityManifest,
  type ConfiguratorCategory,
  type Interaction,
} from './types'

/** Candidates below this never reach the Configurator — no screw gets a control. */
const CONFIGURATOR_CONFIDENCE = 0.3

export const EMPTY_CAPABILITY_MANIFEST: CapabilityManifest = {
  entries: {},
  order: [],
  categories: { ...EMPTY_CATEGORIES },
  clipTargets: {},
  animation: EMPTY_ANIMATION_SCAN,
  semantics: {},
}

/**
 * The single derived description the UI reads: scene structure + material
 * capabilities + animation capabilities + semantic classification, merged.
 * Components query this instead of re-walking Three.js objects.
 */
export function buildCapabilityManifest(
  manifest: ModelManifest,
  animation: AnimationScanResult,
): CapabilityManifest {
  const semantics = detectSemantics(manifest, animation)
  const entries: Record<string, CapabilityEntry> = {}
  const order: string[] = []
  const categories: Record<ConfiguratorCategory, string[]> = { ...EMPTY_CATEGORIES }
  for (const key of Object.keys(categories) as ConfiguratorCategory[]) categories[key] = []
  const clipTargets: Record<string, string[]> = {}

  for (const id of manifest.order) {
    const node = manifest.nodes[id]
    if (!node) continue

    const semantic = semantics[id] ?? fallbackSemantic()
    const capability = animation.objects[id] ?? null
    const clips = (capability?.clipIds ?? []).map((clipId) => animation.clips.find((clip) => clip.id === clipId))
    const resolvedClips = clips.filter((clip): clip is ClipInfo => !!clip)

    const animated = resolvedClips.length > 0
    const interactions = animated ? buildInteractions(semantic.type, resolvedClips, capability) : []
    const category = categoryFor(semantic.type)

    const entry: CapabilityEntry = {
      id,
      name: node.name,
      type: node.type,
      parentId: node.parentId,
      selectable: true,
      recolorable: isRecolorable(node, manifest),
      transformable: true,
      animated,
      animatedProperties: capability?.properties ?? [],
      clipIds: capability?.clipIds ?? [],
      semantic: semantic.type,
      confidence: semantic.confidence,
      reasons: semantic.reasons,
      operable: animated && interactions.length > 0,
      interactions,
      category,
      inConfigurator: animated || semantic.confidence >= CONFIGURATOR_CONFIDENCE,
    }

    entries[id] = entry
    order.push(id)

    if (entry.inConfigurator) categories[category].push(id)
    for (const clipId of entry.clipIds) {
      clipTargets[clipId] = [...(clipTargets[clipId] ?? []), id]
    }
  }

  return { entries, order, categories, clipTargets, animation, semantics }
}

function buildInteractions(
  semantic: SemanticType,
  clips: ClipInfo[],
  capability: { rotation: { cyclic: boolean } | null } | null,
): Interaction[] {
  const interactions: Interaction[] = []
  const cyclic = capability?.rotation?.cyclic ?? false

  for (const clip of clips) {
    const base = { clipId: clip.id, clipName: clip.name, duration: clip.duration }

    switch (semantic) {
      case 'door':
        // One forward clip is enough: closing replays it in reverse, so the UI
        // never dead-ends at "opened".
        interactions.push({ ...base, kind: 'open-close', label: `Open / Close (${clip.name})` })
        interactions.push({ ...base, kind: 'scrub', label: 'Position' })
        break

      case 'fan':
      case 'rotating':
        interactions.push({ ...base, kind: 'toggle-loop', label: `On / Off (${clip.name})` })
        interactions.push({ ...base, kind: 'speed', label: 'Speed' })
        // Reversing a clip that does not return to its start pose would jump.
        if (cyclic || clip.loopable) {
          interactions.push({ ...base, kind: 'direction', label: 'Direction' })
        }
        break

      case 'drawer':
        interactions.push({ ...base, kind: 'open-close', label: `Open / Close (${clip.name})` })
        interactions.push({ ...base, kind: 'scrub', label: 'Extension' })
        break

      case 'switch':
        interactions.push({ ...base, kind: 'trigger', label: `Actuate (${clip.name})` })
        break

      default:
        interactions.push({ ...base, kind: 'play', label: clip.name })
        break
    }
  }

  return interactions
}

function categoryFor(semantic: SemanticType): ConfiguratorCategory {
  switch (semantic) {
    case 'door':
      return 'doors'
    case 'fan':
    case 'rotating':
      return 'cooling'
    case 'drawer':
      return 'drawers'
    case 'switch':
      return 'switches'
    default:
      return 'other'
  }
}

/** Recolorable when the object owns at least one material exposing a color. */
function isRecolorable(node: NodeEntry, manifest: ModelManifest): boolean {
  if (!node.isRenderable) return false
  return node.materialIds.some((materialId) => manifest.materials[materialId]?.color !== null)
}

function fallbackSemantic(): SemanticResult {
  return { type: 'unknown', confidence: 0, reasons: [], evidence: [], scores: {}, animationBacked: false }
}
