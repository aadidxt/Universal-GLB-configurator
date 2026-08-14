import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export interface ViewportOptions {
  /** Upper bound on devicePixelRatio, keeps 4K/retina fill-rate sane. */
  maxPixelRatio?: number
  backgroundColor?: number
}

/**
 * Owns the whole Three.js lifecycle for one canvas: renderer, scene, camera,
 * controls, lights, grid, resize observation and the render loop.
 * Framework-agnostic on purpose — React only mounts and disposes it.
 */
export class Viewport {
  readonly container: HTMLElement
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  /** Everything that is not the imported model (grid, lights) lives here. */
  readonly helpers: THREE.Group

  private readonly maxPixelRatio: number
  private readonly resizeObserver: ResizeObserver
  private readonly grid: THREE.GridHelper
  private readonly composer: EffectComposer
  private readonly outlinePass: OutlinePass
  private readonly composerTarget: THREE.WebGLRenderTarget
  private readonly environment: THREE.Texture
  private readonly onBeforeRender = new Set<(delta: number) => void>()
  private readonly timer = new THREE.Timer()
  private animationHandle = 0
  private disposed = false

  constructor(container: HTMLElement, options: ViewportOptions = {}) {
    this.container = container
    this.maxPixelRatio = options.maxPixelRatio ?? 2

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(options.backgroundColor ?? 0x1a1d21)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    this.camera.position.set(4, 3, 5)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true

    this.helpers = new THREE.Group()
    this.helpers.name = '__helpers'
    this.scene.add(this.helpers)

    this.grid = new THREE.GridHelper(20, 20, 0x4a5058, 0x2c3138)
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]
    for (const material of gridMaterials) {
      material.transparent = true
      material.opacity = 0.6
    }
    this.helpers.add(this.grid)

    // Neutral studio lighting: IBL for material response plus a key light for shape.
    this.environment = buildNeutralEnvironment(this.renderer)
    this.scene.environment = this.environment

    const hemisphere = new THREE.HemisphereLight(0xbfd4e6, 0x30302c, 1.6)
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(5, 10, 7.5)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(-6, 4, -5)
    this.helpers.add(hemisphere, key, fill)

    // Post chain: MSAA target keeps edges clean, OutlinePass draws the selection,
    // OutputPass applies tone mapping + sRGB exactly once at the end.
    this.composerTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
    })
    this.composer = new EffectComposer(this.renderer, this.composerTarget)
    this.composer.addPass(new RenderPass(this.scene, this.camera))

    this.outlinePass = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.camera)
    this.outlinePass.edgeStrength = 4
    this.outlinePass.edgeGlow = 0
    this.outlinePass.edgeThickness = 1.4
    this.outlinePass.visibleEdgeColor.set('#ffa03c')
    this.outlinePass.hiddenEdgeColor.set('#7a4a17')
    this.composer.addPass(this.outlinePass)
    this.composer.addPass(new OutputPass())

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.start()
  }

  /** Registers a per-frame callback (used later by animation/selection managers). */
  addFrameCallback(callback: (delta: number) => void): () => void {
    this.onBeforeRender.add(callback)
    return () => this.onBeforeRender.delete(callback)
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible
  }

  /** Objects drawn with a selection outline. Pass [] to clear. */
  setOutlinedObjects(objects: THREE.Object3D[]): void {
    this.outlinePass.selectedObjects = objects
  }

  resize(): void {
    if (this.disposed) return
    const width = Math.max(this.container.clientWidth, 1)
    const height = Math.max(this.container.clientHeight, 1)
    const pixelRatio = Math.min(window.devicePixelRatio, this.maxPixelRatio)

    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
    this.outlinePass.setSize(width * pixelRatio, height * pixelRatio)
  }

  private start(): void {
    const loop = () => {
      this.animationHandle = requestAnimationFrame(loop)
      this.timer.update()
      const delta = this.timer.getDelta()
      for (const callback of this.onBeforeRender) callback(delta)
      this.controls.update()
      this.composer.render(delta)
    }
    this.animationHandle = requestAnimationFrame(loop)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    cancelAnimationFrame(this.animationHandle)
    this.onBeforeRender.clear()
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.outlinePass.dispose()
    this.composer.dispose()
    this.composerTarget.dispose()
    this.grid.dispose()
    this.environment.dispose()
    this.scene.environment = null
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

/** Small procedural room environment — no external HDR asset, so it works offline. */
function buildNeutralEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const scene = new THREE.Scene()

  const geometry = new THREE.BoxGeometry()
  geometry.deleteAttribute('uv')

  const room = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x8a8f96, roughness: 1, metalness: 0 }),
  )
  room.scale.setScalar(10)
  scene.add(room)

  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const positions: Array<[number, number, number, number, number, number]> = [
    [0, 4.9, 0, 6, 0.1, 6],
    [-4.5, 2, 0, 0.1, 4, 6],
    [4.5, 2, 0, 0.1, 4, 6],
  ]
  for (const [x, y, z, sx, sy, sz] of positions) {
    const light = new THREE.Mesh(geometry, lightMaterial)
    light.position.set(x, y, z)
    light.scale.set(sx, sy, sz)
    scene.add(light)
  }

  const texture = pmrem.fromScene(scene, 0.04).texture

  geometry.dispose()
  lightMaterial.dispose()
  room.material.dispose()
  pmrem.dispose()

  return texture
}
