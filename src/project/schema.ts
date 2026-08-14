import { z } from 'zod'

/**
 * Versioned project configuration. The GLB binary is never embedded here — a
 * project references the model by name/size/hash and stores only overrides,
 * interactions and editor state. Phase 5 handles persistence and import/export.
 */

export const PROJECT_VERSION = 1

const vec3 = z.tuple([z.number(), z.number(), z.number()])
const vec4 = z.tuple([z.number(), z.number(), z.number(), z.number()])
const axis = z.enum(['x', 'y', 'z'])
const easing = z.enum(['linear', 'easeInOut', 'easeOut', 'easeIn'])
const loopMode = z.enum(['none', 'loop', 'pingpong'])

export const semanticTypeSchema = z.enum(['door', 'fan', 'drawer', 'rotating', 'switch', 'animated', 'unknown'])

export const pivotSpecSchema = z.object({
  mode: z.enum(['original', 'center', 'left', 'right', 'top', 'bottom', 'custom']),
  point: vec3.optional(),
})

export const interactionConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rotateBetween'),
    axis,
    closedDeg: z.number(),
    openDeg: z.number(),
    durationMs: z.number().positive(),
    easing,
    loop: loopMode,
  }),
  z.object({
    kind: z.literal('translateBetween'),
    axis,
    closed: z.number(),
    open: z.number(),
    durationMs: z.number().positive(),
    easing,
    loop: loopMode,
  }),
  z.object({
    kind: z.literal('continuousSpin'),
    axis,
    speedDegPerSec: z.number().min(0),
    maxSpeedDegPerSec: z.number().positive(),
    direction: z.union([z.literal(1), z.literal(-1)]),
    running: z.boolean(),
  }),
  z.object({
    kind: z.literal('playAnimation'),
    clipIds: z.array(z.string()),
    mode: z.enum(['toggle', 'openClose', 'once']),
    loop: z.boolean(),
    speed: z.number().positive(),
  }),
  z.object({
    kind: z.literal('toggleVisibility'),
    hiddenByDefault: z.boolean(),
  }),
  z.object({
    kind: z.literal('transform'),
    from: z.object({ position: vec3.optional(), rotationDeg: vec3.optional(), scale: vec3.optional() }),
    to: z.object({ position: vec3.optional(), rotationDeg: vec3.optional(), scale: vec3.optional() }),
    durationMs: z.number().positive(),
    easing,
    loop: loopMode,
  }),
])

export const interactionDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  preset: z.enum([
    'door',
    'fan',
    'drawer',
    'button',
    'lever',
    'genericRotation',
    'genericTranslation',
    'existingAnimation',
    'visibility',
  ]),
  semantic: semanticTypeSchema,
  targetId: z.string().min(1),
  extraTargetIds: z.array(z.string()),
  includeChildren: z.boolean(),
  pivot: pivotSpecSchema,
  labels: z.object({ on: z.string(), off: z.string() }),
  config: interactionConfigSchema,
  createdFrom: z.enum(['manual', 'suggestion', 'detection', 'override']).optional(),
  overrideClipIds: z.array(z.string()).optional(),
})

export const materialOverrideSchema = z.object({
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  transparent: z.boolean().optional(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  emissive: z.string().optional(),
  emissiveIntensity: z.number().min(0).optional(),
  /** Set when the material was cloned off a shared one for a single object. */
  clonedFrom: z.string().optional(),
})

export const objectOverrideSchema = z.object({
  /** Renamed label; the glTF name stays untouched. */
  name: z.string().optional(),
  visible: z.boolean().optional(),
  position: vec3.optional(),
  quaternion: vec4.optional(),
  scale: vec3.optional(),
  /**
   * Per-slot material edits that were isolated to this object. Restoring them
   * re-clones from `from`, so clone uuids never need to survive a reload.
   */
  materialSlots: z
    .array(
      z.object({
        slot: z.number().int().nonnegative(),
        from: z.string(),
        override: materialOverrideSchema,
      }),
    )
    .optional(),
})

export const logicalGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  memberIds: z.array(z.string()).min(1),
})

export const semanticOverrideSchema = z.object({
  type: semanticTypeSchema,
  status: z.enum(['accepted', 'changed', 'ignored']),
  note: z.string().optional(),
})

export const modelIdentitySchema = z.object({
  fileName: z.string(),
  fileSize: z.number().nonnegative(),
  /** Content hash of the GLB bytes; the binary itself lives outside the JSON. */
  hash: z.string(),
  objectCount: z.number().nonnegative(),
  clipCount: z.number().nonnegative(),
})

export const editorSettingsSchema = z.object({
  gridVisible: z.boolean(),
  transformMode: z.enum(['translate', 'rotate', 'scale']),
  transformSpace: z.enum(['world', 'local']),
  snapTranslation: z.number().nullable(),
  snapRotationDeg: z.number().nullable(),
  materialScope: z.enum(['shared', 'isolate']),
})

export const cameraStateSchema = z.object({
  position: vec3,
  target: vec3,
  fov: z.number().positive(),
  near: z.number().positive(),
  far: z.number().positive(),
})

export const projectSchema = z.object({
  version: z.literal(PROJECT_VERSION),
  savedAt: z.number(),
  model: modelIdentitySchema,
  objects: z.record(z.string(), objectOverrideSchema),
  materials: z.record(z.string(), materialOverrideSchema),
  interactions: z.array(interactionDefinitionSchema),
  semanticOverrides: z.record(z.string(), semanticOverrideSchema),
  pivots: z.record(z.string(), pivotSpecSchema),
  groups: z.array(logicalGroupSchema),
  editor: editorSettingsSchema,
  camera: cameraStateSchema.nullable(),
})

export type Project = z.infer<typeof projectSchema>
export type ObjectOverride = z.infer<typeof objectOverrideSchema>
export type MaterialOverride = z.infer<typeof materialOverrideSchema>
export type LogicalGroup = z.infer<typeof logicalGroupSchema>
export type SemanticOverride = z.infer<typeof semanticOverrideSchema>
export type ModelIdentity = z.infer<typeof modelIdentitySchema>
export type EditorSettings = z.infer<typeof editorSettingsSchema>
export type CameraState = z.infer<typeof cameraStateSchema>

export interface ParseResult {
  ok: boolean
  project: Project | null
  errors: string[]
}

/** Validates unknown JSON against the current schema version. */
export function parseProject(input: unknown): ParseResult {
  const result = projectSchema.safeParse(input)
  if (result.success) return { ok: true, project: result.data, errors: [] }

  return {
    ok: false,
    project: null,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  }
}

export function createEmptyProject(model: ModelIdentity, editor: EditorSettings, savedAt = 0): Project {
  return {
    version: PROJECT_VERSION,
    savedAt,
    model,
    objects: {},
    materials: {},
    interactions: [],
    semanticOverrides: {},
    pivots: {},
    groups: [],
    editor,
    camera: null,
  }
}

/**
 * FNV-1a over the GLB bytes. Synchronous and dependency-free, which keeps model
 * identity available in tests and in workers without crypto.subtle.
 */
export function hashBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let hash = 0x811c9dc5

  for (let i = 0; i < view.length; i++) {
    hash ^= view[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `fnv1a-${view.length.toString(16)}-${hash.toString(16).padStart(8, '0')}`
}
