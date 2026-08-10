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

const HEADING_CLASS: Record<number, string> = {
  1: 'text-xl font-semibold',
  2: 'text-lg font-semibold',
  3: 'text-base font-semibold',
  4: 'text-sm font-semibold',
  5: 'text-sm font-medium',
  6: 'text-sm font-medium text-zinc-600 dark:text-zinc-400',
}

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag
          key={key}
          className={`${HEADING_CLASS[block.level]} text-zinc-900 dark:text-zinc-100`}
        >
          {renderInline(block.children)}
        </Tag>
      )
    }

    case 'paragraph':
      // Single newlines inside a paragraph are kept as line breaks: meeting
      // notes use them for speaker turns, and collapsing them loses the shape.
      return (
        <p key={key} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {renderInline(block.children)}
        </p>
      )

    case 'code':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-zinc-100 p-3 text-xs leading-relaxed dark:bg-zinc-900"
        >
          <code>{block.value}</code>
        </pre>
      )

    case 'quote':
      return (
        <blockquote
          key={key}
          className="flex flex-col gap-2 border-l-2 border-zinc-300 pl-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
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
          className={`flex flex-col gap-1 pl-5 text-sm leading-relaxed ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, at) => (
            <li key={at} className="break-words">
              {renderItem(item)}
            </li>
          ))}
        </Tag>
      )
    }

    case 'rule':
      return <hr key={key} className="border-zinc-200 dark:border-zinc-800" />
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
            className="rounded bg-black/[.06] px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]"
          >
            {node.value}
          </code>
        )

      case 'strong':
        return (
          <strong key={key} className="font-semibold text-zinc-900 dark:text-zinc-100">
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
          <del key={key} className="text-zinc-500 line-through dark:text-zinc-500">
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
            className="text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400"
          >
            {renderInline(node.children)}
          </a>
        )
    }
  })
}
