'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import { isTheme, THEME_COOKIE, type Theme } from '@/lib/theme'

/** A year: the preference should outlive the session that set it. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Save the chosen theme.
 *
 * The value arrives from the browser and the root layout interpolates it into
 * the `class` of `<html>`, so it is validated against THEMES before being
 * written — an unrecognised value is dropped rather than stored.
 */
export async function setTheme(theme: Theme): Promise<void> {
  if (!isTheme(theme)) return

  const cookieStore = await cookies()
  cookieStore.set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  })

  // The class is painted by the root layout, so the whole tree below it has to
  // be re-rendered — not just the page the toggle happens to sit on.
  revalidatePath('/', 'layout')
}
