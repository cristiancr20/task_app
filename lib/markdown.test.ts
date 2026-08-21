import { describe, expect, it } from 'vitest'

import { parseInline, parseMarkdown, type InlineNode } from '@/lib/markdown'

/** Every link anywhere in a tree of inline nodes, however deeply nested. */
function links(nodes: InlineNode[]): Extract<InlineNode, { type: 'link' }>[] {
  return nodes.flatMap((node) => {
    if (node.type === 'link') return [node, ...links(node.children)]
    if (node.type === 'strong' || node.type === 'em' || node.type === 'del') {
      return links(node.children)
    }
    return []
  })
}

/** The text a tree reads as, so a degraded construct can be asserted on. */
function plain(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.value
      return plain(node.children)
    })
    .join('')
}

describe('parseInline', () => {
  const URL = 'https://notes.granola.ai/t/5bfbb33b'

  it('does not nest a link inside a link when the label is a bare URL', () => {
    // The shape Granola writes every exported transcript link in. Rendered as
    // an `<a>` inside an `<a>` it is invalid HTML and breaks hydration.
    const nodes = parseInline(`[${URL}](${URL})`)

    expect(links(nodes)).toHaveLength(1)
    expect(nodes).toEqual([
      { type: 'link', href: URL, children: [{ type: 'text', value: URL }] },
    ])
  })

  it('does not nest a link when the label holds an angle autolink', () => {
    const nodes = parseInline(`[<${URL}>](${URL})`)

    expect(links(nodes)).toHaveLength(1)
    expect(plain(nodes)).toBe(`<${URL}>`)
  })

  it('does not nest a link when the label holds another link', () => {
    const nodes = parseInline('[ver [la nota](https://a.test) aquí](https://b.test)')

    expect(links(nodes)).toHaveLength(1)
    expect(links(nodes)[0]?.href).toBe('https://b.test')
  })

  it('keeps emphasis and code inside a label', () => {
    const nodes = parseInline('[el **informe** y el `csv`](https://a.test)')
    const [link] = links(nodes)

    expect(link?.children.map((child) => child.type)).toEqual([
      'text',
      'strong',
      'text',
      'code',
    ])
  })

  it('still autolinks a bare URL outside a label', () => {
    expect(parseInline(`Mira ${URL} ya`)).toEqual([
      { type: 'text', value: 'Mira ' },
      { type: 'link', href: URL, children: [{ type: 'text', value: URL }] },
      { type: 'text', value: ' ya' },
    ])
  })

  it('still resolves an angle autolink outside a label', () => {
    expect(parseInline(`<${URL}>`)).toEqual([
      { type: 'link', href: URL, children: [{ type: 'text', value: URL }] },
    ])
  })

  it('still reads an ordinary link with a text label', () => {
    expect(parseInline('[la nota](https://a.test)')).toEqual([
      { type: 'link', href: 'https://a.test', children: [{ type: 'text', value: 'la nota' }] },
    ])
  })
})

describe('parseMarkdown', () => {
  it('produces no nested link in a paragraph of a real transcript', () => {
    const url = 'https://notes.granola.ai/t/5bfbb33b-48e4-4045-a6bb-fc000a08bfc1'
    const [block] = parseMarkdown(`Chat with meeting transcript: [${url}](${url})`)

    expect(block?.type).toBe('paragraph')
    expect(links(block?.type === 'paragraph' ? block.children : [])).toHaveLength(1)
  })
})
