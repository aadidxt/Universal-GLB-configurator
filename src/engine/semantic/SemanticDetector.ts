import type { ModelManifest, NodeEntry } from '../scanner/types'
import type { AnimationScanResult, ObjectAnimationCapability } from '../animation/types'
import type { SemanticEvidence, SemanticResult, SemanticType } from './types'

/** Confidence ceiling when nothing but naming supports the guess. */
const NAME_ONLY_CAP = 0.35
/** Score a type must reach before it wins over "animated"/"unknown". */
const TYPE_THRESHOLD = 0.4

const VOCAB: Record<Exclude<SemanticType, 'animated' | 'unknown'>, string[]> = {
  door: ['door', 'gate', 'hatch', 'lid', 'cover', 'flap', 'panel', 'shutter', 'access'],
  fan: ['fan', 'blower', 'impeller', 'propeller', 'turbine', 'ventilator'],
  drawer: ['drawer', 'tray', 'slide', 'slider', 'rail', 'extension', 'shelf'],
  rotating: ['rotor', 'wheel', 'motor', 'shaft', 'pulley', 'gear', 'roller', 'spinner', 'spindle'],
  switch: ['button', 'switch', 'lever', 'toggle', 'knob', 'trigger', 'dial'],
}

const CHILD_HINTS: Partial<Record<SemanticType, string[]>> = {
  door: ['handle', 'knob', 'latch', 'hinge', 'lock'],
  fan: ['blade', 'impeller', 'hub', 'vane', 'propeller'],
  drawer: ['runner', 'rail', 'front', 'handle'],
  switch: ['cap', 'led', 'indicator'],
}

/**
 * Types whose motion pattern alone is ambiguous: a 45° swing could be a door,
 * a lever or a hinge bracket, so naming or hierarchy has to back them up.
 * "rotating" is deliberately absent — a full spin needs no name to be a spin.
 */
const NAME_SUPPORT_REQUIRED: SemanticType[] = ['door', 'fan', 'drawer', 'switch']

/** Full-turn sweeps mean "spins", not "swings". */
const SPIN_DEG = 300
/** Doors/lids swing somewhere in this window. */
const SWING_MIN_DEG = 15
const SWING_MAX_DEG = 200

export interface DetectOptions {
  /** Diagonal of the whole model, for relative-size evidence. */
  modelDiagonal?: number
}

/**
 * Deterministic, weighted-evidence classifier.
 * Every contributing rule is recorded so the UI can explain a detection, and a
 * name on its own can never produce a confident result.
 */
export function detectSemantics(
  manifest: ModelManifest,
  animations: AnimationScanResult,
  options: DetectOptions = {},
): Record<string, SemanticResult> {
  const modelDiagonal = options.modelDiagonal ?? estimateModelDiagonal(manifest)
  const results: Record<string, SemanticResult> = {}

  for (const id of manifest.order) {
    const node = manifest.nodes[id]
    if (!node) continue
    results[id] = classifyNode(node, manifest, animations, modelDiagonal)
  }

  return results
}

