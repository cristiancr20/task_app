import 'server-only'

import { cookies } from 'next/headers'

import { isTheme, THEME_COOKIE, type Theme } from '@/lib/theme'

/**
 * The stored preference. Without a cookie — first visit, or a value we no
 * longer recognise — the answer is «system», which is what the app did before
 * there was a toggle at all.
 *
 * Marked `server-only` because it reads `next/headers`: importing it from a
 * client component must fail at build time, not at request time.
 */
export async function getTheme(): Promise<Theme> {
  const raw = (await cookies()).get(THEME_COOKIE)?.value
  return isTheme(raw) ? raw : 'system'
}
