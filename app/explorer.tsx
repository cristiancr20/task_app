'use client'

import { useCallback, useEffect, useState } from 'react'

import { FileList } from './file-list'
import { FolderTree } from './folder-tree'
import { PushPanel } from './push-panel'
import { PushedHistory } from './pushed-history'
import { TaskTable } from './task-table'
import { TranscriptPreview } from './transcript-preview'
import { useFolderListings } from './use-folder-listings'
import { usePushOptions } from './use-push-options'
import { createdIssuesOf, parentIssueOf, usePushRun } from './use-push-run'
import { usePushTarget } from './use-push-target'
import { useSplit } from './use-split'
import { useTaskDrafts } from './use-task-drafts'
import { useTranscript } from './use-transcript'

type Props = {
  /** Absolute path of the configured context folder, for the tree's root row. */
  contextRoot: string
  /** Whether a Linear key is stored. The key itself never reaches the browser. */
  hasLinearApiKey: boolean
  /** The project pushed to last, so the panel starts on it. */
  lastProjectId: string | null
}

/**
 * The three panels of the explorer: the folder tree on the left, the `.md`
 * files of the selected folder in the centre, and the selected transcript on
 * the right — with the task table underneath, across the full width, once a
 * file is selected.
 *
 * Folders are listed from the browser through `/api/browse` rather than on the
 * server, so expanding a node costs one request instead of a re-render of the
 * whole page, and a folder that disappears from disk fails in place with a
 * «Reintentar» instead of breaking the route.
 *
 * The drafts live here rather than inside the table because they outlive the
 * selection: `useTaskDrafts` keys them by path, so browsing to another note and
 * back shows the edits again.
 */
