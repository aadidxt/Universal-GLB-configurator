import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'
import type { MaterialEntry, NodeEntry } from '../engine/scanner/types'

/**
 * Editing surface for the material slots of one mesh.
 * Meshes with a material array get one block per slot, and every write goes
 * through the shared/isolate scope so unrelated parts never change by accident.
 */
export function MaterialControls({ node }: { node: NodeEntry }) {
  const manifest = useEditorStore((state) => state.manifest)
  const scope = useEditorStore((state) => state.materialScope)
  const setScope = useEditorStore((state) => state.setMaterialScope)

  if (node.materialIds.length === 0) {
    return <p className="placeholder">This object has no material.</p>
  }

  return (
    <div className="material-controls">
      <div className="scope-switch">
        <span className="scope-label">Color edits apply to</span>
        <div className="segmented">
          <button
            type="button"
            className={`segment${scope === 'isolate' ? ' segment--active' : ''}`}
            onClick={() => setScope('isolate')}
            title="Clone the material so only this object changes"
          >
            Selected only
          </button>
          <button
            type="button"
            className={`segment${scope === 'shared' ? ' segment--active' : ''}`}
            onClick={() => setScope('shared')}
            title="Write to the shared material — every object using it changes"
          >
            Shared material
          </button>
        </div>
      </div>

      {node.materialIds.map((materialId, slot) => {
        const material = manifest.materials[materialId]
        if (!material) return null
        return (
          <MaterialSlot
            key={`${materialId}-${slot}`}
            node={node}
            material={material}
            slot={slot}
            slotCount={node.materialIds.length}
          />
        )
      })}
    </div>
  )
}

function MaterialSlot({
  node,
  material,
  slot,
  slotCount,
}: {
  node: NodeEntry
  material: MaterialEntry
  slot: number
  slotCount: number
}) {
  const engine = useEngine()
  const scope = useEditorStore((state) => state.materialScope)

  const otherUsers = material.userIds.filter((id) => id !== node.id).length
  const shared = otherUsers > 0

  return (
    <div className="material-slot">
      <div className="material-slot-head">
        <span className="material-name" title={material.name}>
          {slotCount > 1 ? `Slot ${slot}: ` : ''}
          {material.name}
        </span>
        <span className="material-type">{material.type}</span>
      </div>

      {shared && (
        <div className={`shared-warning${scope === 'shared' ? ' shared-warning--danger' : ''}`}>
          Shared by {material.userIds.length} objects.{' '}
          {scope === 'shared'
            ? `Editing changes all ${material.userIds.length}.`
            : 'Editing clones it for this object only.'}
          <button
            type="button"
            className="link-button"
            onClick={() => useEditorStore.getState().setMaterialScope(scope === 'shared' ? 'isolate' : 'shared')}
          >
            {scope === 'shared' ? 'Switch to selected only' : 'Switch to shared'}
          </button>
        </div>
      )}

      {material.maps.length > 0 && (
        <div className="material-maps">
          Textures kept: {material.maps.join(', ')} — color tints the texture.
        </div>
      )}

      <div className="material-fields">
        {material.color !== null && (
          <label className="field">
            <span>Base color</span>
            <span className="color-field">
              <input
                type="color"
                value={material.color}
                onChange={(event) => engine.editMaterial(node.id, slot, { color: event.target.value })}
              />
              <code>{material.color}</code>
            </span>
          </label>
        )}

        {material.emissive !== null && (
          <label className="field">
            <span>Emissive</span>
            <span className="color-field">
              <input
                type="color"
                value={material.emissive}
                onChange={(event) => engine.editMaterial(node.id, slot, { emissive: event.target.value })}
              />
              <code>{material.emissive}</code>
            </span>
          </label>
        )}

        <SliderField
          label="Opacity"
          value={material.opacity}
          onChange={(value) => engine.editMaterial(node.id, slot, { opacity: value })}
        />

        {material.metalness !== null && (
          <SliderField
            label="Metalness"
            value={material.metalness}
            onChange={(value) => engine.editMaterial(node.id, slot, { metalness: value })}
          />
        )}

        {material.roughness !== null && (
          <SliderField
            label="Roughness"
            value={material.roughness}
            onChange={(value) => engine.editMaterial(node.id, slot, { roughness: value })}
          />
        )}

        {material.emissiveIntensity !== null && (
          <SliderField
            label="Emissive int."
            value={material.emissiveIntensity}
            max={4}
            onChange={(value) => engine.editMaterial(node.id, slot, { emissiveIntensity: value })}
          />
        )}

        <label className="field field--inline">
          <span>Transparent</span>
          <input
            type="checkbox"
            checked={material.transparent}
            onChange={(event) => engine.editMaterial(node.id, slot, { transparent: event.target.checked })}
          />
        </label>
      </div>
    </div>
  )
}

function SliderField({
  label,
  value,
  max = 1,
  onChange,
}: {
  label: string
  value: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="slider-field">
        <input
          type="range"
          min={0}
          max={max}
          step={0.01}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <code>{value.toFixed(2)}</code>
      </span>
    </label>
  )
}
