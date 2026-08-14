import * as THREE from 'three'

export interface SceneNode {
  /** Stable within one loaded model — Object3D.uuid. */
  id: string
  name: string
  type: string
  children: SceneNode[]
}

/** Read-only snapshot of the imported hierarchy for the Outliner. */
export function buildSceneTree(root: THREE.Object3D): SceneNode[] {
  return root.children.map(toNode)
}

function toNode(object: THREE.Object3D): SceneNode {
  return {
    id: object.uuid,
    name: object.name || `(${object.type})`,
    type: object.type,
    children: object.children.map(toNode),
  }
}
