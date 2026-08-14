import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { hashBytes } from '../project/schema'

export class GLBLoadError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'GLBLoadError'
    this.detail = detail
  }
}

export interface GLBFileInfo {
  name: string
  size: number
  /** Content hash — how a saved project finds "the same model" again. */
  hash: string
}

const GLB_MAGIC = 0x46546c67 // 'glTF'
const MAX_SIZE_BYTES = 1024 * 1024 * 1024 // 1 GB guard against accidental huge drops

let loader: GLTFLoader | null = null

function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
  }
  return loader
}

/** True when the extension looks like a glTF binary container. */
export function isGLBFile(file: File): boolean {
  return /\.glb$/i.test(file.name)
}

/** Picks .glb files out of a DataTransfer, ignoring directories and other types. */
export function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files ?? [])
}

/**
 * Reads a local File into memory and parses it as GLB. Nothing leaves the browser.
 * Every failure path (empty, wrong extension, wrong magic, corrupt payload)
 * throws GLBLoadError with a message meant for the UI.
 */
export async function loadGLBFromFile(file: File): Promise<{ gltf: GLTF; info: GLBFileInfo }> {
  if (!file) {
    throw new GLBLoadError('No file provided.')
  }

  if (!isGLBFile(file)) {
    throw new GLBLoadError(`"${file.name}" is not a .glb file. Only binary glTF (.glb) is supported.`)
  }

  if (file.size === 0) {
    throw new GLBLoadError(`"${file.name}" is empty (0 bytes).`)
  }

  if (file.size > MAX_SIZE_BYTES) {
    throw new GLBLoadError(`"${file.name}" is larger than the 1 GB import limit.`)
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch (error) {
    throw new GLBLoadError(`Could not read "${file.name}" from disk.`, error)
  }

  if (buffer.byteLength < 12) {
    throw new GLBLoadError(`"${file.name}" is too small to be a valid GLB container.`)
  }

  const header = new DataView(buffer)
  if (header.getUint32(0, true) !== GLB_MAGIC) {
    throw new GLBLoadError(`"${file.name}" is not a valid GLB file (bad glTF header).`)
  }

  const gltf = await parseGLB(buffer, file.name)
  return { gltf, info: { name: file.name, size: file.size, hash: hashBytes(buffer) } }
}

function parseGLB(buffer: ArrayBuffer, fileName: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    try {
      getLoader().parse(
        buffer,
        '',
        (gltf) => {
          if (!gltf.scene) {
            reject(new GLBLoadError(`"${fileName}" contains no scene to display.`))
            return
          }
          resolve(gltf)
        },
        (error) => {
          reject(new GLBLoadError(describeParseError(fileName, error), error))
        },
      )
    } catch (error) {
      reject(new GLBLoadError(describeParseError(fileName, error), error))
    }
  })
}

function describeParseError(fileName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (/KHR_draco/i.test(message) || /DRACOLoader/i.test(message)) {
    return `"${fileName}" uses Draco compression, which is not enabled in this build.`
  }
  if (/no DRACOLoader|no KTX2Loader/i.test(message)) {
    return `"${fileName}" uses an extension that is not enabled in this build: ${message}`
  }
  return `Failed to parse "${fileName}": ${message}`
}
