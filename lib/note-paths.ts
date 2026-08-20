/**
 * Arithmetic over root-relative note paths, as the browser needs it.
 *
 * Nothing here touches the filesystem: these are the pure string rules the
 * explorer uses to answer «which folder is this note in», «which folders have
 * to be open for it to be visible» and «how is that folder written out for a
 * person». The real paths are resolved and guarded server-side, in
 * `lib/transcripts.ts`; this module never turns a relative path into an
 * absolute one, so it cannot be a way out of the context root.
 *
 * A path is always `/`-separated and always relative to the context root, and
 * the root itself is `''` — the same convention `/api/browse` answers with.
 */

/**
 * The folder a note lives in — `''` for a note sitting at the context root.
 *
 * Only the last separator matters: `2026/agosto/nota.md` is in
 * `2026/agosto`, and a name with no separator at all is at the root.
 */
export function folderOfNote(relPath: string): string {
  const cut = relPath.lastIndexOf('/')
  return cut === -1 ? '' : relPath.slice(0, cut)
}

/**
 * Every folder that has to be open for `folder` to be on screen, outermost
 * first and `folder` itself last — the root `''` always leads.
 *
 * This is what a search result needs: it names a note anywhere under the root,
 * and the tree can only reveal it if each of its ancestors has been listed and
 * expanded. Returning the whole chain (rather than just the parent) is what
 * makes opening a result from a folder nobody has clicked work in one step.
 */
export function ancestorFolders(folder: string): string[] {
  if (!folder) return ['']

  const chain = ['']
  const segments = folder.split('/')
  let path = ''
  for (const segment of segments) {
    // A path is never built out of an empty segment: `a//b` would otherwise
    // produce `a/` and `a//b`, neither of which any listing is keyed by.
    if (!segment) continue
    path = path ? `${path}/${segment}` : segment
    chain.push(path)
  }

  return chain
}

/**
 * A folder written for a person: `raíz / 2026 / agosto`, with the context
 * folder's own name at the head. The root on its own is just that name.
 */
export function folderLabel(rootLabel: string, folder: string): string {
  return [rootLabel, ...(folder ? folder.split('/') : [])].join(' / ')
}

/** The last segment of an absolute path — the context folder's own name. */
export function folderName(absPath: string): string {
  const segments = absPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return segments[segments.length - 1] || absPath
}