export function Explorer({ contextRoot, hasLinearApiKey, lastProjectId }: Props) {
  const { states, open, reload, refresh: refreshFolder } = useFolderListings()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']))
  const [selected, setSelected] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  // Session-only: which folder you are in already persists through `selected`,
  // and a remembered-but-invisible panel is a worse first impression than one
  // that simply starts open every time.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const split = useSplit(50)
  const {
    state: transcript,
    reload: reloadTranscript,
    refresh: refreshTranscript,
  } = useTranscript(selectedFile)
  const drafts = useTaskDrafts(selectedFile)
  // The destination is workspace-wide, so it is loaded once and outlives every
  // selection; the parent options belong to one note and are keyed by path.
  const target = usePushTarget({ hasLinearApiKey, lastProjectId })
  const pushOptions = usePushOptions(selectedFile)

  // The route writes the created issues to the history, so the already-processed
  // notice of the note is out of date the moment a run ends — but only for the
  // note that ran: a push finishing after the user moved on must not re-read
  // somebody else's file. Its badge in the list is out of date either way, and
  // that one belongs to the note's own folder, not to the folder on screen.
  const onPushed = useCallback(
    (path: string) => {
      if (path === selectedFile) refreshTranscript()
      refreshFolder(folderOf(path))
    },
    [refreshFolder, refreshTranscript, selectedFile],
  )
  const run = usePushRun(selectedFile, onPushed)

  // The parent issue stands for the meeting, so its title starts as the note's
  // own — and only until the user types, which is what the null means.
  const meetingTitle = transcript?.status === 'ready' ? transcript.transcript.meta.title : ''
  // The push history travels with the note, and is reported in the Linear
  // column: what this file already produced belongs next to what it is about
  // to produce, not on top of the text it came from.
  const history = transcript?.status === 'ready' ? transcript.transcript.history : []
  const parentTitle = pushOptions.options.parentTitle ?? meetingTitle

  const rows = drafts.state?.rows ?? []
  const results = run.state.rows
  // What the button would send: checked rows Linear does not already have. This
  // is what makes a retry a retry — a created row is out of the request, not
  // merely skipped by the server.
  const pending = rows.filter((row) => row.include && results[row.id]?.state !== 'created')
  const failed = rows.filter((row) => row.include && results[row.id]?.state === 'failed').length
  const created = rows.filter((row) => results[row.id]?.state === 'created').length
  const parentIssue = parentIssueOf(run.state)
  const createdIssues = createdIssuesOf(run.state)

  function startPush() {
    run.push({
      teamId: target.teamId,
      projectId: target.projectId || null,
      // The parent is created once per note: a retry hangs its tasks from the
      // one that already exists instead of filing a second copy of the meeting.
      parentTitle:
        pushOptions.options.createParent && !parentIssue ? parentTitle.trim() || null : null,
      parentId: pushOptions.options.createParent ? (parentIssue?.id ?? null) : null,
      tasks: pending.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        mentioned: row.mentioned,
        evidence: row.evidence,
      })),
    })
  }

  // The root starts selected and expanded, so the first paint already shows its
  // files. `open` skips folders that have been asked for, so this runs once.
  useEffect(() => {
    open('')
  }, [open])

  function toggleFolder(relPath: string) {
    open(relPath)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })
  }

  function selectFolder(relPath: string) {
    open(relPath)
    setSelected(relPath)
    setSelectedFile(null)
    // Selecting reveals what is inside; collapsing is what the chevron is for.
    setExpanded((prev) => (prev.has(relPath) ? prev : new Set(prev).add(relPath)))
  }

  const rootLabel = folderName(contextRoot)

  return (
    // One row of panels, all of them full height, floating on the ground with a
    // gap between them. Nothing stacks vertically any more: the transcript used
    // to lose more than half its height to the table below it, and reading is
    // the step that needs the room.
    <div className="flex min-h-0 flex-1 gap-2 px-3 pb-3">
      {/* Collapsed, the tree becomes a 10-rem-narrower page. On a laptop that
          is the difference between four cramped columns and three comfortable
          ones, so it is a layout control, not a decoration. */}
      {sidebarOpen ? (
        // The one panel that is recessed rather than white: navigation is
        // chrome, and the columns to its right are the content it leads to.
        <aside className="panel w-60 shrink-0 bg-surface-2">
          <div className="panel-head justify-between">
            <h2 className="panel-title">Carpetas</h2>
            <SidebarToggle open onClick={() => setSidebarOpen(false)} />
          </div>
          <nav aria-label="Carpetas" className="min-h-0 flex-1 overflow-y-auto p-2">
            <FolderTree
              rootName={rootLabel}
              api={{
                states,
                expanded,
                selected,
                onToggle: toggleFolder,
                onSelect: selectFolder,
                onRetry: reload,
              }}
            />
          </nav>
        </aside>
      ) : (
        <div className="panel shrink-0 items-center bg-surface-2 px-1.5 py-2">
          <SidebarToggle open={false} onClick={() => setSidebarOpen(true)} />
        </div>
      )}

      <section className="panel w-80 shrink-0 bg-surface">
        <FileList
          state={states[selected]}
          breadcrumb={breadcrumb(rootLabel, selected)}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onRetry={() => reload(selected)}
        />
      </section>

      {/* Transcript and tasks share the rest of the row. With no file open the
          transcript takes all of it; once tasks appear they split it evenly and
          the divider between them is draggable, because how much room each
          needs depends on the meeting, not on a number picked here. */}
      <div ref={split.containerRef} className="flex min-h-0 min-w-0 flex-1 gap-2">
        <section
          aria-label="Transcripción"
          className="panel min-w-0 bg-surface"
          style={
            selectedFile
              ? { flex: `0 0 ${split.percent}%`, maxWidth: `${split.percent}%` }
              : { flex: '1 1 auto' }
          }
        >
          <TranscriptPreview state={transcript} onRetry={reloadTranscript} />
        </section>

        {selectedFile ? (
          <div
            {...split.handleProps}
            className="group relative -mx-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded-full focus-visible:outline-none"
          >
            {/* Nothing is drawn until the divider is aimed at: the gap between
                the two panels already separates them, so the grip only has to
                appear when it is about to be used. */}
            <span
              className={`h-8 w-1 rounded-full transition-colors ${
                split.dragging
                  ? 'bg-accent'
                  : 'bg-transparent group-hover:bg-line-strong group-focus-visible:bg-accent'
              }`}
            />
          </div>
        ) : null}

        {/* Tasks sit beside the transcript they came from, so you can check a
            row against the sentence that produced it without scrolling between
            them. The Linear controls ride on top as this column's header: the
            destination belongs with the thing being sent, and putting it in a
            full-width bar would separate the two. */}
        {selectedFile ? (
          <section aria-label="Tareas y envío a Linear" className="panel min-w-0 flex-1 bg-surface">
            <PushPanel
              target={target}
              parent={{
                create: pushOptions.options.createParent,
                title: parentTitle,
                onToggle: pushOptions.setCreateParent,
                onTitleChange: pushOptions.setParentTitle,
              }}
              push={{
                status: run.state.status,
                pending: pending.length,
                failed,
                created,
                issues: createdIssues,
                parentIssue,
                progress: run.state.progress,
                error: run.state.error,
                onPush: startPush,
              }}
            />

            {history.length > 0 ? <PushedHistory history={history} /> : null}

            <div className="flex min-h-0 flex-1">
              <TaskTable
                state={drafts.state}
                results={results}
                busy={run.state.status === 'running'}
                onGenerate={drafts.generate}
                onConfirmGenerate={drafts.confirmGenerate}
                onCancelGenerate={drafts.cancelGenerate}
                onUpdateRow={drafts.updateRow}
                onRemoveRow={drafts.removeRow}
                onAddRow={drafts.addRow}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

/** Show/hide control for the folder tree. Icon-only when the tree is closed. */
function SidebarToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={open ? 'Ocultar carpetas' : 'Mostrar carpetas'}
      className="rounded-md p-1 text-muted transition-colors hover:bg-line hover:text-content"
    >
      <span className="sr-only">{open ? 'Ocultar carpetas' : 'Mostrar carpetas'}</span>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
        <line x1="6" y1="2.75" x2="6" y2="13.25" />
        {open ? <polyline points="10.5,6 8.75,8 10.5,10" /> : <polyline points="9,6 10.75,8 9,10" />}
      </svg>
    </button>
  )
}

/** The folder a root-relative file path lives in — `''` for a file at the root. */
function folderOf(relPath: string): string {
  const cut = relPath.lastIndexOf('/')
  return cut === -1 ? '' : relPath.slice(0, cut)
}

/** The last segment of an absolute path — the context folder's own name. */
function folderName(absPath: string): string {
  const segments = absPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return segments[segments.length - 1] || absPath
}

function breadcrumb(rootLabel: string, relPath: string): string {
  return [rootLabel, ...(relPath ? relPath.split('/') : [])].join(' / ')
}
