/**
 * A small Markdown parser for the transcript preview.
 *
 * It produces a tree of plain data — never HTML — so the renderer can build
 * React elements and raw HTML inside a note can never execute. That is the
 * reason this exists instead of a dependency: transcripts are arbitrary files
 * on the user's disk, and the only constructs meeting notes actually use are
 * headings, lists, quotes, code and inline emphasis.
 *
 * Deliberately not supported: tables, reference links, footnotes and embedded
 * HTML, which degrade to plain text rather than breaking the layout.
 *
 * Pure data in, pure data out: no node imports, so client components may use it.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'del'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }

export type Block =
  | { type: 'heading'; level: number; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'rule' }

/** ```lang or ~~~lang, with up to three spaces of indentation. */
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?/
/** Indent, bullet or number, then the item's own text. */
const ITEM = /^( *)(?:([-*+])|(\d{1,9})[.)])(?:[ \t]+(.*))?$/

/** Parse a whole document into blocks. */
export function parseMarkdown(source: string): Block[] {
  // Tabs only ever act as indentation here, and treating them as spaces keeps
  // every indent comparison below a plain number.
  return parseBlocks(source.replace(/\t/g, '    ').split(/\r?\n/))
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const [block, next] = parseFence(lines, i, fence[1], fence[2])
      blocks.push(block)
      i = next
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        // A closing run of #'s is decoration, not content.
        children: parseInline((heading[2] ?? '').replace(/[ \t]+#+$/, '')),
      })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].replace(QUOTE, ''))
        i++
      }
      blocks.push({ type: 'quote', children: parseBlocks(quoted) })
      continue
    }

    if (ITEM.test(line)) {
      const [block, next] = parseList(lines, i)
      blocks.push(block)
      i = next
      continue
    }

    // Anything else is a paragraph: every line until a blank one or the start
    // of a block that interrupts it.
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !interrupts(lines[i])) {
      paragraph.push(lines[i].trim())
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }

  return blocks
}

/** Blocks that end an open paragraph without a blank line in between. */
function interrupts(line: string): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
  )
}

