'use client'

import type { FolderEntry } from '@/lib/transcripts'

import type { FolderState } from './use-folder-listings'

/** Everything a node needs from the explorer, bundled so it can recurse cheaply. */
export type TreeApi = {
  states: Record<string, FolderState>
  expanded: ReadonlySet<string>
  /** Root-relative path of the folder whose files are listed (`''` = root). */
  selected: string
  onToggle: (relPath: string) => void
  onSelect: (relPath: string) => void
  onRetry: (relPath: string) => void
}

type Props = {
  /** Label for the root row: the context folder's own name. */
  rootName: string
  api: TreeApi
}

/** The context root and, lazily, every folder under it that has been expanded. */
export function FolderTree({ rootName, api }: Props) {
  return (
    <ul className="flex flex-col gap-0.5">
      <TreeNode entry={{ name: rootName, relPath: '' }} depth={0} api={api} />
    </ul>
  )
}

function TreeNode({ entry, depth, api }: { entry: FolderEntry; depth: number; api: TreeApi }) {
  const state = api.states[entry.relPath]
  const expanded = api.expanded.has(entry.relPath)
  const selected = api.selected === entry.relPath
  const children = state?.status === 'ready' ? state.listing.folders : []

  // Whether a folder has subfolders is only known once it has been listed, so
  // the toggle stays available until the answer arrives and then disappears
  // for the leaves — a chevron that expands into nothing reads as broken.
  const toggleable = state?.status !== 'ready' || children.length > 0
  const indent = { paddingLeft: `${depth * 0.875 + 0.25}rem` }

  return (
    <li>
      <div
        style={indent}
        className={`flex items-center gap-0.5 rounded-md pr-1 text-sm transition-colors ${
          selected
            ? 'bg-accent-wash text-content'
            : 'text-content hover:bg-surface-2'
        }`}
      >
        {toggleable ? (
          <button
            type="button"
            onClick={() => api.onToggle(entry.relPath)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Contraer' : 'Expandir'} ${entry.name}`}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:text-content"
          >
            <Chevron open={expanded} />
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => api.onSelect(entry.relPath)}
          aria-current={selected ? 'true' : undefined}
          title={entry.name}
          className={`flex-1 truncate py-1 text-left ${selected ? 'font-medium' : ''}`}
        >
          {entry.name}
        </button>
      </div>

      {expanded ? (
        state?.status === 'error' ? (
          <div style={{ paddingLeft: `${(depth + 1) * 0.875 + 0.25}rem` }} className="py-1 pr-1">
            <p role="alert" className="text-xs text-danger">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => api.onRetry(entry.relPath)}
              className="mt-1 rounded border border-line-strong px-2 py-0.5 text-xs font-medium hover:bg-surface-2"
            >
              Reintentar
            </button>
          </div>
        ) : state?.status === 'loading' ? (
          <p
            style={{ paddingLeft: `${(depth + 1) * 0.875 + 1.5}rem` }}
            className="py-1 text-xs text-muted"
          >
            Cargando…
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {children.map((child) => (
              <TreeNode key={child.relPath} entry={child} depth={depth + 1} api={api} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}
