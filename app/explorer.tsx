'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { FileView } from '@/lib/browse-client'
import {
  activeTab,
  type ColumnTab,
  columnCounts,
  DEFAULT_COLUMN_TAB,
} from '@/lib/column-tabs'
import type { DraftsState } from '@/lib/drafts-store'
import { decideDuplicates, exclusionKey, scopeKeyOf } from '@/lib/duplicate-check'
import { emptyInsights } from '@/lib/extractors/task'
import { nextToReview, reviewPosition, reviewQueue } from '@/lib/inbox-review'
import { issueStatesById } from '@/lib/issue-state-summary'
import { ancestorFolders, folderLabel, folderName, folderOfNote } from '@/lib/note-paths'
import { pendingCommitments } from '@/lib/pending-commitments'

import { ColumnTabs, columnPanelId, columnTabId } from './column-tabs'
import { FileList } from './file-list'
import { FolderTree } from './folder-tree'
import { useInboxApi } from './inbox-provider'
import { InboxView } from './inbox-view'
import { MeetingInsights } from './meeting-insights'
import { PendingCommitments } from './pending-commitments'
import { type ParentApi, PushFooter, PushPanel, type PushApi } from './push-panel'
import { PushedHistory } from './pushed-history'
import { ReviewNav } from './review-nav'
import { useSearchApi } from './search-provider'
import { SearchResults } from './search-results'
import { TaskTable } from './task-table'
import { TranscriptPreview } from './transcript-preview'
import { useDuplicateCheck } from './use-duplicate-check'
import { useExtractionQueue } from './use-extraction-queue'
import { useFolderHistory } from './use-folder-history'
import { useFolderIssueStates } from './use-folder-issue-states'
import { useFolderListings } from './use-folder-listings'
import { useIssueStates } from './use-issue-states'
import { usePushOptions } from './use-push-options'
import { createdIssuesOf, parentIssueOf, usePushRun } from './use-push-run'
import { usePushTarget } from './use-push-target'
import { useSplit } from './use-split'
import { useTaskDrafts } from './use-task-drafts'
import { useTranscript } from './use-transcript'

/** A folder that has not been listed yet, as one array rather than a new one per render. */
const NO_FILES: FileView[] = []

