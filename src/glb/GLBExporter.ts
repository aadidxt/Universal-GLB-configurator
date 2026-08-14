import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export interface ExportResult {
  blob: Blob
  byteLength: number
}

/**
 * Writes the live scene — with every edit, pivot proxy and baked clip — into a
 * new binary glTF. Hidden objects are included so a "hide" in the editor does
 * not silently delete geometry from the exported file.
 */
export function exportSceneToGLB(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => {
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error('Exporter returned JSON instead of a binary GLB'))
          return
        }
        resolve({ blob: new Blob([result], { type: 'model/gltf-binary' }), byteLength: result.byteLength })
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, animations, onlyVisible: false, includeCustomExtensions: true },
    )
  })
}

/** Triggers a browser download for an exported GLB. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