function parseFence(
  lines: string[],
  start: number,
  marker: string,
  lang: string,
): [Block, number] {
  const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`)
  const body: string[] = []
  let i = start + 1

  while (i < lines.length && !closing.test(lines[i])) {
    body.push(lines[i])
    i++
  }

  // An unterminated fence runs to the end of the file, as in CommonMark.
  return [{ type: 'code', lang: lang || null, value: body.join('\n') }, Math.min(i + 1, lines.length)]
}

/**
 * Collect one list and everything indented under it.
 *
 * Nesting is not handled here: an indented line keeps its extra indentation
 * once the item's own is removed, so the recursive `parseBlocks` of the item's
 * content sees a list of its own and builds the sublist.
 */
function parseList(lines: string[], start: number): [Block, number] {
  const first = ITEM.exec(lines[start])!
  const indent = first[1].length
  const ordered = first[2] === undefined
  const items: string[][] = []

  let current: string[] = [first[4] ?? '']
  let contentIndent = lines[start].length - (first[4] ?? '').length
  let i = start + 1

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      // A blank line only stays inside the list if indented content follows it.
      const next = lines.findIndex((it, at) => at > i && it.trim())
      if (next === -1 || (leadingSpaces(lines[next]) <= indent && !startsItem(lines[next], indent, ordered))) {
        break
      }
      current.push('')
      i++
      continue
    }

    const item = ITEM.exec(line)
    if (item && item[1].length <= indent) {
      // A different marker starts a different list rather than a new item.
      if ((item[2] === undefined) !== ordered) break
      items.push(current)
      current = [item[4] ?? '']
      contentIndent = line.length - (item[4] ?? '').length
      i++
      continue
    }

    if (leadingSpaces(line) > indent) {
      current.push(line.slice(Math.min(contentIndent, leadingSpaces(line))))
      i++
      continue
    }

    if (interrupts(line)) break

    // Lazy continuation: an unindented line still belongs to the open item.
    current.push(line.trim())
    i++
  }

  items.push(current)

  return [
    {
      type: 'list',
      ordered,
      start: ordered ? Number(first[3]) : 1,
      items: items.map(parseBlocks),
    },
    i,
  ]
}

function startsItem(line: string, indent: number, ordered: boolean): boolean {
  const item = ITEM.exec(line)
  return item !== null && item[1].length <= indent && (item[2] === undefined) === ordered
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length
}

/** Punctuation that a backslash may escape. */
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~>|]/
/** Longest first, so `**` is never read as two `*`. */
const EMPHASIS: ReadonlyArray<[string, 'strong' | 'em' | 'del']> = [
  ['**', 'strong'],
  ['__', 'strong'],
  ['~~', 'del'],
  ['*', 'em'],
  ['_', 'em'],
]
const BARE_URL = /^https?:\/\/[^\s<>[\]()]+[^\s<>[\]().,;:!?'"]/

/** Parse the inline markup of one paragraph, heading or list item. */
export function parseInline(source: string): InlineNode[] {
  return parseInlineNodes(source, false)
}

/**
 * `insideLink` is what keeps a link out of a link.
 *
 * HTML forbids an `<a>` inside an `<a>`; React renders the nesting anyway and
 * hydration then fails on it, taking the whole preview down. The label of a
 * link is inline markup like any other text, so `[https://x](https://x)` —
 * which is how Granola writes every transcript link it exports — autolinked
 * its own label into a second anchor inside the first.
 *
 * Inside a label the three branches that can produce a link are off and their
 * characters stay as text; emphasis and code still work, which is also what
 * CommonMark says («links may not contain other links, at any level of
 * nesting»). A nested `[text](url)` therefore reads as its own source rather
 * than becoming an anchor the browser would refuse to nest.
 */
function parseInlineNodes(source: string, insideLink: boolean): InlineNode[] {
  const nodes: InlineNode[] = []
  let text = ''
  let i = 0

  const flush = () => {
    if (text) nodes.push({ type: 'text', value: text })
    text = ''
  }

  while (i < source.length) {
    const rest = source.slice(i)
    const char = source[i]

    if (char === '\\' && ESCAPABLE.test(source[i + 1] ?? '')) {
      text += source[i + 1]
      i += 2
      continue
    }

    if (char === '`') {
      const run = /^`+/.exec(rest)![0]
      const close = source.indexOf(run, i + run.length)
      if (close !== -1) {
        flush()
        nodes.push({ type: 'code', value: source.slice(i + run.length, close).trim() })
        i = close + run.length
        continue
      }
    }

    if (!insideLink && (char === '[' || (char === '!' && source[i + 1] === '['))) {
      const link = matchLink(source, i)
      if (link) {
        flush()
        nodes.push(link.node)
        i = link.end
        continue
      }
    }

    if (!insideLink && char === '<') {
      const autolink = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/.exec(rest)
      if (autolink) {
        flush()
        nodes.push({ type: 'link', href: autolink[1], children: [{ type: 'text', value: autolink[1] }] })
        i += autolink[0].length
        continue
      }
    }

    if (!insideLink && char === 'h' && isBoundary(source[i - 1])) {
      const url = BARE_URL.exec(rest)
      if (url) {
        flush()
        nodes.push({ type: 'link', href: url[0], children: [{ type: 'text', value: url[0] }] })
        i += url[0].length
        continue
      }
    }

    const emphasis = matchEmphasis(source, i)
    if (emphasis) {
      flush()
      nodes.push(emphasis.node)
      i = emphasis.end
      continue
    }

    text += char
    i++
  }

  flush()
  return nodes
}

function matchEmphasis(source: string, start: number): { node: InlineNode; end: number } | null {
  for (const [delim, type] of EMPHASIS) {
    if (!source.startsWith(delim, start)) continue

    // `snake_case` and `a_b_c` are identifiers, not emphasis; `*` has no such
    // problem, so only the underscore forms need a word boundary.
    if (delim.startsWith('_') && !isBoundary(source[start - 1])) continue

    const from = start + delim.length
    if (source[from] === ' ' || source[from] === undefined) continue

    const close = findClose(source, from, delim)
    if (close === -1) continue

    return {
      node: { type, children: parseInline(source.slice(from, close)) },
      end: close + delim.length,
    }
  }
  return null
}

/** The next unescaped `delim` that is not preceded by a space. */
function findClose(source: string, from: number, delim: string): number {
  let at = source.indexOf(delim, from)
  while (at !== -1) {
    const escaped = source[at - 1] === '\\'
    const empty = at === from
    const spaced = source[at - 1] === ' '
    if (!escaped && !empty && !spaced) return at
    at = source.indexOf(delim, at + 1)
  }
  return -1
}

function matchLink(source: string, start: number): { node: InlineNode; end: number } | null {
  const image = source[start] === '!'
  const open = image ? start + 1 : start

  const labelEnd = matchBalanced(source, open, '[', ']')
  if (labelEnd === -1 || source[labelEnd + 1] !== '(') return null

  const targetEnd = matchBalanced(source, labelEnd + 1, '(', ')')
  if (targetEnd === -1) return null

  const label = source.slice(open + 1, labelEnd)
  // `(url "title")`: the title is metadata the preview has nowhere to show.
  const target = source.slice(labelEnd + 2, targetEnd).trim().split(/\s+/)[0] ?? ''
  const href = safeHref(target.replace(/^<|>$/g, ''))

  // An unusable target (`javascript:`, a reference link) still has readable
  // text, so the label survives as plain text instead of vanishing.
  if (!href) {
    return { node: { type: 'text', value: label }, end: targetEnd + 1 }
  }

  // An image has no place in a text preview; its alt text becomes the link label.
  const children = image
    ? [{ type: 'text' as const, value: label || href }]
    : parseInlineNodes(label, true)

  return { node: { type: 'link', href, children }, end: targetEnd + 1 }
}

/** Index of the `close` matching the `open` at `start`, or -1. */
function matchBalanced(source: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === open) depth++
    else if (source[i] === close && --depth === 0) return i
  }
  return -1
}

/**
 * Only schemes that are safe to put in an `href`. Anything else — most of all
 * `javascript:` — comes back null and the link renders as text.
 */
function safeHref(target: string): string | null {
  const href = target.trim()
  if (!href) return null
  if (/^(https?:|mailto:)/i.test(href)) return href
  // A scheme-less target is a fragment or a relative path, both harmless.
  return /^[a-z][a-z0-9+.-]*:/i.test(href) ? null : href
}

/** True at the start of the string or after a non-word character. */
function isBoundary(char: string | undefined): boolean {
  return char === undefined || !/[\p{L}\p{N}]/u.test(char)
}
