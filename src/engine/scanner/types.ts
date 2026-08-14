/**
 * Serializable description of a loaded GLB. Everything the UI renders comes from
 * here — React never walks the Three.js graph directly, so state stays cheap to
 * diff and the scene graph stays the single source of truth for the engine.
 */

export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

export interface GeometryStats {
  vertices: number
  triangles: number
  groups: number
  attributes: string[]
  indexed: boolean
  morphTargets: number
  boundingBox: { min: Vec3; max: Vec3 } | null
}

export interface NodeEntry {
  /** Object3D.uuid. Names are NOT unique in glTF and are never used as keys. */
  id: string
  /**
   * Reload-stable key: the child-index path from the scene root ("2/0/1").
   * uuids are regenerated on every parse, so saved projects key off this.
   */
  stableId: string
  /** Display label — falls back to a type-derived label for unnamed nodes. */
  name: string
  /** Empty string when the glTF node had no name. */
  rawName: string
  type: string
  parentId: string | null
  childIds: string[]
  depth: number
  /** Own visibility flag. */
  visible: boolean
  /** False when any ancestor is hidden. */
  effectiveVisible: boolean
  position: Vec3
  rotation: Vec3
  quaternion: Vec4
  scale: Vec3
  isMesh: boolean
  isGroup: boolean
  isSkinnedMesh: boolean
  isBone: boolean
  isLight: boolean
  isCamera: boolean
  /** Raycastable geometry — meshes, skinned meshes, points, lines. */
  isRenderable: boolean
  geometry: GeometryStats | null
  materialIds: string[]
  hasMorphTargets: boolean
  morphTargetNames: string[]
  userData: Record<string, unknown>
  worldBounds: { min: Vec3; max: Vec3; center: Vec3; size: Vec3 } | null
  /** Object origin in world space — pivot evidence for the semantic detector. */
  worldPosition: Vec3 | null
  /** Reserved for Phase 3 semantic detection (doors, fans, …). Always null here. */
  semantic: string | null
}

export interface MaterialEntry {
  /** Material.uuid. */
  id: string
  name: string
  type: string
  /** Hex string (#rrggbb) when the material exposes `.color`, else null. */
  color: string | null
  opacity: number
  transparent: boolean
  metalness: number | null
  roughness: number | null
  emissive: string | null
  emissiveIntensity: number | null
  /** Texture slot names present on the material, e.g. ["map", "normalMap"]. */
  maps: string[]
  side: number
  /** Object IDs that reference this material. */
  userIds: string[]
}

export interface ModelStatistics {
  objects: number
  meshes: number
  skinnedMeshes: number
  groups: number
  bones: number
  triangles: number
  vertices: number
  materials: number
  textures: number
  animations: number
  cameras: number
  lights: number
  unnamed: number
  maxDepth: number
}

export interface ModelManifest {
  nodes: Record<string, NodeEntry>
  /** Depth-first order — lets the UI build rows without re-walking children. */
  order: string[]
  rootIds: string[]
  materials: Record<string, MaterialEntry>
  materialOrder: string[]
  stats: ModelStatistics
  animations: { name: string; duration: number; tracks: number }[]
}

export const EMPTY_MANIFEST: ModelManifest = {
  nodes: {},
  order: [],
  rootIds: [],
  materials: {},
  materialOrder: [],
  stats: {
    objects: 0,
    meshes: 0,
    skinnedMeshes: 0,
    groups: 0,
    bones: 0,
    triangles: 0,
    vertices: 0,
    materials: 0,
    textures: 0,
    animations: 0,
    cameras: 0,
    lights: 0,
    unnamed: 0,
    maxDepth: 0,
  },
  animations: [],
}