export function classifyNode(
  node: NodeEntry,
  manifest: ModelManifest,
  animations: AnimationScanResult,
  modelDiagonal: number,
): SemanticResult {
  const capability = animations.objects[node.id] ?? null
  const evidence: SemanticEvidence[] = []

  const selfTokens = tokenize(node.name)
  const ancestorTokens = ancestorNames(manifest, node).flatMap(tokenize)
  const childTokens = childNames(manifest, node).flatMap(tokenize)
  const clipTokens = (capability?.clipIds ?? [])
    .map((clipId) => animations.clips.find((clip) => clip.id === clipId)?.name ?? '')
    .flatMap(tokenize)

  // --- naming evidence (never sufficient on its own) ---
  for (const [type, words] of Object.entries(VOCAB) as [SemanticType, string[]][]) {
    if (matches(selfTokens, words)) {
      evidence.push({ type, weight: 0.3, source: 'name', reason: `Name "${node.name}" matches ${type} vocabulary` })
    } else if (matches(ancestorTokens, words)) {
      evidence.push({ type, weight: 0.12, source: 'hierarchy', reason: `Ancestor name matches ${type} vocabulary` })
    }
    if (matches(clipTokens, words)) {
      evidence.push({ type, weight: 0.08, source: 'name', reason: `Animation clip name mentions ${type}` })
    }
  }

  for (const [type, hints] of Object.entries(CHILD_HINTS) as [SemanticType, string[]][]) {
    if (matches(childTokens, hints)) {
      evidence.push({ type, weight: 0.12, source: 'hierarchy', reason: `Child object named like ${hints.join('/')}` })
    }
  }

  // --- shape evidence ---
  const size = node.worldBounds?.size ?? null
  if (size) {
    const sorted = [...size].sort((a, b) => a - b)
    const [min, mid, max] = sorted
    if (max > 0 && min < max * 0.25) {
      evidence.push({ type: 'door', weight: 0.1, source: 'shape', reason: 'Slab-like proportions (thin panel)' })
    }
    if (max > 0 && Math.abs(mid - max) < max * 0.2 && min < max * 0.5) {
      evidence.push({ type: 'fan', weight: 0.1, source: 'shape', reason: 'Disc-like proportions' })
    }
    const diagonal = Math.hypot(size[0], size[1], size[2])
    if (modelDiagonal > 0 && diagonal < modelDiagonal * 0.05) {
      evidence.push({ type: 'switch', weight: 0.12, source: 'shape', reason: 'Small part relative to the whole model' })
    }
  }

  // --- animation evidence: the only thing that unlocks high confidence ---
  if (capability) {
    addAnimationEvidence(evidence, capability, node, size)
  }

  const scores = tally(evidence)
  const animationBacked = evidence.some((item) => item.source === 'animation' && item.weight > 0)

  const supportedByName = new Set(
    evidence
      .filter((item) => (item.source === 'name' || item.source === 'hierarchy') && item.weight > 0)
      .map((item) => item.type),
  )

  const eligible = (Object.entries(scores) as [SemanticType, number][]).filter(
    ([type]) => !NAME_SUPPORT_REQUIRED.includes(type) || supportedByName.has(type),
  )

  let best: SemanticType = 'unknown'
  let bestScore = 0
  for (const [type, score] of eligible) {
    if (score > bestScore) {
      best = type
      bestScore = score
    }
  }

  // A name alone is a candidate, never a verdict.
  let confidence = clamp(bestScore, 0, 1)
  if (!animationBacked) confidence = Math.min(confidence, NAME_ONLY_CAP)

  let type: SemanticType = best
  if (bestScore < TYPE_THRESHOLD || (!animationBacked && bestScore < TYPE_THRESHOLD)) {
    type = capability ? 'animated' : best !== 'unknown' ? best : 'unknown'
  }

  if (capability && type === 'unknown') type = 'animated'
  if (type === 'animated' && capability) {
    confidence = Math.max(confidence, 0.5)
    evidence.push({
      type: 'animated',
      weight: 0,
      source: 'animation',
      reason: 'Animation: driven by a clip but no pattern matched',
    })
  }
  if (!capability && best === 'unknown') confidence = 0

  return {
    type,
    confidence: round(confidence),
    reasons: evidence.filter((item) => item.type === type || item.weight === 0).map((item) => item.reason),
    evidence,
    scores,
    animationBacked,
  }
}

