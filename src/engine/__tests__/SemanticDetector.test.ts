import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { scanModel } from '../scanner/ModelScanner'
import { scanAnimations } from '../animation/AnimationScanner'
import { detectSemantics } from '../semantic/SemanticDetector'
import { buildAnimatedScene, positionTrack, quaternionTrack } from './animationFixtures'

function analyze(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const root = new THREE.Group()
  root.add(scene)
  const { manifest } = scanModel(root)
  const animation = scanAnimations(root, clips)
  return { manifest, animation, semantics: detectSemantics(manifest, animation) }
}

describe('SemanticDetector', () => {
  it('classifies a hinged, name-matching panel as a door with high confidence', () => {
    const { scene, door, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)
    const result = semantics[door.uuid]

    expect(result.type).toBe('door')
    expect(result.animationBacked).toBe(true)
    expect(result.confidence).toBeGreaterThan(0.6)
    expect(result.reasons.join(' ')).toMatch(/hinged swing/)
  })

  it('classifies a continuously spinning part as a fan', () => {
    const { scene, fan, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)
    const result = semantics[fan.uuid]

    expect(result.type).toBe('fan')
    expect(result.confidence).toBeGreaterThan(0.6)
    expect(result.reasons.join(' ')).toMatch(/continuous rotation/)
  })

  it('classifies a sliding part as a drawer', () => {
    const { scene, drawer, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)
    const result = semantics[drawer.uuid]

    expect(result.type).toBe('drawer')
    expect(result.reasons.join(' ')).toMatch(/slides/)
  })

  it('classifies a tiny push as a switch', () => {
    const { scene, button, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)

    expect(semantics[button.uuid].type).toBe('switch')
  })

  it('never promotes a name-only match to an operable verdict', () => {
    const { scene, decoy, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)
    const result = semantics[decoy.uuid]

    expect(result.animationBacked).toBe(false)
    expect(result.confidence).toBeLessThanOrEqual(0.35)
    expect(result.reasons.join(' ')).toMatch(/vocabulary|proportions/)
  })

  it('falls back to "animated" for unrecognised names and motions', () => {
    const { scene, mystery, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)
    const result = semantics[mystery.uuid]

    expect(result.type).toBe('animated')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('leaves untouched static geometry as unknown with zero confidence', () => {
    const scene = new THREE.Group()
    const screw = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01))
    screw.name = 'Screw_004'
    scene.add(screw)

    const { semantics } = analyze(scene, [])

    expect(semantics[screw.uuid].type).toBe('unknown')
    expect(semantics[screw.uuid].confidence).toBe(0)
  })

  it('lets a full spin outvote door naming', () => {
    const scene = new THREE.Group()
    const part = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12))
    part.name = 'DoorFan'
    scene.add(part)

    const clip = new THREE.AnimationClip('spin', 1, [
      quaternionTrack('DoorFan', new THREE.Vector3(0, 0, 1), 360, 12, 1),
    ])
    const { semantics } = analyze(scene, [clip])

    expect(semantics[part.uuid].type).toBe('fan')
    expect(semantics[part.uuid].evidence.some((item) => item.weight < 0 && item.type === 'door')).toBe(true)
  })

  it('records evidence sources so the UI can explain a detection', () => {
    const { scene, door, clips } = buildAnimatedScene()
    const { semantics } = analyze(scene, clips)
    const sources = new Set(semantics[door.uuid].evidence.map((item) => item.source))

    expect(sources.has('name')).toBe(true)
    expect(sources.has('animation')).toBe(true)
  })

  it('uses ancestor names as weaker evidence than the object name', () => {
    const scene = new THREE.Group()
    const assembly = new THREE.Group()
    assembly.name = 'DoorAssembly'
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 1))
    leaf.name = 'Mesh_12'
    assembly.add(leaf)
    scene.add(assembly)

    const clip = new THREE.AnimationClip('open', 2, [
      quaternionTrack('Mesh_12', new THREE.Vector3(0, 1, 0), 90),
    ])
    const { semantics } = analyze(scene, [clip])
    const evidence = semantics[leaf.uuid].evidence

    expect(semantics[leaf.uuid].type).toBe('door')
    expect(evidence.some((item) => item.source === 'hierarchy')).toBe(true)
  })

  it('does not call a small sliding part a drawer when the travel is tiny', () => {
    const scene = new THREE.Group()
    const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    part.name = 'Plate'
    scene.add(part)

    const clip = new THREE.AnimationClip('nudge', 1, [positionTrack('Plate', [0, 0, 0], [0, 0, 0.02])])
    const { semantics } = analyze(scene, [clip])

    expect(semantics[part.uuid].type).not.toBe('drawer')
  })
})

describe('SemanticDetector — naming support', () => {
  it('does not claim "door" for an unnamed part that merely swings', () => {
    const scene = new THREE.Group()
    const part = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 1))
    part.name = 'XT_9931'
    scene.add(part)

    const clip = new THREE.AnimationClip('take_001', 1.5, [
      quaternionTrack('XT_9931', new THREE.Vector3(1, 0, 0), 45, 6, 1.5),
    ])
    const { semantics } = analyze(scene, [clip])

    expect(semantics[part.uuid].type).toBe('animated')
  })

  it('still calls an unnamed full spin a rotating part', () => {
    const scene = new THREE.Group()
    const part = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12))
    part.name = 'Obj_77'
    scene.add(part)

    const clip = new THREE.AnimationClip('anim', 1, [
      quaternionTrack('Obj_77', new THREE.Vector3(0, 1, 0), 360, 12, 1),
    ])
    const { semantics } = analyze(scene, [clip])

    // "fan" needs a name hint; a bare spin is reported as a rotating part.
    expect(semantics[part.uuid].type).toBe('rotating')
  })
})
