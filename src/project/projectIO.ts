import type { EditorEngine } from '../engine/EditorEngine'
import type { InteractionDefinition } from '../engine/interaction/types'
import {
  PROJECT_VERSION,
  parseProject,
  type EditorSettings,
  type ModelIdentity,
  type Project,
  type SemanticOverride,
} from './schema'

export interface ProjectSource {
  model: ModelIdentity
  editor: EditorSettings
  interactions: InteractionDefinition[]
  semanticOverrides: Record<string, SemanticOverride>
  savedAt: number
}

/**
 * Snapshots the current session into a project file. Object/material overrides
 * are diffed against the imported model, so the JSON only ever holds what the
 * user actually changed — the GLB binary stays out of it entirely.
 */
export function buildProject(engine: EditorEngine, source: ProjectSource): Project {
  const { objects, materials } = engine.collectOverrides()
  const maps = engine.getIdMaps()

  // Everything written to disk is keyed by stable ids: Three.js hands out fresh
  // uuids on every parse, so uuids would break on the very next load.
  const objectEntries: Project['objects'] = {}
  for (const [uuid, override] of Object.entries(objects)) {
    const stable = maps.objectToStable[uuid]
    if (!stable) continue

    objectEntries[stable] = {
      ...override,
      materialSlots: override.materialSlots?.map((slot) => ({
        ...slot,
        from: maps.materialToStable[slot.from] ?? slot.from,
      })),
    }
  }

  const materialEntries: Project['materials'] = {}
  for (const [uuid, override] of Object.entries(materials)) {
    const stable = maps.materialToStable[uuid]
    if (stable) materialEntries[stable] = override
  }

  const interactions = source.interactions.map((interaction) => ({
    ...interaction,
    targetId: maps.objectToStable[interaction.targetId] ?? interaction.targetId,
    extraTargetIds: interaction.extraTargetIds.map((id) => maps.objectToStable[id] ?? id),
  }))

  const semanticOverrides: Project['semanticOverrides'] = {}
  for (const [uuid, override] of Object.entries(source.semanticOverrides)) {
    const stable = maps.objectToStable[uuid]
    if (stable) semanticOverrides[stable] = override
  }

  const pivots: Project['pivots'] = {}
  for (const interaction of interactions) {
    if (interaction.pivot.mode !== 'original') pivots[interaction.id] = interaction.pivot
  }

  return {
    version: PROJECT_VERSION,
    savedAt: source.savedAt,
    model: source.model,
    objects: objectEntries,
    materials: materialEntries,
    interactions,
    semanticOverrides,
    pivots,
    groups: [],
    editor: source.editor,
    camera: engine.getCameraState(),
  }
}

export interface ApplyResult {
  interactions: InteractionDefinition[]
  semanticOverrides: Record<string, SemanticOverride>
  editor: EditorSettings
  /** Node ids whose transform/name/visibility was restored. */
  restoredObjects: string[]
  warnings: string[]
}

/**
 * Restores a project onto the freshly imported model.
 * Ids come from the same GLB, so they line up; anything missing is reported
 * instead of throwing, which keeps a stale project from bricking the editor.
 */
export function applyProject(engine: EditorEngine, project: Project): ApplyResult {
  const warnings: string[] = []
  const maps = engine.getIdMaps()
  const toUuid = (stable: string) => maps.stableToObject[stable] ?? null
  const toMaterial = (stable: string) => maps.stableToMaterial[stable] ?? null

  // 1. object-level overrides (rename, visibility, transforms)
  const known: Record<string, (typeof project.objects)[string]> = {}
  for (const [stableId, override] of Object.entries(project.objects)) {
    const uuid = toUuid(stableId)
    if (uuid && engine.selection.getObject(uuid)) known[uuid] = override
    else warnings.push(`Object ${stableId} is not in this model any more`)
  }
  engine.applyObjectOverrides(known)

  // 2. shared material edits, then per-object isolated clones
  for (const [stableId, override] of Object.entries(project.materials)) {
    const materialId = toMaterial(stableId)
    if (!materialId || !engine.materials.getMaterial(materialId)) {
      warnings.push(`Material ${stableId} is missing`)
      continue
    }
    engine.materials.applyTo(materialId, override)
  }

  for (const [objectId, override] of Object.entries(known)) {
    for (const slot of override.materialSlots ?? []) {
      // Re-cloning reproduces the look without needing the old clone uuid.
      engine.materials.edit(objectId, slot.slot, slot.override, 'isolate')
    }
  }

  // 3. interactions last: they may re-parent objects into pivot proxies
  const interactions: InteractionDefinition[] = []
  for (const stored of project.interactions) {
    const targetId = toUuid(stored.targetId)
    if (!targetId || !engine.selection.getObject(targetId)) {
      warnings.push(`Interaction "${stored.name}" has no target in this model`)
      continue
    }

    const definition: InteractionDefinition = {
      ...stored,
      targetId,
      extraTargetIds: stored.extraTargetIds
        .map((id) => toUuid(id))
        .filter((id): id is string => !!id),
    }
    engine.interactions.add(definition)
    interactions.push(definition)
  }

  if (project.camera) engine.setCameraState(project.camera)

  const semanticOverrides: ApplyResult['semanticOverrides'] = {}
  for (const [stableId, override] of Object.entries(project.semanticOverrides)) {
    const uuid = toUuid(stableId)
    if (uuid) semanticOverrides[uuid] = override
  }

  return {
    interactions,
    semanticOverrides,
    editor: project.editor,
    restoredObjects: Object.keys(known),
    warnings,
  }
}

/** Pretty-printed JSON for download. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export interface ImportResult {
  project: Project | null
  errors: string[]
  /** True when the file is valid but was saved for a different GLB. */
  modelMismatch: boolean
}

/** Validates an imported file and flags a hash mismatch without blocking it. */
export function readProjectFile(text: string, currentHash: string | null): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { project: null, errors: [`Not valid JSON: ${(error as Error).message}`], modelMismatch: false }
  }

  const result = parseProject(raw)
  if (!result.ok || !result.project) {
    return { project: null, errors: result.errors, modelMismatch: false }
  }

  return {
    project: result.project,
    errors: [],
    modelMismatch: currentHash !== null && result.project.model.hash !== currentHash,
  }
}
