import * as THREE from 'three'

/**
 * Recursively frees every GPU resource owned by a subtree.
 * Textures are tracked in a set so shared maps are only released once.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()

  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh> & THREE.Object3D

    if (mesh.geometry) {
      mesh.geometry.dispose()
    }

    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        collectTextures(material, textures)
        material.dispose()
      }
    }
  })

  for (const texture of textures) {
    texture.dispose()
  }

  root.removeFromParent()
}

function collectTextures(material: THREE.Material, out: Set<THREE.Texture>): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) {
      out.add(value as THREE.Texture)
    }
  }
}
