import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { disposeObject3D } from './dispose'

export interface ModelStats {
  objects: number
  meshes: number
  triangles: number
  vertices: number
  materials: number
  textures: number
  animations: string[]
}

/**
 * Owns the single imported model: attachment to a dedicated root, stat
 * extraction, animation mixer ownership and full teardown on replace.
 * Later phases (selection, transforms, animation, scanning) read from here
 * instead of touching the scene graph directly.
 */
export class ModelManager {
  /** Dedicated parent — the model is the only thing ever added to it. */
  readonly root = new THREE.Group()

  private current: THREE.Object3D | null = null
  private currentGltf: GLTF | null = null
  private clips: THREE.AnimationClip[] = []

  constructor(parent: THREE.Object3D) {
    this.root.name = '__modelRoot'
    parent.add(this.root)
  }

  get object(): THREE.Object3D | null {
    return this.current
  }

  get gltf(): GLTF | null {
    return this.currentGltf
  }

  get animationClips(): THREE.AnimationClip[] {
    return this.clips
  }

  /** Replaces the current model, disposing everything the previous one held. */
  setModel(gltf: GLTF): ModelStats {
    this.clear()

    this.current = gltf.scene
    this.currentGltf = gltf
    this.clips = gltf.animations ?? []

    this.current.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })

    this.root.add(this.current)

    return collectStats(this.current, this.clips)
  }

  clear(): void {
    // Playback is owned by AnimationManager; this class only holds the clips.
    this.clips = []

    if (this.current) {
      disposeObject3D(this.current)
      this.current = null
    }

    this.currentGltf = null
  }

  dispose(): void {
    this.clear()
    this.root.removeFromParent()
  }
}

function collectStats(root: THREE.Object3D, clips: THREE.AnimationClip[]): ModelStats {
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  let objects = 0
  let meshes = 0
  let triangles = 0
  let vertices = 0

  root.traverse((object) => {
    objects += 1
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    meshes += 1
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    if (position) vertices += position.count
    if (geometry.index) {
      triangles += geometry.index.count / 3
    } else if (position) {
      triangles += position.count / 3
    }

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of meshMaterials) {
      if (!material) continue
      materials.add(material)
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture)
      }
    }
  })

  return {
    objects,
    meshes,
    triangles: Math.round(triangles),
    vertices,
    materials: materials.size,
    textures: textures.size,
    animations: clips.map((clip) => clip.name),
  }
}
