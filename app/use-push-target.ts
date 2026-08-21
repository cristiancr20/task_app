'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { LinearProject, LinearTeam } from '@/lib/linear'
import { fetchLinearTeams } from '@/lib/linear-client'
import type { DestinationStatus } from '@/lib/push-destination'

import { saveLastProject } from './actions'

/**
 * Where the workspace listing stands. `no-key` is not a failure: nothing was
 * ever requested, because there is no key to request it with, and the panel
 * says so instead of showing an error the user cannot act on from here.
 *
 * It is `DestinationStatus` under another name so that the module deciding what
 * the column says about its destination and the hook loading it cannot end up
 * with two different lists of the states it can be in.
 */
export type PushTargetStatus = DestinationStatus

export type PushTargetApi = {
  status: PushTargetStatus
  /** Every team the key can see. Empty until the listing arrives. */
  teams: LinearTeam[]
  /** The selected team's projects — what the project dropdown offers. */
  projects: LinearProject[]
  /** `''` when no team is selected yet. */
  teamId: string
  /** `''` when no project is selected yet — the push is blocked until it is not. */
  projectId: string
  /** Message of the failed listing, in Spanish, or null. */
  error: string | null
  selectTeam: (id: string) => void
  selectProject: (id: string) => void
  /** Ask for the listing again, behind «Reintentar». */
  reload: () => void
}

/**
 * The destination of the push: a Linear team and one of its projects.
 *
 * The listing is fetched once per page load — a workspace's teams and projects
 * do not change while a meeting note is being curated, and the request walks
 * every paginated connection, so re-running it on each selection would be the
 * slowest thing on the page for no new information.
 *
 * The choice is workspace-wide rather than per transcript, which is why it is
 * *not* keyed by path like the drafts: the user pushes to the same project note
 * after note, and `lastProjectId` in the config is what makes that survive a
 * reload.
 */
export function usePushTarget({
  hasLinearApiKey,
  lastProjectId,
}: {
  /** Whether a key is stored. The key itself never reaches the browser. */
  hasLinearApiKey: boolean
  /** The project used last, from the config store. */
  lastProjectId: string | null
}): PushTargetApi {
  const [teams, setTeams] = useState<LinearTeam[]>([])
  const [status, setStatus] = useState<PushTargetStatus>(hasLinearApiKey ? 'loading' : 'no-key')
  const [error, setError] = useState<string | null>(null)
  const [teamId, setTeamId] = useState('')
  const [projectId, setProjectId] = useState('')
  // Bumped by «Reintentar»: two failed listings are otherwise indistinguishable
  // and the effect would not run again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!hasLinearApiKey) {
      setStatus('no-key')
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    fetchLinearTeams().then(
      (loaded) => {
        if (cancelled) return
        const initial = initialSelection(loaded, lastProjectId)
        setTeams(loaded)
        setTeamId(initial.teamId)
        setProjectId(initial.projectId)
        setStatus('ready')
      },
      (err: unknown) => {
        if (cancelled) return
        setError(errorMessage(err))
        setStatus('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [attempt, hasLinearApiKey, lastProjectId])

  const projects = useMemo(
    () => teams.find((team) => team.id === teamId)?.projects ?? [],
    [teamId, teams],
  )

  const selectTeam = useCallback((id: string) => {
    setTeamId(id)
    // Projects belong to a team, so the previous choice is not in the new list.
    // The stored `lastProjectId` is left alone: clearing it here is a side
    // effect of changing team, not the user picking «ningún proyecto».
    setProjectId('')
  }, [])

  const selectProject = useCallback((id: string) => {
    setProjectId(id)
    void saveLastProject(id || null)
  }, [])

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  return { status, teams, projects, teamId, projectId, error, selectTeam, selectProject, reload }
}

/**
 * What starts selected: the project used last if the key can still see it,
 * otherwise nothing — with the team filled in whenever there is no choice to
 * make about it, so a one-team workspace never shows a dropdown with one option.
 */
function initialSelection(
  teams: LinearTeam[],
  lastProjectId: string | null,
): { teamId: string; projectId: string } {
  const wanted = lastProjectId?.trim() ?? ''
  const owner = wanted
    ? teams.find((team) => team.projects.some((project) => project.id === wanted))
    : undefined

  // The project may have been archived, or the key may have lost access to it.
  if (owner) return { teamId: owner.id, projectId: wanted }

  const only = teams.length === 1 ? teams[0] : undefined
  return { teamId: only?.id ?? '', projectId: '' }
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'No se pudieron cargar los proyectos de Linear.'
}
