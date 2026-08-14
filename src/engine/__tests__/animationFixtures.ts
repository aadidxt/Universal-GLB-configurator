import * as THREE from 'three'

/** Quaternion keyframe values for a rotation sweep about one axis. */
export function quaternionTrack(
  target: string,
  axis: THREE.Vector3,
  degrees: number,
  steps = 8,
  duration = 2,
): THREE.QuaternionKeyframeTrack {
  const times: number[] = []
  const values: number[] = []
  const quaternion = new THREE.Quaternion()

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    times.push(t * duration)
    quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees) * t)
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  }

  return new THREE.QuaternionKeyframeTrack(`${target}.quaternion`, times, values)
}

export function positionTrack(
  target: string,
  from: [number, number, number],
  to: [number, number, number],
  duration = 1,
): THREE.VectorKeyframeTrack {
  return new THREE.VectorKeyframeTrack(`${target}.position`, [0, duration], [...from, ...to])
}

/**
 * Rack-like scene: a hinged door, a spinning fan, a sliding drawer, a button
 * with a tiny push, plus a decoy mesh literally named "Door" that has no
 * animation at all.
 */
export function buildAnimatedScene() {
  const scene = new THREE.Group()
  scene.name = 'Rack'

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 1), new THREE.MeshStandardMaterial())
  door.name = 'FrontDoor'
  // Hinge at the panel edge: origin offset from the geometry centre.
  door.geometry.translate(0, 0, 0.5)
  door.position.set(0, 0, -0.5)

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), new THREE.MeshStandardMaterial())
  handle.name = 'Handle'
  handle.position.set(0.05, 0, 0.9)
  door.add(handle)

  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), new THREE.MeshStandardMaterial())
  fan.name = 'FanAssembly'
  fan.position.set(1.5, 1, 0)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.1), new THREE.MeshStandardMaterial())
  blade.name = 'Blade_01'
  fan.add(blade)

  const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.6), new THREE.MeshStandardMaterial())
  drawer.name = 'ToolDrawer'
  drawer.position.set(-1.5, 0, 0)

  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), new THREE.MeshStandardMaterial())
  button.name = 'PowerButton'
  button.position.set(0.2, 1.4, 0.4)

  // Same name as a real door, but nothing animates it.
  const decoy = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 1), new THREE.MeshStandardMaterial())
  decoy.name = 'Door'
  decoy.position.set(3, 0, 0)

  const mystery = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial())
  mystery.name = 'XT_9931'
  mystery.position.set(0, 2.5, 0)

  scene.add(door, fan, drawer, button, decoy, mystery)

  const clips = [
    new THREE.AnimationClip('DoorOpen', 2, [
      quaternionTrack('FrontDoor', new THREE.Vector3(0, 1, 0), 95),
    ]),
    new THREE.AnimationClip('FanSpin', 1, [
      quaternionTrack('FanAssembly', new THREE.Vector3(0, 0, 1), 360, 12, 1),
    ]),
    new THREE.AnimationClip('DrawerSlide', 1, [
      positionTrack('ToolDrawer', [-1.5, 0, 0], [-1.5, 0, 0.6]),
    ]),
    new THREE.AnimationClip('Press', 0.4, [
      positionTrack('PowerButton', [0.2, 1.4, 0.4], [0.2, 1.4, 0.395], 0.4),
    ]),
    // Deliberately meaningless name and target.
    new THREE.AnimationClip('take_001', 1.5, [
      quaternionTrack('XT_9931', new THREE.Vector3(1, 0, 0), 40),
    ]),
  ]

  return { scene, door, handle, fan, blade, drawer, button, decoy, mystery, clips }
}
