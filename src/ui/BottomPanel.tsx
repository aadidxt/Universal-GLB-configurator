import { useMemo } from 'react'
import type { ConfiguratorCategory } from '../engine/capability/types'
import { formatBytes, useEditorStore, type BottomTab } from '../state/editorStore'
import { useEngine } from '../state/useEngine'
import { MaterialControls } from './MaterialControls'
import { AnimationsPanel } from './AnimationsPanel'
import { ConfiguratorPanel } from './ConfiguratorPanel'
import { RotationPanel } from './RotationPanel'

const CONFIG_CATEGORIES: ConfiguratorCategory[] = ['doors', 'cooling', 'drawers', 'switches', 'other']

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'configurator', label: 'Configurator' },
  { id: 'animations', label: 'Animations' },
  { id: 'materials', label: 'Materials' },
  { id: 'info', label: 'Model Info' },
  { id: 'rotation', label: 'Rotation' },
]

export function BottomPanel() {
  const activeTab = useEditorStore((state) => state.activeTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const manifest = useEditorStore((state) => state.manifest)
  const model = useEditorStore((state) => state.model)
  const loadState = useEditorStore((state) => state.loadState)
  const error = useEditorStore((state) => state.error)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const capabilities = useEditorStore((state) => state.capabilities)
  const saveState = useEditorStore((state) => state.saveState)
  const lastSavedAt = useEditorStore((state) => state.lastSavedAt)
  const projectMessage = useEditorStore((state) => state.projectMessage)
  const rotationControls = useEditorStore(
    (state) => state.interactions.filter((entry) => entry.config.kind === 'rotateBetween').length,
  )
  const configurable = CONFIG_CATEGORIES.reduce(
    (total, category) => total + capabilities.categories[category].length,
    0,
  )

  return (
    <section className="bottom-panel">
      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab${activeTab === tab.id ? ' tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'animations' && manifest.animations.length > 0 && (
              <span className="tab-badge">{manifest.animations.length}</span>
            )}
            {tab.id === 'materials' && manifest.materialOrder.length > 0 && (
              <span className="tab-badge">{manifest.materialOrder.length}</span>
            )}
            {tab.id === 'configurator' && configurable > 0 && <span className="tab-badge">{configurable}</span>}
            {tab.id === 'rotation' && rotationControls > 0 && <span className="tab-badge">{rotationControls}</span>}
          </button>
        ))}
      </nav>

      <div className="bottom-body">
        {activeTab === 'info' && <ModelInfo />}
        {activeTab === 'configurator' && <ConfiguratorPanel />}
        {activeTab === 'animations' && <AnimationsPanel />}
        {activeTab === 'materials' && <MaterialsTab />}
        {activeTab === 'rotation' && <RotationPanel />}
      </div>

      <footer className="statusbar">
        <span>State: {loadState}</span>
        {model && <span>{model.name}</span>}
        {model && <span>{formatBytes(model.size)}</span>}
        {manifest.order.length > 0 && (
          <span>
            {manifest.stats.objects} objects · {manifest.stats.meshes} meshes · {manifest.stats.materials} materials
          </span>
        )}
        {selectedIds.length > 0 && <span>{selectedIds.length} selected</span>}
        {model && (
          <span className={`save-state save-state--${saveState}`}>
            {saveState === 'saved' && lastSavedAt
              ? `Config saved ${new Date(lastSavedAt).toLocaleTimeString()}`
              : saveState === 'dirty'
                ? 'Config: unsaved changes'
                : saveState === 'saving'
                  ? 'Saving config…'
                  : saveState === 'error'
                    ? 'Config save failed'
                    : 'Config not saved'}
          </span>
        )}
        {projectMessage && <span className="muted">{projectMessage}</span>}
        {error && <span className="statusbar-error">{error}</span>}
      </footer>
    </section>
  )
}

function MaterialsTab() {
  const engine = useEngine()
  const manifest = useEditorStore((state) => state.manifest)
  const primaryId = useEditorStore((state) => state.primaryId)
  const node = primaryId ? manifest.nodes[primaryId] : null

  const rows = useMemo(
    () => manifest.materialOrder.map((id) => manifest.materials[id]).filter(Boolean),
    [manifest.materialOrder, manifest.materials],
  )

  if (rows.length === 0) return <Placeholder text="No materials in this model." />

  return (
    <div className="materials-tab">
      <div className="materials-list">
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Type</th>
              <th>Color</th>
              <th>Opacity</th>
              <th>Users</th>
              <th>Maps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((material) => (
              <tr
                key={material.id}
                className={node && node.materialIds.includes(material.id) ? 'row--active' : ''}
                onClick={() => {
                  const firstUser = material.userIds[0]
                  if (firstUser) engine.select(firstUser)
                }}
              >
                <td title={material.name}>{material.name}</td>
                <td>{material.type}</td>
                <td>
                  {material.color && (
                    <span className="swatch-row">
                      <span className="swatch" style={{ background: material.color }} />
                      <code>{material.color}</code>
                    </span>
                  )}
                </td>
                <td>{material.opacity.toFixed(2)}</td>
                <td>{material.userIds.length}</td>
                <td>{material.maps.length ? material.maps.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="materials-editor">
        {node && node.isRenderable ? (
          <MaterialControls node={node} />
        ) : (
          <Placeholder text="Select a mesh to edit its material." />
        )}
      </div>
    </div>
  )
}

function ModelInfo() {
  const model = useEditorStore((state) => state.model)
  const manifest = useEditorStore((state) => state.manifest)
  if (!model) return <Placeholder text="No model loaded." />

  const { stats } = manifest
  const bounds = model.bounds

  return (
    <dl className="props props--grid">
      <Prop label="File" value={model.name} />
      <Prop label="Size" value={formatBytes(model.size)} />
      <Prop label="Loaded" value={new Date(model.loadedAt).toLocaleTimeString()} />
      <Prop label="Objects" value={String(stats.objects)} />
      <Prop label="Meshes" value={String(stats.meshes)} />
      <Prop label="Skinned meshes" value={String(stats.skinnedMeshes)} />
      <Prop label="Groups" value={String(stats.groups)} />
      <Prop label="Bones" value={String(stats.bones)} />
      <Prop label="Triangles" value={stats.triangles.toLocaleString()} />
      <Prop label="Vertices" value={stats.vertices.toLocaleString()} />
      <Prop label="Materials" value={String(stats.materials)} />
      <Prop label="Textures" value={String(stats.textures)} />
      <Prop label="Animations" value={String(stats.animations)} />
      <Prop label="Cameras" value={String(stats.cameras)} />
      <Prop label="Lights" value={String(stats.lights)} />
      <Prop label="Unnamed objects" value={String(stats.unnamed)} />
      <Prop label="Max depth" value={String(stats.maxDepth)} />
      <Prop
        label="Size (X × Y × Z)"
        value={bounds ? bounds.size.map((value) => value.toFixed(3)).join(' × ') : 'no geometry'}
      />
      <Prop label="Center" value={bounds ? bounds.center.map((value) => value.toFixed(3)).join(', ') : '—'} />
    </dl>
  )
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <div className="prop">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return <p className="placeholder">{text}</p>
}