function addAnimationEvidence(
  evidence: SemanticEvidence[],
  capability: ObjectAnimationCapability,
  node: NodeEntry,
  size: number[] | null,
): void {
  const rotation = capability.rotation
  const translation = capability.translation

  if (rotation && rotation.totalDeg > 0) {
    const spins = rotation.cyclic && rotation.totalDeg >= SPIN_DEG

    if (spins) {
      evidence.push({
        type: 'fan',
        weight: 0.4,
        source: 'animation',
        reason: `Animation: continuous rotation of ${Math.round(rotation.totalDeg)}° about ${rotation.axis ?? '?'}`,
      })
      evidence.push({
        type: 'rotating',
        // A full revolution is mechanically unambiguous, so this alone is
        // enough to classify — unlike a partial swing.
        weight: 0.45,
        source: 'animation',
        reason: `Animation: continuous rotation of ${Math.round(rotation.totalDeg)}° about ${rotation.axis ?? '?'}`,
      })
      evidence.push({
        type: 'door',
        weight: -0.3,
        source: 'animation',
        reason: 'Animation: spins fully, so not a hinged door',
      })
    } else if (rotation.totalDeg >= SWING_MIN_DEG && rotation.totalDeg <= SWING_MAX_DEG) {
      evidence.push({
        type: 'door',
        weight: 0.35,
        source: 'animation',
        reason: `Animation: hinged swing of ${Math.round(rotation.totalDeg)}° about ${rotation.axis ?? '?'}`,
      })
      if (rotation.axis === 'y') {
        evidence.push({
          type: 'door',
          weight: 0.08,
          source: 'animation',
          reason: 'Animation: rotates about the vertical axis',
        })
      }
      const pivotOffset = pivotOffsetRatio(node)
      if (pivotOffset !== null && pivotOffset > 0.25) {
        evidence.push({
          type: 'door',
          weight: 0.15,
          source: 'animation',
          reason: `Pivot sits ${Math.round(pivotOffset * 100)}% off-centre — hinge-like`,
        })
      }
    } else if (rotation.totalDeg < SWING_MIN_DEG) {
      evidence.push({
        type: 'switch',
        weight: 0.25,
        source: 'animation',
        reason: `Animation: small ${Math.round(rotation.totalDeg)}° tilt`,
      })
    }
  }

  if (translation && translation.distance > 0) {
    const extent = size && translation.axis ? size[['x', 'y', 'z'].indexOf(translation.axis)] : 0
    const relative = extent > 0 ? translation.distance / extent : 0

    if (relative > 0.15 || (extent === 0 && translation.distance > 0)) {
      evidence.push({
        type: 'drawer',
        weight: 0.4,
        source: 'animation',
        reason: `Animation: slides ${translation.distance.toFixed(3)} along ${translation.axis ?? '?'}`,
      })
      if (translation.axis === 'x' || translation.axis === 'z') {
        evidence.push({
          type: 'drawer',
          weight: 0.08,
          source: 'animation',
          reason: 'Animation: travels horizontally',
        })
      }
    } else {
      evidence.push({
        type: 'switch',
        weight: 0.2,
        source: 'animation',
        reason: `Animation: short ${translation.distance.toFixed(3)} push travel`,
      })
    }
  }

  if (capability.morphing) {
    evidence.push({
      type: 'animated',
      weight: 0,
      source: 'animation',
      reason: 'Animation: drives morph target influences',
    })
  }
}

/** How far the object's origin sits from its bounding-box centre, 0..~1. */
export function pivotOffsetRatio(node: NodeEntry): number | null {
  const bounds = node.worldBounds
  const pivot = node.worldPosition
  if (!bounds || !pivot) return null

  const size = bounds.size
  const ratios = [0, 1, 2].map((axis) => {
    const extent = size[axis]
    if (!extent || extent <= 1e-6) return 0
    return Math.abs(pivot[axis] - bounds.center[axis]) / (extent / 2)
  })

  return Math.min(1, Math.max(...ratios))
}

function tally(evidence: SemanticEvidence[]): Partial<Record<SemanticType, number>> {
  const scores: Partial<Record<SemanticType, number>> = {}
  for (const item of evidence) {
    if (item.weight === 0) continue
    scores[item.type] = round(clamp((scores[item.type] ?? 0) + item.weight, 0, 1))
  }
  return scores
}

function ancestorNames(manifest: ModelManifest, node: NodeEntry): string[] {
  const names: string[] = []
  let parentId = node.parentId
  while (parentId) {
    const parent = manifest.nodes[parentId]
    if (!parent) break
    names.push(parent.name)
    parentId = parent.parentId
  }
  return names
}

function childNames(manifest: ModelManifest, node: NodeEntry): string[] {
  const names: string[] = []
  const stack = [...node.childIds]
  while (stack.length > 0) {
    const child = manifest.nodes[stack.pop() as string]
    if (!child) continue
    names.push(child.name)
    stack.push(...child.childIds)
  }
  return names
}

/** Lowercases and splits on separators and camelCase boundaries. */
export function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function matches(tokens: string[], words: string[]): boolean {
  return tokens.some((token) => words.some((word) => token === word || token.includes(word)))
}

function estimateModelDiagonal(manifest: ModelManifest): number {
  let diagonal = 0
  for (const id of manifest.rootIds) {
    const bounds = manifest.nodes[id]?.worldBounds
    if (!bounds) continue
    diagonal = Math.max(diagonal, Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2]))
  }
  return diagonal
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
