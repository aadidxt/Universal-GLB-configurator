import { describe, expect, it } from 'vitest'
import { createInteractionFromPreset, flipDirection, withOpenAngle } from '../../engine/interaction/presets'
import { createEmptyProject, parseProject, type EditorSettings, type ModelIdentity } from '../schema'
import { readProjectFile, serializeProject } from '../projectIO'

const model: ModelIdentity = {
  fileName: 'rack.glb',
  fileSize: 31000,
  hash: 'fnv1a-7918-abcdef12',
  objectCount: 13,
  clipCount: 4,
}

const editor: EditorSettings = {
  gridVisible: false,
  transformMode: 'rotate',
  transformSpace: 'local',
  snapTranslation: 0.25,
  snapRotationDeg: 15,
  materialScope: 'shared',
}

function projectWithDoor() {
  // Flipped 120 degree door, exactly what the wrong-direction fix produces.
  const definition = flipDirection(
    withOpenAngle(createInteractionFromPreset('door', { targetId: 'door-uuid', name: 'FrontDoor' }), 120),
  )
  return {
    ...createEmptyProject(model, editor, 1700000000000),
    objects: {
      'door-uuid': {
        name: 'Front door',
        visible: true,
        materialSlots: [{ slot: 0, from: 'mat-base', override: { color: '#00ff00', opacity: 1, transparent: false } }],
      },
    },
    materials: { 'mat-base': { color: '#112233', opacity: 1, transparent: false } },
    interactions: [definition],
    camera: {
      position: [4, 3, 5] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
      fov: 50,
      near: 0.1,
      far: 500,
    },
  }
}

describe('project file round trip', () => {
  it('serializes and re-reads a configuration without loss', () => {
    const project = projectWithDoor()
    const result = readProjectFile(serializeProject(project), model.hash)

    expect(result.errors).toEqual([])
    expect(result.modelMismatch).toBe(false)
    expect(result.project?.interactions[0].config).toMatchObject({ kind: 'rotateBetween', openDeg: -120 })
    expect(result.project?.objects['door-uuid'].materialSlots?.[0].override.color).toBe('#00ff00')
    expect(result.project?.editor).toEqual(editor)
    expect(result.project?.camera?.target).toEqual([0, 1, 0])
  })

  it('keeps the flipped angle and direction exactly as configured', () => {
    const project = projectWithDoor()
    const restored = readProjectFile(serializeProject(project), model.hash).project

    const config = restored?.interactions[0].config
    expect(config).toMatchObject({ kind: 'rotateBetween', openDeg: -120, axis: 'y' })
    // Sign carries the direction; magnitude carries the swing.
    expect(Math.sign((config as { openDeg: number }).openDeg)).toBe(-1)
  })

  it('flags a configuration saved for a different GLB without rejecting it', () => {
    const result = readProjectFile(serializeProject(projectWithDoor()), 'fnv1a-other-hash')

    expect(result.project).not.toBeNull()
    expect(result.modelMismatch).toBe(true)
  })

  it('reports invalid JSON instead of throwing', () => {
    const result = readProjectFile('{ not json', model.hash)

    expect(result.project).toBeNull()
    expect(result.errors[0]).toMatch(/Not valid JSON/)
  })

  it('rejects a file that does not match the schema', () => {
    const broken = { ...projectWithDoor(), interactions: [{ id: 'x' }] }
    const result = readProjectFile(JSON.stringify(broken), model.hash)

    expect(result.project).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('never carries the GLB binary in the payload', () => {
    const text = serializeProject(projectWithDoor())

    expect(text).not.toMatch(/glTF/)
    expect(text.length).toBeLessThan(20000)
    expect(parseProject(JSON.parse(text)).ok).toBe(true)
  })

  it('stores only what changed, so an untouched model saves an empty diff', () => {
    const empty = createEmptyProject(model, editor, 1)

    expect(empty.objects).toEqual({})
    expect(empty.materials).toEqual({})
    expect(empty.interactions).toEqual([])
  })
})
