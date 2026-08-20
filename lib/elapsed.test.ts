import { describe, expect, it } from 'vitest'

import { formatElapsed } from '@/lib/elapsed'

const NOW = Date.parse('2026-08-19T12:00:00.000Z')

/** A stamp `days` days (and optionally `hours`) before `NOW`. */
function ago(days: number, hours = 0): string {
  return new Date(NOW - days * 86_400_000 - hours * 3_600_000).toISOString()
}

describe('formatElapsed', () => {
  it('reads the same instant as today', () => {
    expect(formatElapsed(new Date(NOW).toISOString(), NOW)).toBe('hoy')
  })

  it('reads anything less than a day old as today', () => {
    expect(formatElapsed(ago(0, 23), NOW)).toBe('hoy')
  })

  it('reads a day as yesterday', () => {
    expect(formatElapsed(ago(1), NOW)).toBe('ayer')
  })

  it.each([
    [2, 'hace 2 días'],
    [3, 'hace 3 días'],
    [6, 'hace 6 días'],
  ])('counts %i days in days', (days, expected) => {
    expect(formatElapsed(ago(days), NOW)).toBe(expected)
  })

  // Seven days is where the scale coarsens: from here on the reader wants an
  // order of magnitude, not a count.
  it.each([
    [7, 'hace 1 semana'],
    [13, 'hace 1 semana'],
    [14, 'hace 2 semanas'],
    [29, 'hace 4 semanas'],
  ])('counts %i days in weeks', (days, expected) => {
    expect(formatElapsed(ago(days), NOW)).toBe(expected)
  })

  it.each([
    [30, 'hace 1 mes'],
    [59, 'hace 1 mes'],
    [60, 'hace 2 meses'],
    [200, 'hace 6 meses'],
  ])('counts %i days in months', (days, expected) => {
    expect(formatElapsed(ago(days), NOW)).toBe(expected)
  })

  // Eleven is the last month: «hace 12 meses» followed by «hace 1 año» would
  // read as two different answers to the same question.
  it.each([
    [360, 'hace 11 meses'],
    [364, 'hace 11 meses'],
  ])('stops at eleven months (%i days)', (days, expected) => {
    expect(formatElapsed(ago(days), NOW)).toBe(expected)
  })

  it.each([
    [365, 'hace 1 año'],
    [500, 'hace 1 año'],
    [730, 'hace 2 años'],
  ])('counts %i days in years', (days, expected) => {
    expect(formatElapsed(ago(days), NOW)).toBe(expected)
  })

  // A machine whose clock disagrees with the one that wrote the stamp. «hoy» is
  // the smallest true thing to say; a negative age would claim the meeting has
  // not happened yet.
  it('reads a stamp in the future as today', () => {
    expect(formatElapsed(ago(-5), NOW)).toBe('hoy')
  })

  it.each([
    ['an empty string', ''],
    ['a sentence', 'el martes pasado'],
    ['a half-written date', '2026-13'],
  ])('answers null for %s', (_label, input) => {
    expect(formatElapsed(input, NOW)).toBeNull()
  })

  // The panel dates every row against one instant, so the same stamp must not
  // depend on when in the render it was read.
  it('is a pure function of the two arguments', () => {
    const stamp = ago(45)
    expect(formatElapsed(stamp, NOW)).toBe(formatElapsed(stamp, NOW))
  })
})
