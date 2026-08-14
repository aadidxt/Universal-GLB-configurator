import * as THREE from 'three'

/**
 * Nested scene used across scanner/material tests:
 *
 * Root (Group)
 *  ├ Body (Group)
 *  │   ├ Panel (Mesh, sharedMat)
 *  │   └ Panel (Mesh, sharedMat)      <- duplicate name on purpose
 *  ├ <Mesh> (Mesh, unnamed, multiMat [sharedMat, uniqueMat])
 *  └ Rig (Bone) with child Bone
 */
export function buildTestScene() {
  const sharedMat = new THREE.MeshStandardMaterial({ name: 'Shared', color: 0xff0000, metalness: 0.2, roughness: 0.8 })
  const uniqueMat = new THREE.MeshStandardMaterial({ name: 'Unique', color: 0x00ff00 })

  const texture = new THREE.Texture()
  texture.needsUpdate = false
  sharedMat.map = texture

  const root = new THREE.Group()
  root.name = 'Root'

  const body = new THREE.Group()
  body.name = 'Body'
  root.add(body)

  const panelA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat)
  panelA.name = 'Panel'
  const panelB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat)
  panelB.name = 'Panel'
  panelB.position.set(2, 0, 0)
  body.add(panelA, panelB)

  const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [sharedMat, uniqueMat])
  multi.position.set(0, 3, 0)
  root.add(multi)

  const bone = new THREE.Bone()
  bone.name = 'Rig'
  const childBone = new THREE.Bone()
  childBone.name = 'RigTip'
  bone.add(childBone)
  root.add(bone)

  const scene = new THREE.Group()
  scene.add(root)

  return { scene, root, body, panelA, panelB, multi, bone, childBone, sharedMat, uniqueMat, texture }
}
