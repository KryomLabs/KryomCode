import { useState, type ReactNode } from 'react'

// Dependency-free renderer for model and brief text. Supports fenced
// code blocks (with Copy), headings, lists, quotes, inline code, and
// bold. Everything renders as React text nodes: no HTML is parsed or
// executed, so untrusted output cannot inject markup or scripts.

type Block =
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string }

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const fence = line.match(/^```(\S*)\s*$/)

    if (fence) {
      const code: string[] = []
      index += 1

      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index])
        index += 1
      }

      // Skip the closing fence when present; unterminated fences
      // still render their collected lines.
      if (index < lines.length) {
        index += 1
      }

      blocks.push({ kind: 'code', lang: fence[1] || '', code: code.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)

    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      })
      index += 1
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)

    if (quote) {
      const quoted: string[] = []

      while (index < lines.length) {
        const match = lines[index].match(/^>\s?(.*)$/)

        if (!match) {
          break
        }

        quoted.push(match[1])
        index += 1
      }

      blocks.push({ kind: 'quote', text: quoted.join('\n') })
      continue
    }

    const listMarker = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)

    if (listMarker) {
      const ordered = /^\d/.test(listMarker[2])
      const items: string[] = []

      while (index < lines.length) {
        const match = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)

        if (!match) {
          break
        }

        items.push(match[3])
        index += 1
      }

      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (line.trim() === '') {
      index += 1
      continue
    }

    const para: string[] = []

    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !lines[index].startsWith('```') &&
      !lines[index].match(/^#{1,3}\s+/) &&
      !lines[index].match(/^>\s?/) &&
      !lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+/)
    ) {
      para.push(lines[index])
      index += 1
    }

    blocks.push({ kind: 'para', text: para.join('\n') })
  }

  return blocks
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const codeSplit = text.split(/(`[^`\n]+`)/g)

  return codeSplit.flatMap((part, partIndex) => {
    const codeMatch = part.match(/^`([^`\n]+)`$/)

    if (codeMatch) {
      return [
        <code key={`${keyPrefix}-c${partIndex}`} className="md-code">
          {codeMatch[1]}
        </code>,
      ]
    }

    return part.split(/(\*\*[^*\n]+\*\*)/g).map((chunk, chunkIndex) => {
      const boldMatch = chunk.match(/^\*\*([^*`\n]+)\*\*$/)

      if (boldMatch) {
        return (
          <strong key={`${keyPrefix}-b${partIndex}-${chunkIndex}`}>
            {boldMatch[1]}
          </strong>
        )
      }

      return (
        <span key={`${keyPrefix}-t${partIndex}-${chunkIndex}`}>{chunk}</span>
      )
    })
  })
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [status, setStatus] = useState<'copy' | 'copied' | 'failed'>('copy')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setStatus('copied')
      setTimeout(() => setStatus('copy'), 1500)
    } catch {
      setStatus('failed')
      setTimeout(() => setStatus('copy'), 1500)
    }
  }

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span className="muted">{lang || 'code'}</span>
        <button
          type="button"
          className="mini-btn"
          onClick={() => void copy()}
          title="Copy code to clipboard"
        >
          {status === 'copied'
            ? 'Copied'
            : status === 'failed'
              ? 'Copy unavailable'
              : 'Copy'}
        </button>
      </div>
      <pre className="md-pre">{code || ' '}</pre>
    </div>
  )
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = parseBlocks(text)

  if (blocks.length === 0) {
    return <span className="muted">(empty)</span>
  }

  return (
    <>
      {blocks.map((block, index) => {
        const key = `md-${index}`

        if (block.kind === 'code') {
          return <CodeBlock key={key} lang={block.lang} code={block.code} />
        }

        if (block.kind === 'heading') {
          const content = renderInline(block.text, key)

          if (block.level === 1) {
            return (
              <h4 key={key} className="md-heading">
                {content}
              </h4>
            )
          }

          if (block.level === 2) {
            return (
              <h5 key={key} className="md-heading">
                {content}
              </h5>
            )
          }

          return (
            <h6 key={key} className="md-heading">
              {content}
            </h6>
          )
        }

        if (block.kind === 'list') {
          const items = block.items.map((item, itemIndex) => (
            <li key={`${key}-i${itemIndex}`}>
              {renderInline(item, `${key}-i${itemIndex}`)}
            </li>
          ))

          return block.ordered ? (
            <ol key={key} className="md-list">
              {items}
            </ol>
          ) : (
            <ul key={key} className="md-list">
              {items}
            </ul>
          )
        }

        if (block.kind === 'quote') {
          return (
            <blockquote key={key} className="md-quote">
              {renderInline(block.text, key)}
            </blockquote>
          )
        }

        return (
          <p key={key} className="md-para">
            {renderInline(block.text, key)}
          </p>
        )
      })}
    </>
  )
}
