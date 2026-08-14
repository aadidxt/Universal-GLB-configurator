import { describe, expect, it } from 'vitest'
import { createInteractionFromPreset } from '../../engine/interaction/presets'
import {
  PROJECT_VERSION,
  createEmptyProject,
  hashBytes,
  interactionDefinitionSchema,
  parseProject,
  projectSchema,
  type EditorSettings,
  type ModelIdentity,
} from '../schema'

const model: ModelIdentity = {
  fileName: 'rack.glb',
  fileSize: 1234,
  hash: 'fnv1a-4d2-deadbeef',
  objectCount: 12,
  clipCount: 2,
}

const editor: EditorSettings = {
  gridVisible: true,
  transformMode: 'translate',
  transformSpace: 'world',
  snapTranslation: null,
  snapRotationDeg: 15,
  materialScope: 'isolate',
}

describe('project schema', () => {
  it('creates a valid empty project', () => {
    const project = createEmptyProject(model, editor, 1700000000000)
    const result = parseProject(project)

    expect(result.ok).toBe(true)
    expect(result.project?.version).toBe(PROJECT_VERSION)
    expect(result.project?.interactions).toEqual([])
  })

  it('accepts real interaction definitions produced by the presets', () => {
    for (const preset of ['door', 'fan', 'drawer', 'button', 'lever', 'genericRotation', 'genericTranslation', 'visibility'] as const) {
      const definition = createInteractionFromPreset(preset, { targetId: 'obj-1', name: 'Part', extent: [1, 2, 0.5] })
      const parsed = interactionDefinitionSchema.safeParse(JSON.parse(JSON.stringify(definition)))
      expect(parsed.success, `${preset}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
    }
  })

  it('round-trips a fully populated project through JSON', () => {
    const definition = createInteractionFromPreset('door', { targetId: 'obj-1', name: 'Door' })
    const project = {
      ...createEmptyProject(model, editor, 1),
      objects: { 'obj-1': { name: 'Front door', visible: true, position: [0, 1, 2] as [number, number, number] } },
      materials: { 'mat-1': { color: '#ff0000', opacity: 0.5, transparent: true } },
      interactions: [definition],
      semanticOverrides: { 'obj-1': { type: 'door' as const, status: 'accepted' as const } },
      pivots: { 'obj-1': { mode: 'custom' as const, point: [1, 2, 3] as [number, number, number] } },
      groups: [{ id: 'g1', name: 'Door assembly', memberIds: ['obj-1', 'obj-2'] }],
      camera: {
        position: [1, 2, 3] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
        fov: 50,
        near: 0.1,
        far: 100,
      },
    }

    const result = parseProject(JSON.parse(JSON.stringify(project)))
    expect(result.ok).toBe(true)
    expect(result.project?.interactions[0].config.kind).toBe('rotateBetween')
    expect(result.project?.groups[0].memberIds).toHaveLength(2)
  })

  it('rejects an unknown version with a readable error', () => {
    const project = { ...createEmptyProject(model, editor, 1), version: 99 }
    const result = parseProject(project)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/version/)
  })

  it('rejects malformed interaction configs', () => {
    const project = {
      ...createEmptyProject(model, editor, 1),
      interactions: [
        {
          id: 'x',
          name: 'Bad',
          preset: 'door',
          semantic: 'door',
          targetId: 'obj',
          extraTargetIds: [],
          includeChildren: true,
          pivot: { mode: 'left' },
          labels: { on: 'Open', off: 'Close' },
          config: { kind: 'rotateBetween', axis: 'w', closedDeg: 0, openDeg: 90, durationMs: 100, easing: 'linear', loop: 'none' },
        },
      ],
    }

    const result = parseProject(project)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/axis/)
  })

  it('rejects a non-positive duration', () => {
    const definition = createInteractionFromPreset('door', { targetId: 'obj', name: 'Door' })
    const broken = { ...definition, config: { ...definition.config, durationMs: 0 } }

    expect(interactionDefinitionSchema.safeParse(broken).success).toBe(false)
  })

  it('keeps the GLB binary out of the project payload', () => {
    const project = createEmptyProject(model, editor, 1)
    const keys = Object.keys(projectSchema.shape)

    expect(keys).not.toContain('glb')
    expect(keys).not.toContain('binary')
    expect(project.model.hash).toBe(model.hash)
  })

  it('hashes model bytes deterministically and notices changes', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 4])
    const c = new Uint8Array([1, 2, 3, 5])

    expect(hashBytes(a)).toBe(hashBytes(b))
    expect(hashBytes(a)).not.toBe(hashBytes(c))
    expect(hashBytes(a.buffer)).toBe(hashBytes(a))
  })
})
