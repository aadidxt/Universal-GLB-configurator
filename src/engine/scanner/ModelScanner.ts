import * as THREE from 'three'
import type {
  GeometryStats,
  MaterialEntry,
  ModelManifest,
  ModelStatistics,
  NodeEntry,
  Vec3,
} from './types'

export interface ScanOptions {
  /** Animation clips that shipped with the model, for statistics. */
  animations?: THREE.AnimationClip[]
  /** World bounds are per-node Box3 computations; skip on very large scenes. */
  computeWorldBounds?: boolean
}

export interface ScanResult {
  manifest: ModelManifest
  /** id -> live Object3D. Never put this in React state. */
  objects: Map<string, THREE.Object3D>
  /** id -> live Material. */
  materials: Map<string, THREE.Material>
}

/**
 * Walks a loaded gltf.scene and produces a fully typed manifest plus lookup maps.
 * Model-agnostic: nothing here knows about doors, fans, racks or any product.
 */
export function scanModel(root: THREE.Object3D, options: ScanOptions = {}): ScanResult {
  const computeWorldBounds = options.computeWorldBounds ?? true
  root.updateWorldMatrix(true, true)

  const nodes: Record<string, NodeEntry> = {}
  const order: string[] = []
  const objects = new Map<string, THREE.Object3D>()
  const materialObjects = new Map<string, THREE.Material>()
  const materials: Record<string, MaterialEntry> = {}
  const materialOrder: string[] = []
  const textures = new Set<string>()

  const stats: ModelStatistics = {
    objects: 0,
    meshes: 0,
    skinnedMeshes: 0,
    groups: 0,
    bones: 0,
    triangles: 0,
    vertices: 0,
    materials: 0,
    textures: 0,
    animations: options.animations?.length ?? 0,
    cameras: 0,
    lights: 0,
    unnamed: 0,
    maxDepth: 0,
  }

  const box = new THREE.Box3()

  const visit = (
    object: THREE.Object3D,
    parentId: string | null,
    depth: number,
    parentVisible: boolean,
    stableId: string,
  ) => {
    const id = object.uuid
    const mesh = object as THREE.Mesh & THREE.SkinnedMesh
    const isMesh = mesh.isMesh === true
    const isSkinnedMesh = (object as THREE.SkinnedMesh).isSkinnedMesh === true
    const isBone = (object as THREE.Bone).isBone === true
    const isLight = (object as THREE.Light).isLight === true
    const isCamera = (object as THREE.Camera).isCamera === true
    const isPointsOrLine = (object as THREE.Points).isPoints === true || (object as THREE.Line).isLine === true
    const isGroup = !isMesh && !isBone && !isLight && !isCamera && !isPointsOrLine

    const effectiveVisible = parentVisible && object.visible

    stats.objects += 1
    stats.maxDepth = Math.max(stats.maxDepth, depth)
    if (isMesh) stats.meshes += 1
    if (isSkinnedMesh) stats.skinnedMeshes += 1
    if (isBone) stats.bones += 1
    if (isLight) stats.lights += 1
    if (isCamera) stats.cameras += 1
    if (isGroup) stats.groups += 1
    if (!object.name) stats.unnamed += 1

    const materialIds: string[] = []
    if (isMesh || isPointsOrLine) {
      const list = toMaterialArray((object as THREE.Mesh).material)
      list.forEach((material, slot) => {
        materialIds.push(material.uuid)
        registerMaterial(material, id, slot)
      })
    }

    const geometry = isMesh || isPointsOrLine ? readGeometry(mesh.geometry) : null
    if (geometry) {
      stats.triangles += geometry.triangles
      stats.vertices += geometry.vertices
    }

    let worldBounds: NodeEntry['worldBounds'] = null
    if (computeWorldBounds) {
      box.makeEmpty()
      box.setFromObject(object, true)
      if (!box.isEmpty() && isFinite(box.min.x) && isFinite(box.max.x)) {
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        worldBounds = {
          min: box.min.toArray() as Vec3,
          max: box.max.toArray() as Vec3,
          center: center.toArray() as Vec3,
          size: size.toArray() as Vec3,
        }
      }
    }

    const morphNames = Object.keys(mesh.morphTargetDictionary ?? {})

    const entry: NodeEntry = {
      id,
      stableId,
      name: displayName(object),
      rawName: object.name ?? '',
      type: object.type,
      parentId,
      childIds: object.children.map((child) => child.uuid),
      depth,
      visible: object.visible,
      effectiveVisible,
      position: object.position.toArray() as Vec3,
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      quaternion: object.quaternion.toArray() as [number, number, number, number],
      scale: object.scale.toArray() as Vec3,
      isMesh,
      isGroup,
      isSkinnedMesh,
      isBone,
      isLight,
      isCamera,
      isRenderable: isMesh || isPointsOrLine,
      geometry,
      materialIds,
      hasMorphTargets: morphNames.length > 0,
      morphTargetNames: morphNames,
      userData: { ...(object.userData ?? {}) },
      worldBounds,
      worldPosition: object.getWorldPosition(new THREE.Vector3()).toArray() as Vec3,
      semantic: null,
    }

    nodes[id] = entry
    order.push(id)
    objects.set(id, object)

    object.children.forEach((child, index) => {
      visit(child, id, depth + 1, effectiveVisible, `${stableId}/${index}`)
    })
  }

  function registerMaterial(material: THREE.Material, objectId: string, slot: number) {
    const existing = materials[material.uuid]
    if (existing) {
      if (!existing.userIds.includes(objectId)) existing.userIds.push(objectId)
      return
    }

    materialObjects.set(material.uuid, material)
    materialOrder.push(material.uuid)
    materials[material.uuid] = describeMaterial(material, objectId, slot, textures)
  }

  root.children.forEach((child, index) => {
    visit(child, null, 0, root.visible, String(index))
  })

  stats.materials = materialOrder.length
  stats.textures = textures.size

  const manifest: ModelManifest = {
    nodes,
    order,
    rootIds: root.children.map((child) => child.uuid),
    materials,
    materialOrder,
    stats,
    animations: (options.animations ?? []).map((clip, index) => ({
      name: clip.name || `Clip ${index + 1}`,
      duration: clip.duration,
      tracks: clip.tracks.length,
    })),
  }

  return { manifest, objects, materials: materialObjects }
}