/** What a note with no drafts loaded contributes to «La reunión»: nothing, once. */
const NO_INSIGHTS = emptyInsights()

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
 *
 * While the header's search field has something in it the centre column shows
 * the results instead of the folder, and while the inbox is open it shows the
 * notes that have never been pushed. Only that column changes: the note being
 * read stays on screen throughout, and opening a row moves the selection to its
 * folder so that leaving lands somewhere that makes sense.
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
  // The field is in the header, outside this component; what it is looking for
  // is drawn here, in the column the folder's files occupy — see `SearchProvider`.
  const search = useSearchApi()
  // The other view of that same column: everything under the root that has not
  // been pushed yet. Its button is in the header too — see `InboxProvider`.
  const inbox = useInboxApi()
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
  //
  // The inbox is «lo que no se ha enviado», so a push is exactly the event that
  // takes a note out of it: without this the header would go on counting a note
  // that has just been processed until the page was reloaded. It is `refresh`
  // and not `reload` for the same reason the queue's is — what changed is the
  // push history in `config.json`, which every `/api/inbox` request reads
  // anyway, not the folder on disk — and it is what keeps the round below in
  // step: the note just sent leaves «Por revisar» the moment the answer lands.
  const { refresh: refreshInbox } = inbox
  const onPushed = useCallback(
    (path: string) => {
      if (path === selectedFile) refreshTranscript()
      refreshFolder(folderOfNote(path))
      refreshInbox()
    },
    [refreshFolder, refreshInbox, refreshTranscript, selectedFile],
  )
  const run = usePushRun(selectedFile, onPushed)

  // The batch extraction of the bandeja. It is run *here*, not inside the
  // inbox's view, and that is the whole of «navegar a otra vista no cancela la
  // cola»: the view is unmounted the moment the search or the folder takes the
  // column back, while this component stays for as long as the page does.
  //
  // A note the queue extracts changes twice over: on disk, where its drafts
  // now exist — so the bandeja has to hear about it and move the row from «sin
  // tocar» to «extraída, sin enviar» — and in this page's memory, if the note
  // happens to be the one open in the table. `adopt` is what covers the second
  // one: a re-read would lose to what is already on screen (see `mergeDrafts`),
  // and the table showing an empty list over drafts that exist would be the
  // one way this queue could look like it did nothing.
  const { adopt } = drafts
  const onExtracted = useCallback(
    (path: string, stored: DraftsState) => {
      adopt(path, stored)
      refreshInbox()
    },
    [adopt, refreshInbox],
  )
  const queue = useExtractionQueue(onExtracted)

  // The round the tanda left behind: the notes with drafts that have never been
  // sent, in the bandeja's own order. It is read from the inbox this page
  // already keeps loaded — the hook fetches on mount whether or not the panel
  // has ever been opened — so the strip above the table knows how much is left
  // without a request of its own, and every event that moves the bandeja
  // (extracting, pushing, reloading) moves the round with it.
  const review = useMemo(() => reviewQueue(inbox.state.items), [inbox.state.items])
  const reviewNext = useMemo(() => nextToReview(review, selectedFile), [review, selectedFile])

  // Launching empties the selection, but only if it really launched: the tanda
  // is now the queue's, and leaving the boxes ticked would offer to run again
  // exactly what is running.
  const { clear: clearSelection, items: selectedNotes } = inbox.selection
  const startBatch = useCallback(() => {
    if (queue.start(selectedNotes)) clearSelection()
  }, [clearSelection, queue, selectedNotes])

  // The parent issue stands for the meeting, so its title starts as the note's
  // own — and only until the user types, which is what the null means.
  const meetingTitle = transcript?.status === 'ready' ? transcript.transcript.meta.title : ''
  // The push history travels with the note, and is reported in the Linear
  // column: what this file already produced belongs next to what it is about
  // to produce, not on top of the text it came from.
  const history = transcript?.status === 'ready' ? transcript.transcript.history : []
  const parentTitle = pushOptions.options.parentTitle ?? meetingTitle

  // What the state report is about. A note with no history has no ids, which is
  // how the hook knows there is nothing to ask — the block is not rendered
  // either way, and no request is made for it.
  const historyIssueIds = useMemo(
    () => history.flatMap((entry) => entry.issues.map((issue) => issue.id)),
    [history],
  )
  const issueStates = useIssueStates({
    relPath: selectedFile,
    issueIds: historyIssueIds,
    hasLinearApiKey,
  })

  // The badges of the list read from one query for the whole folder on screen,
  // not one per row — see `useFolderIssueStates`. It is about the *selected*
  // folder, which is the one `FileList` draws, and not about the note open in
  // the column to its right.
  const folder = states[selected]
  const folderFiles = folder?.status === 'ready' ? folder.listing.files : NO_FILES
  const folderIssueStates = useFolderIssueStates({
    folder: selected,
    files: folderFiles,
    hasLinearApiKey,
  })
  // The same folder's push history, which is where the *other* meetings are:
  // their project, their issues and their dates. It is a local read, so it
  // costs nothing beyond the listing that is already being fetched.
  const folderHistory = useFolderHistory({ folder: selected, files: folderFiles })

  // What previous meetings of the selected project left open. Both halves of it
  // are already on the page — the history above and the states the badges were
  // drawn from — so the panel adds no query of its own: opening a note asks
  // Linear nothing it has not already been asked in this session. Without a key
  // there are no states, and without a project the rule answers nothing, so the
  // panel simply does not appear in either case.
  const knownStates = useMemo(
    () => issueStatesById(Object.values(folderIssueStates).flat()),
    [folderIssueStates],
  )
  // The listing already carries every title of the folder; the pure module
  // falls back to the file name for a note that is not in it.
  const folderTitles = useMemo(
    () => Object.fromEntries(folderFiles.map((file) => [file.relPath, file.title])),
    [folderFiles],
  )
  const previousCommitments = useMemo(
    () =>
      selectedFile
        ? pendingCommitments({
            history: folderHistory,
            states: knownStates,
            notePath: selectedFile,
            projectId: target.projectId || null,
            titles: folderTitles,
          })
        : [],
    [folderHistory, folderTitles, knownStates, selectedFile, target.projectId],
  )

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

  // The three piles the column splits into — the table, what the meeting knew,
  // what it already produced — and which of them is on screen.
  //
  // The choice belongs to the session and not to the note: «cambiar de nota
  // vuelve a Tareas», because opening a note is opening its table, and coming
  // back to a reading panel somebody left open two notes ago would hide the one
  // thing that is edited. The reset happens in the render body, like
  // `FileList`'s filter, so the previous note's tab never reaches the screen.
  //
  // What is *really* open is `activeTab`, not `chosenTab`: a tab holds a report
  // that can empty underneath the user — a re-extraction with no insights, a
  // history that is still loading — and the fallback has to be immediate rather
  // than an effect that draws the empty panel once before correcting itself.
  const [chosenTab, setChosenTab] = useState<ColumnTab>(DEFAULT_COLUMN_TAB)
  const [tabbedFile, setTabbedFile] = useState(selectedFile)
  if (tabbedFile !== selectedFile) {
    setTabbedFile(selectedFile)
    setChosenTab(DEFAULT_COLUMN_TAB)
  }
  const tabCounts = useMemo(
    () =>
      columnCounts({
        rows: rows.length,
        insights: drafts.state ?? NO_INSIGHTS,
        commitments: previousCommitments.length,
        history,
      }),
    [drafts.state, history, previousCommitments.length, rows.length],
  )
  const tab = activeTab(tabCounts, chosenTab)

  // What the duplicate check is aimed at. Only a chosen project counts: the
  // whole team is a far wider net than the user asked for, and a check against
  // it would report tasks that belong to another piece of work entirely. With
  // no key, no team or no project the check simply has nothing to say.
  const duplicateScope = useMemo(
    () =>
      target.status === 'ready' && target.teamId && target.projectId
        ? { teamId: target.teamId, projectId: target.projectId }
        : null,
    [target.projectId, target.status, target.teamId],
  )
  // Rows this push already created: they are in Linear because they were just
  // put there, so they are the one thing the check must not look at.
  const createdRowIds = useMemo(
    () =>
      new Set(
        Object.entries(results).flatMap(([id, result]) =>
          result.state === 'created' ? [id] : [],
        ),
      ),
    [results],
  )
  const duplicates = useDuplicateCheck({
    relPath: selectedFile,
    scope: duplicateScope,
    rows,
    skipRowIds: createdRowIds,
  })

  // Which rows the app has already unchecked on its own, per destination — see
  // `exclusionKey`. It is the whole of «una sola vez»: the ids stay here after
  // the row is unchecked, so checking it back is a decision the check does not
  // get to overrule, and it is the same memory that tells a re-marked row from
  // one nobody has touched.
  const [autoExcluded, setAutoExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const duplicateScopeKey = scopeKeyOf(duplicateScope)
  const decisions = useMemo(
    () => decideDuplicates(rows, duplicates.matches, duplicateScopeKey, autoExcluded),
    [autoExcluded, duplicateScopeKey, duplicates.matches, rows],
  )

  // Unchecking is a change to the rows, so it belongs in an effect rather than
  // in the render that decided it. It settles in one pass: the rows it names
  // come back unchecked and their keys are remembered, so the next `decisions`
  // has nothing left to exclude.
  // `excludeRows` rather than `drafts`: the hook returns a fresh object every
  // render, and this effect must be about the rows it names, not about React.
  const { excludeRows } = drafts
  const { toExclude } = decisions
  useEffect(() => {
    if (toExclude.length === 0 || !duplicateScopeKey) return
    excludeRows(toExclude)
    setAutoExcluded((previous) => {
      const next = new Set(previous)
      for (const id of toExclude) next.add(exclusionKey(duplicateScopeKey, id))
      return next
    })
  }, [duplicateScopeKey, excludeRows, toExclude])

  // The head of the Linear column and its foot are two views of one push: the
  // destination folds up top, the button lives at the bottom, and both are
  // drawn from these — so «3 tareas bajo una tarea padre» in the head and
  // «Reintentar 2 fallidas» at the foot cannot be about different runs.
  const parentApi: ParentApi = {
    create: pushOptions.options.createParent,
    title: parentTitle,
    onToggle: pushOptions.setCreateParent,
    onTitleChange: pushOptions.setParentTitle,
  }
  const pushApi: PushApi = {
    status: run.state.status,
    pending: pending.length,
    failed,
    created,
    issues: createdIssues,
    parentIssue,
    progress: run.state.progress,
    error: run.state.error,
    onPush: startPush,
  }

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
        dueDate: row.dueDate,
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

  /**
   * Open a note from the search results or from the inbox: the note in the
   * transcript column, and the folder it came from selected and revealed in the
   * tree behind them.
   *
   * A row may name a note in a folder nobody has clicked in this session,
   * so the whole chain of ancestors is listed and expanded rather than just the
   * folder itself — otherwise leaving would land on a selection the tree cannot
   * show. The list is *not* closed: the next row is one click away, which is
   * what makes working through an inbox possible at all, and leaving it later
   * comes back to this folder with this note still open.
   */
  function openResult(relPath: string) {
    const folder = folderOfNote(relPath)
    const chain = ancestorFolders(folder)

    for (const path of chain) open(path)
    setSelected(folder)
    setSelectedFile(relPath)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const path of chain) next.add(path)
      return next
    })
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

      {/* The same column, showing one of three things: the folder, what the
          header's field is looking for, or the inbox. All of them take the
          place of the list rather than covering the page, so the transcript to
          the right — and the note open in it — survives every switch between
          them. The search wins over the inbox because opening either one puts
          the other away (see `InboxProvider`), so they are never both on. */}
      <section className="panel w-80 shrink-0 bg-surface">
        {search.active ? (
          <SearchResults
            state={search.state}
            rootLabel={rootLabel}
            selectedFile={selectedFile}
            onOpen={openResult}
            onRetry={search.retry}
          />
        ) : inbox.open ? (
          <InboxView
            state={inbox.state}
            counts={inbox.counts}
            rootLabel={rootLabel}
            selectedFile={selectedFile}
            scope={inbox.scope}
            onScopeChange={inbox.setScope}
            filter={inbox.filter}
            onFilterChange={inbox.setFilter}
            filtered={inbox.filtered}
            selection={inbox.selection}
            queue={queue}
            onExtract={startBatch}
            onOpen={openResult}
            onReload={inbox.reload}
          />
        ) : (
          <FileList
            state={states[selected]}
            folder={selected}
            breadcrumb={folderLabel(rootLabel, selected)}
            issueStates={folderIssueStates}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            onRetry={() => reload(selected)}
          />
        )}
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
            {/* The tanda's round, above the destination and above the table:
                what is left to review and the way to the next one, so working
                through what was extracted never goes back through the bandeja.
                It appears only while there is something to review, and it sends
                nothing — the push below stays one note at a time. */}
            {review.length > 0 ? (
              <ReviewNav
                position={reviewPosition(review, selectedFile)}
                total={review.length}
                next={reviewNext}
                onNext={() => {
                  if (reviewNext) openResult(reviewNext.relPath)
                }}
              />
            ) : null}

            {/* The head of the column: three piles that are never read at the
                same time, instead of five blocks stacked on one another. What
                each of them holds, which can be opened and which is open is
                `lib/column-tabs.ts` — see `ColumnTabs`. */}
            <ColumnTabs counts={tabCounts} chosen={chosenTab} onChange={setChosenTab} />

            {/* The open pile, filling everything between the tabs and the
                action bar. Only one is mounted: they are alternatives, and a
                hidden panel that kept rendering would go on costing the column
                the very height the tabs were introduced to give back. */}
            {tab === 'tasks' ? (
              <div
                role="tabpanel"
                id={columnPanelId('tasks')}
                aria-labelledby={columnTabId('tasks')}
                className="flex min-h-0 flex-1 flex-col"
              >
                <TaskTable
                  state={drafts.state}
                  results={results}
                  busy={run.state.status === 'running'}
                  matches={duplicates.matches}
                  forcedRows={decisions.forced}
                  showDuplicates={duplicates.status !== 'unavailable'}
                  checkingDuplicates={duplicates.checking}
                  onGenerate={drafts.generate}
                  onConfirmGenerate={drafts.confirmGenerate}
                  onCancelGenerate={drafts.cancelGenerate}
                  onUpdateRow={drafts.updateRow}
                  onRemoveRow={drafts.removeRow}
                  onAddRow={drafts.addRow}
                  onRetryLoad={drafts.retryLoad}
                />
              </div>
            ) : tab === 'meeting' ? (
              // What the meeting knew and what the previous ones left open:
              // read once, before or during the review, and never edited — so
              // it scrolls in its own panel instead of pushing the table down.
              <div
                role="tabpanel"
                id={columnPanelId('meeting')}
                aria-labelledby={columnTabId('meeting')}
                tabIndex={0}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              >
                <PendingCommitments commitments={previousCommitments} onOpenNote={setSelectedFile} />
                {drafts.state ? <MeetingInsights insights={drafts.state} /> : null}
              </div>
            ) : (
              // What this note already produced in Linear. The tab is disabled
              // without a single push, so this is never an empty panel.
              <div
                role="tabpanel"
                id={columnPanelId('sent')}
                aria-labelledby={columnTabId('sent')}
                tabIndex={0}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              >
                <PushedHistory history={history} states={issueStates} />
              </div>
            )}

            {/* The action bar: where it goes and the button that sends it,
                together at the foot of the column and outside the panel above
                that scrolls. The destination moved down here from the top with
                the tabs: it belongs to the push and not to the pile being read,
                and above the tabs it would have been a second header between
                them and the table they open onto. */}
            <PushPanel
              target={target}
              parent={parentApi}
              duplicates={{
                status: duplicates.status,
                checking: duplicates.checking,
                error: duplicates.error,
                excluded: decisions.excluded,
                onCheck: duplicates.recheck,
              }}
              push={pushApi}
            />

            <PushFooter target={target} parent={parentApi} push={pushApi} />
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

