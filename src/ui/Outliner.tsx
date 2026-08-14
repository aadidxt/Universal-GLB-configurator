import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import type { ModelManifest, NodeEntry } from '../engine/scanner/types'
import { useEditorStore } from '../state/editorStore'
import { useEngine } from '../state/useEngine'

const ROW_HEIGHT = 22
const OVERSCAN = 8

interface Row {
  id: string
  depth: number
  hasChildren: boolean
  expanded: boolean
  matched: boolean
}

export function Outliner() {
  const engine = useEngine()
  const manifest = useEditorStore((state) => state.manifest)
  const expandedIds = useEditorStore((state) => state.expandedIds)
  const search = useEditorStore((state) => state.search)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const primaryId = useEditorStore((state) => state.primaryId)
  const setSearch = useEditorStore((state) => state.setSearch)
  const setExpanded = useEditorStore((state) => state.setExpanded)
  const expandAll = useEditorStore((state) => state.expandAll)
  const collapseAll = useEditorStore((state) => state.collapseAll)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const { matches, forcedOpen } = useMemo(() => computeSearch(manifest, search), [manifest, search])

  const rows = useMemo(
    () => buildRows(manifest, expandedIds, search ? forcedOpen : null, matches),
    [manifest, expandedIds, search, forcedOpen, matches],
  )

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight))
    observer.observe(element)
    setViewportHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  // Keep the active object on screen when selection comes from the viewport.
  useEffect(() => {
    if (!primaryId || !scrollRef.current) return
    const index = rows.findIndex((row) => row.id === primaryId)
    if (index < 0) return

    const element = scrollRef.current
    const top = index * ROW_HEIGHT
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2)
    }
  }, [primaryId, rows])

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  const visibleRows = rows.slice(startIndex, endIndex)

  const onSelect = useCallback(
    (id: string, event: React.MouseEvent) => {
      engine.select(id, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey })
    },
    [engine],
  )

  const hasModel = manifest.order.length > 0

  return (
    <aside className="panel panel--left">
      <div className="panel-header">
        Outliner
        {hasModel && <span className="panel-count">{manifest.order.length}</span>}
      </div>

      <div className="outliner-tools">
        <input
          type="search"
          className="input"
          placeholder="Search objects…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={!hasModel}
        />
        <button type="button" className="icon-button" title="Expand all" onClick={expandAll} disabled={!hasModel}>
          ⊞
        </button>
        <button type="button" className="icon-button" title="Collapse all" onClick={collapseAll} disabled={!hasModel}>
          ⊟
        </button>
      </div>

      {search && (
        <div className="outliner-searchinfo">
          {matches.size} match{matches.size === 1 ? '' : 'es'}
        </div>
      )}

      <div
        className="panel-body outliner-scroll"
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {!hasModel ? (
          <p className="placeholder">Load a GLB to see its hierarchy.</p>
        ) : (
          <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
            {visibleRows.map((row, index) => {
              const node = manifest.nodes[row.id]
              return (
                <OutlinerRow
                  key={row.id}
                  node={node}
                  row={row}
                  top={(startIndex + index) * ROW_HEIGHT}
                  selected={selectedSet.has(row.id)}
                  primary={primaryId === row.id}
                  onSelect={onSelect}
                  onToggleExpand={setExpanded}
                  onToggleVisible={engine.setObjectVisible}
                  onFocus={engine.focusObject}
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="panel-footer">
        {selectedIds.length > 0 ? `${selectedIds.length} selected · double-click to focus` : 'Click to select'}
      </div>
    </aside>
  )
}

interface RowProps {
  node: NodeEntry
  row: Row
  top: number
  selected: boolean
  primary: boolean
  onSelect: (id: string, event: React.MouseEvent) => void
  onToggleExpand: (id: string, expanded: boolean) => void
  onToggleVisible: (id: string, visible: boolean) => void
  onFocus: (id: string) => void
}

const OutlinerRow = memo(function OutlinerRow({
  node,
  row,
  top,
  selected,
  primary,
  onSelect,
  onToggleExpand,
  onToggleVisible,
  onFocus,
}: RowProps) {
  const className = [
    'tree-row',
    selected ? 'tree-row--selected' : '',
    primary ? 'tree-row--primary' : '',
    row.matched ? 'tree-row--match' : '',
    node.effectiveVisible ? '' : 'tree-row--hidden',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={{ top, height: ROW_HEIGHT, paddingLeft: row.depth * 12 + 4 }}
      onClick={(event) => onSelect(node.id, event)}
      onDoubleClick={() => onFocus(node.id)}
      title={`${node.name} — ${node.type}`}
    >
      {row.hasChildren ? (
        <button
          type="button"
          className="tree-toggle"
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpand(node.id, !row.expanded)
          }}
        >
          {row.expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-toggle tree-toggle--empty" />
      )}

      <span className={`tree-icon tree-icon--${iconKind(node)}`}>{iconFor(node)}</span>
      <span className="tree-name">{node.name}</span>
      {node.materialIds.length > 1 && <span className="tree-badge">{node.materialIds.length}</span>}

      <button
        type="button"
        className={`tree-eye${node.visible ? '' : ' tree-eye--off'}`}
        title={node.visible ? 'Hide' : 'Show'}
        onClick={(event) => {
          event.stopPropagation()
          onToggleVisible(node.id, !node.visible)
        }}
      >
        {node.visible ? '👁' : '⃠'}
      </button>
    </div>
  )
})

function iconKind(node: NodeEntry): string {
  if (node.isSkinnedMesh) return 'skinned'
  if (node.isMesh) return 'mesh'
  if (node.isBone) return 'bone'
  if (node.isLight) return 'light'
  if (node.isCamera) return 'camera'
  return 'group'
}

function iconFor(node: NodeEntry): string {
  switch (iconKind(node)) {
    case 'skinned':
      return '◈'
    case 'mesh':
      return '◼'
    case 'bone':
      return '⌇'
    case 'light':
      return '☀'
    case 'camera':
      return '🎥'
    default:
      return '▣'
  }
}

/** Ids whose name matches, plus every ancestor that must open to reveal them. */
function computeSearch(manifest: ModelManifest, search: string): { matches: Set<string>; forcedOpen: Set<string> } {
  const matches = new Set<string>()
  const forcedOpen = new Set<string>()
  const query = search.trim().toLowerCase()
  if (!query) return { matches, forcedOpen }

  for (const id of manifest.order) {
    const node = manifest.nodes[id]
    if (!node.name.toLowerCase().includes(query)) continue

    matches.add(id)
    let parentId = node.parentId
    while (parentId) {
      forcedOpen.add(parentId)
      parentId = manifest.nodes[parentId]?.parentId ?? null
    }
  }

  return { matches, forcedOpen }
}

/**
 * Flattens the hierarchy into the rows that are currently visible.
 * While searching, branches without a hit are pruned but nesting is preserved.
 */
function buildRows(
  manifest: ModelManifest,
  expandedIds: Record<string, boolean>,
  forcedOpen: Set<string> | null,
  matches: Set<string>,
): Row[] {
  const rows: Row[] = []
  const searching = forcedOpen !== null

  const walk = (id: string, depth: number) => {
    const node = manifest.nodes[id]
    if (!node) return

    if (searching && !matches.has(id) && !forcedOpen.has(id)) return

    const hasChildren = node.childIds.length > 0
    const expanded = searching ? forcedOpen.has(id) || !!expandedIds[id] : !!expandedIds[id]

    rows.push({ id, depth, hasChildren, expanded, matched: matches.has(id) })

    if (hasChildren && expanded) {
      for (const childId of node.childIds) walk(childId, depth + 1)
    }
  }

  for (const rootId of manifest.rootIds) walk(rootId, 0)
  return rows
}
