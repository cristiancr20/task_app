'use client'

import { Fragment, useMemo } from 'react'

import type { Block, InlineNode } from '@/lib/markdown'
import { parseMarkdown } from '@/lib/markdown'

/**
 * Render a Markdown string as React elements.
 *
 * The parser hands over plain data and every node becomes an element here, so
 * nothing in a transcript is ever inserted as HTML. Blocks are keyed by index,
 * which is stable because the tree is derived from the text and never reordered.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])

  return <div className="flex flex-col gap-4">{blocks.map(renderBlock)}</div>
}

/**
 * The size of a heading is inherited from the reading surface (the article sets
 * the base) and only the ratio is set here, so the same tree reads at one size
 * in the transcript and at another wherever else it is rendered.
 *
 * `mt-2` on the top three: a section title needs more air above it than the gap
 * between two paragraphs, or it belongs to the paragraph it follows.
 */
const HEADING_CLASS: Record<number, string> = {
  1: 'mt-2 text-[1.35em] font-semibold tracking-tight',
  2: 'mt-2 text-[1.2em] font-semibold tracking-tight',
  3: 'mt-2 text-[1.05em] font-semibold',
  4: 'text-[1em] font-semibold',
  5: 'text-[0.95em] font-semibold text-muted',
  6: 'text-[0.9em] font-medium uppercase tracking-wide text-muted',
}

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag
          key={key}
          className={`${HEADING_CLASS[block.level]} text-content`}
        >
          {renderInline(block.children)}
        </Tag>
      )
    }

    case 'paragraph':
      // Single newlines inside a paragraph are kept as line breaks: meeting
      // notes use them for speaker turns, and collapsing them loses the shape.
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {renderInline(block.children)}
        </p>
      )

    case 'code':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-[0.85em] leading-relaxed"
        >
          <code>{block.value}</code>
        </pre>
      )

    case 'quote':
      return (
        <blockquote
          key={key}
          className="flex flex-col gap-2 rounded-r-lg border-l-2 border-accent/40 bg-surface-2/60 py-2 pl-4 pr-3 text-muted"
        >
          {block.children.map(renderBlock)}
        </blockquote>
      )

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          key={key}
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={`flex flex-col gap-1.5 pl-5 ${
            block.ordered
              ? 'list-decimal marker:text-muted'
              : 'list-disc marker:text-muted/70'
          }`}
        >
          {block.items.map((item, at) => (
            <li key={at} className="break-words pl-0.5">
              {renderItem(item)}
            </li>
          ))}
        </Tag>
      )
    }

    case 'rule':
      return <hr key={key} className="border-line" />
  }
}

/**
 * A list item whose content is a single paragraph renders inline, so the bullet
 * sits next to its text instead of above a block with its own spacing.
 */
function renderItem(blocks: Block[]) {
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return renderInline(blocks[0].children)
  }
  return <div className="flex flex-col gap-2">{blocks.map(renderBlock)}</div>
}

function renderInline(nodes: InlineNode[]) {
  return nodes.map((node, key) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.value}</Fragment>

      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]"
          >
            {node.value}
          </code>
        )

      case 'strong':
        return (
          <strong key={key} className="font-semibold text-content">
            {renderInline(node.children)}
          </strong>
        )

      case 'em':
        return (
          <em key={key} className="italic">
            {renderInline(node.children)}
          </em>
        )

      case 'del':
        return (
          <del key={key} className="text-muted line-through">
            {renderInline(node.children)}
          </del>
        )

      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-2 hover:text-accent-soft"
          >
            {renderInline(node.children)}
          </a>
        )
    }
  })
}