/** Stable, human-usable label for nodes that shipped without a name. */
export function displayName(object: THREE.Object3D): string {
  if (object.name) return object.name
  return `<${object.type}>`
}

export function toMaterialArray(material: THREE.Material | THREE.Material[] | undefined | null): THREE.Material[] {
  if (!material) return []
  return Array.isArray(material) ? material.filter(Boolean) : [material]
}

function readGeometry(geometry: THREE.BufferGeometry | undefined): GeometryStats | null {
  if (!geometry) return null

  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const vertices = position?.count ?? 0
  const triangles = geometry.index ? geometry.index.count / 3 : vertices / 3

  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bb = geometry.boundingBox

  return {
    vertices,
    triangles: Math.floor(triangles),
    groups: geometry.groups.length,
    attributes: Object.keys(geometry.attributes),
    indexed: geometry.index !== null,
    morphTargets: Object.keys(geometry.morphAttributes ?? {}).length,
    boundingBox: bb ? { min: bb.min.toArray() as Vec3, max: bb.max.toArray() as Vec3 } : null,
  }
}

/** Reads the properties the Inspector can edit, tolerating any material type. */
export function describeMaterial(
  material: THREE.Material,
  objectId?: string,
  _slot?: number,
  textureSink?: Set<string>,
): MaterialEntry {
  const any = material as THREE.MeshStandardMaterial
  const maps: string[] = []

  for (const [key, value] of Object.entries(material as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) {
      maps.push(key)
      textureSink?.add((value as THREE.Texture).uuid)
    }
  }

  return {
    id: material.uuid,
    name: material.name || `<${material.type}>`,
    type: material.type,
    color: any.color ? `#${any.color.getHexString()}` : null,
    opacity: material.opacity,
    transparent: material.transparent,
    metalness: typeof any.metalness === 'number' ? any.metalness : null,
    roughness: typeof any.roughness === 'number' ? any.roughness : null,
    emissive: any.emissive ? `#${any.emissive.getHexString()}` : null,
    emissiveIntensity: typeof any.emissiveIntensity === 'number' ? any.emissiveIntensity : null,
    maps: maps.sort(),
    side: material.side,
    userIds: objectId ? [objectId] : [],
  }
}
