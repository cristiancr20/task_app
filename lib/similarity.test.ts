import { describe, expect, it } from 'vitest'

import {
  bestMatch,
  DUPLICATE_THRESHOLD,
  normalizeForMatch,
  similarity,
} from '@/lib/similarity'

describe('normalizeForMatch', () => {
  it('lowercases, drops diacritics and punctuation, and collapses spaces', () => {
    expect(normalizeForMatch('  ¡MIGRACIÓN,   del Endpoint (de pagos)!  ')).toBe(
      'migracion endpoint pagos',
    )
  })

  it('reads ñ as n, so a title typed without the tilde is the same title', () => {
    expect(normalizeForMatch('Añadir señal')).toBe(normalizeForMatch('Anadir senal'))
  })

  it('keeps digits, which is often the whole difference between two tasks', () => {
    expect(normalizeForMatch('Cerrar el sprint 12')).toBe('cerrar sprint 12')
  })

  it('drops stop words in Spanish and in English', () => {
    expect(normalizeForMatch('El informe de las ventas')).toBe('informe ventas')
    expect(normalizeForMatch('The report of the sales')).toBe('report sales')
  })

  it('drops the filler verbs a title opens with', () => {
    expect(normalizeForMatch('Revisar el contrato')).toBe('contrato')
    expect(normalizeForMatch('Check the invoice')).toBe('invoice')
  })

  it('keeps the filler words when they are all the title has', () => {
    expect(normalizeForMatch('Revisar')).toBe('revisar')
    expect(normalizeForMatch('De la')).toBe('de la')
  })

  it('empties a text that carries nothing to compare', () => {
    expect(normalizeForMatch('')).toBe('')
    expect(normalizeForMatch('   ')).toBe('')
    expect(normalizeForMatch('¿...!')).toBe('')
  })
})

describe('similarity', () => {
  it('scores an identical text 1', () => {
    expect(similarity('Migrar endpoint de pagos', 'Migrar endpoint de pagos')).toBe(1)
  })

  it('ignores case, accents and punctuation entirely', () => {
    expect(similarity('Migración del endpoint de pagos', 'MIGRACION, DEL ENDPOINT DE PAGOS!')).toBe(1)
    expect(similarity('Enviar el presupuesto', 'enviar   presupuesto...')).toBe(1)
  })

  it('scores a reformulation of the same task above the threshold', () => {
    const reformulations: [string, string][] = [
      ['Migrar endpoint de pagos', 'Migración del endpoint de pagos'],
      ['Enviar el presupuesto a Marta', 'Mandar presupuesto a Marta'],
      ['Actualizar la documentación del API', 'Actualizar docs de la API'],
      ['Revisar el contrato de alquiler', 'Contrato de alquiler'],
      ['Sincronizar los precios con el ERP', 'Sincronizar precios con ERP'],
    ]

    for (const [a, b] of reformulations) {
      expect(similarity(a, b), `${a} / ${b}`).toBeGreaterThan(DUPLICATE_THRESHOLD)
    }
  })

  it('scores tasks that are plainly different below the threshold', () => {
    const different: [string, string][] = [
      ['Migrar endpoint de pagos', 'Enviar el presupuesto a Marta'],
      ['Corregir el bug del login', 'Añadir tests al checkout'],
      ['Preparar la demo para el cliente', 'Contratar a un diseñador'],
      // The hard one: same subject, different work.
      ['Migrar endpoint de pagos a la nueva API', 'Documentar el endpoint de pagos en la wiki'],
    ]

    for (const [a, b] of different) {
      expect(similarity(a, b), `${a} / ${b}`).toBeLessThan(DUPLICATE_THRESHOLD)
    }
  })

  it('scores 0 against an empty text, whichever side it is on', () => {
    expect(similarity('', 'Enviar el presupuesto')).toBe(0)
    expect(similarity('Enviar el presupuesto', '')).toBe(0)
    expect(similarity('', '')).toBe(0)
    // A text that normalises to nothing is empty too.
    expect(similarity('   ¿?  ', 'Enviar el presupuesto')).toBe(0)
  })

  it('does not drift high on two long texts that share nothing but Spanish', () => {
    const a =
      'Preparar la presentación trimestral de resultados para el consejo, incluyendo las cifras de ingresos por región y el desglose de costes operativos del último semestre'
    const b =
      'Organizar la mudanza de la oficina al nuevo edificio, coordinando con el proveedor de internet y avisando a los empleados con antelación suficiente'

    expect(similarity(a, b)).toBeLessThan(0.3)
  })

  it('does not call a short title a duplicate of the paragraph that contains it', () => {
    const score = similarity(
      'Enviar presupuesto',
      'Enviar el presupuesto a Marta el viernes antes de las seis para que lo revise el equipo de compras',
    )

    expect(score).toBeLessThan(DUPLICATE_THRESHOLD)
  })

  it('stays within 0 and 1 and does not care about the order of the arguments', () => {
    const pairs: [string, string][] = [
      ['Migrar endpoint de pagos', 'Migración del endpoint de pagos'],
      ['Revisar', 'Revisar el contrato'],
      ['a', 'Enviar el presupuesto'],
      ['12', '13'],
    ]

    for (const [a, b] of pairs) {
      const score = similarity(a, b)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
      expect(similarity(b, a)).toBe(score)
    }
  })

  it('scores 0 when the texts share no word and no pair of characters', () => {
    expect(similarity('demo', 'ir')).toBe(0)
  })
})

describe('bestMatch', () => {
  const issues = [
    'Contratar a un diseñador',
    'Migración del endpoint de pagos',
    'Preparar la demo para el cliente',
  ]

  it('returns null when there is nothing to compare against', () => {
    expect(bestMatch('Migrar endpoint de pagos', [])).toBeNull()
  })

  it('returns the closest element and the score it got', () => {
    const match = bestMatch('Migrar endpoint de pagos', issues)

    expect(match?.item).toBe('Migración del endpoint de pagos')
    expect(match?.score).toBeGreaterThan(DUPLICATE_THRESHOLD)
    expect(match?.score).toBe(similarity('Migrar endpoint de pagos', 'Migración del endpoint de pagos'))
  })

  it('reads the text out of a richer element when told how', () => {
    const existing = [
      { id: '1', title: 'Contratar a un diseñador' },
      { id: '2', title: 'Migración del endpoint de pagos' },
    ]

    const match = bestMatch('Migrar endpoint de pagos', existing, (issue) => issue.title)

    expect(match?.item.id).toBe('2')
  })

  it('still answers when nothing is close, so the caller applies the threshold', () => {
    const match = bestMatch('Ordenar el trastero', issues)

    expect(match).not.toBeNull()
    expect(match?.score).toBeLessThan(DUPLICATE_THRESHOLD)
  })

  it('keeps the first element of a tie, so the destination order survives', () => {
    const match = bestMatch('Enviar el presupuesto', ['Presupuesto', 'Presupuesto'])

    expect(match?.item).toBe('Presupuesto')
  })

  it('scores every element 0 when the candidate is empty', () => {
    const match = bestMatch('', issues)

    expect(match?.score).toBe(0)
  })
})
