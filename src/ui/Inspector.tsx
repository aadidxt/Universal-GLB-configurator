import { useState } from 'react'
import { interactionsForObject, useEditorStore } from '../state/editorStore'
import { InteractionEditor } from './InteractionEditor'
import type { InteractionDefinition } from '../engine/interaction/types'
import { useEngine } from '../state/useEngine'
import { MaterialControls } from './MaterialControls'
import type { NodeEntry } from '../engine/scanner/types'
import { SEMANTIC_LABELS } from '../engine/semantic/types'

export function Inspector() {
  const engine = useEngine()
  const manifest = useEditorStore((state) => state.manifest)
  const primaryId = useEditorStore((state) => state.primaryId)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const node = primaryId ? manifest.nodes[primaryId] : null

  return (
    <aside className="panel panel--right">
      <div className="panel-header">
        Inspector
        {selectedIds.length > 1 && <span className="panel-count">{selectedIds.length}</span>}
      </div>

      <div className="panel-body">
        {!node ? (
          <p className="placeholder">
            {manifest.order.length === 0 ? 'No model loaded.' : 'Select an object in the viewport or Outliner.'}
          </p>
        ) : (
          <>
            <div className="inspector-head">
              <input
                className="inspector-title-input"
                value={node.name}
                title="Rename (undoable)"
                onChange={(event) => engine.renameObject(node.id, event.target.value)}
              />
              <div className="inspector-subtitle">
                {node.type}
                {node.rawName ? '' : ' · unnamed in file'}
              </div>
              <div className="inspector-actions">
                <button type="button" className="button" onClick={() => engine.focusObject(node.id)}>
                  Focus
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => engine.setObjectVisible(node.id, !node.visible)}
                >
                  {node.visible ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <Section title="Object">
              <Prop label="Parent" value={node.parentId ? (manifest.nodes[node.parentId]?.name ?? '—') : '(scene root)'} />
              <Prop label="Children" value={String(node.childIds.length)} />
              <Prop label="Depth" value={String(node.depth)} />
              <Prop label="Visible" value={node.visible ? (node.effectiveVisible ? 'yes' : 'yes (parent hidden)') : 'no'} />
              <Prop label="ID" value={node.id} />
            </Section>

            <Section title="Transform">
              <Vector label="Position" values={node.position} />
              <Vector label="Rotation°" values={node.rotation.map(toDegrees) as [number, number, number]} />
              <Vector label="Scale" values={node.scale} />
            </Section>

            {node.geometry && (
              <Section title="Geometry">
                <Prop label="Vertices" value={node.geometry.vertices.toLocaleString()} />
                <Prop label="Triangles" value={node.geometry.triangles.toLocaleString()} />
                <Prop label="Indexed" value={node.geometry.indexed ? 'yes' : 'no'} />
                <Prop label="Groups" value={String(node.geometry.groups)} />
                <Prop label="Attributes" value={node.geometry.attributes.join(', ')} />
                {node.hasMorphTargets && (
                  <Prop label="Morph targets" value={node.morphTargetNames.join(', ') || String(node.geometry.morphTargets)} />
                )}
              </Section>
            )}

            {node.worldBounds && (
              <Section title="World bounds">
                <Vector label="Size" values={node.worldBounds.size} />
                <Vector label="Center" values={node.worldBounds.center} />
              </Section>
            )}

            <CapabilitySection nodeId={node.id} />

            <InteractionsSection nodeId={node.id} />

            {node.isRenderable && (
              <Section title="Material">
                <MaterialControls node={node} />
              </Section>
            )}

            {Object.keys(node.userData).length > 0 && (
              <Section title="userData / extras">
                <pre className="userdata">{JSON.stringify(node.userData, null, 2)}</pre>
              </Section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}


/** Manual interactions attached to the selected object, plus the add/edit form. */
function InteractionsSection({ nodeId }: { nodeId: string }) {
  const engine = useEngine()
  const interactions = useEditorStore((state) => state.interactions)
  const [editing, setEditing] = useState<InteractionDefinition | null>(null)
  const [adding, setAdding] = useState(false)

  const mine = interactionsForObject(interactions, nodeId)

  return (
    <section className="inspector-section">
      <h3 className="inspector-section-title">Interactions</h3>

      <div className="inspector-clips">
        {mine.length === 0 && !adding && (
          <p className="placeholder">
            No manual interaction yet. Add one to make this part operable even without animation data.
          </p>
        )}

        {mine.map((interaction) => (
          <div key={interaction.id} className="control-row">
            <span className="control-label" title={interaction.name}>
              {interaction.name}
            </span>
            <span className="muted">{interaction.config.kind}</span>
            <button type="button" className="button" onClick={() => engine.toggleInteraction(interaction.id)}>
              Test
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setAdding(false)
                setEditing(interaction)
              }}
            >
              Edit
            </button>
            <button type="button" className="button" onClick={() => engine.deleteInteraction(interaction.id)}>
              Remove
            </button>
          </div>
        ))}

        {!adding && !editing && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}
          >
            Add Interaction
          </button>
        )}
      </div>

      {(adding || editing) && (
        <InteractionEditor
          key={editing?.id ?? 'new'}
          objectId={nodeId}
          existing={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}

/** Everything the capability manifest knows about the selected object. */
function CapabilitySection({ nodeId }: { nodeId: string }) {
  const engine = useEngine()
  const capabilities = useEditorStore((state) => state.capabilities)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const entry = capabilities.entries[nodeId]
  if (!entry) return null

  const clips = entry.clipIds
    .map((clipId) => capabilities.animation.clips.find((clip) => clip.id === clipId))
    .filter((clip): clip is NonNullable<typeof clip> => !!clip)

  return (
    <section className="inspector-section">
      <h3 className="inspector-section-title">Capabilities</h3>
      <dl className="props">
        <Prop
          label="Semantic"
          value={`${SEMANTIC_LABELS[entry.semantic]} · ${Math.round(entry.confidence * 100)}%${
            entry.operable ? '' : ' (candidate)'
          }`}
        />
        <Prop
          label="Can"
          value={[
            entry.selectable ? 'select' : null,
            entry.recolorable ? 'recolor' : null,
            entry.transformable ? 'transform' : null,
            entry.animated ? 'animate' : null,
          ]
            .filter(Boolean)
            .join(', ')}
        />
        {entry.animated && <Prop label="Properties" value={entry.animatedProperties.join(', ')} />}
      </dl>

      {entry.reasons.length > 0 && (
        <ul className="reasons">
          {entry.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}

      {clips.length > 0 && (
        <div className="inspector-clips">
          {clips.map((clip) => (
            <div key={clip.id} className="control-row">
              <span className="control-label" title={clip.name}>
                {clip.name}
              </span>
              <button type="button" className="button" onClick={() => engine.toggleClip(clip.id)}>
                Play
              </button>
              <button type="button" className="button" onClick={() => engine.stopClip(clip.id)}>
                Stop
              </button>
              <button type="button" className="button" onClick={() => setActiveTab('animations')}>
                Panel
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <h3 className="inspector-section-title">{title}</h3>
      <dl className="props">{children}</dl>
    </section>
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

function Vector({ label, values }: { label: string; values: NodeEntry['position'] }) {
  return (
    <div className="prop">
      <dt>{label}</dt>
      <dd className="vector">
        {values.map((value, index) => (
          <code key={index}>{formatNumber(value)}</code>
        ))}
      </dd>
    </div>
  )
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  return value.toFixed(3)
}
