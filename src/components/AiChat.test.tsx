// AiChat attachment tests: native file picking, chips, removal,
// and excerpt injection into the request context. Uncontrolled
// (local state) plus the controlled props ChatSessions uses.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AiChat } from './AiChat'

const CATALOG_MODELS = [
  {
    providerId: 'meta',
    providerName: 'Meta AI',
    modelId: 'muse-spark-1.3',
    displayName: 'Muse Spark 1.3',
    capabilities: { text: true, streaming: false, vision: false, tools: false },
    contextWindow: null,
    tokenUsage: false,
    isDefault: true,
  },
  {
    providerId: 'meta',
    providerName: 'Meta AI',
    modelId: 'muse-wonder-1.0',
    displayName: 'Muse Wonder 1.0',
    capabilities: { text: true, streaming: false, vision: false, tools: false },
    contextWindow: null,
    tokenUsage: false,
    isDefault: false,
  },
]

function mockBridge() {
  const bridge = {
    restoreChat: vi.fn(async () => ({ restored: false, messages: [] })),
    saveChat: vi.fn(async () => ({ saved: true })),
    getAIStatus: vi.fn(async () => ({ modelKeyConfigured: true })),
    listProviderModels: vi.fn(async () => ({ models: CATALOG_MODELS })),
    askAI: vi.fn(async (_args: unknown) => ({
      answer: 'attachment-reply',
      model: 'mock-model',
    })),
    cancelAI: vi.fn(async () => ({})),
    pickContextFiles: vi.fn(async () => ({
      canceled: true,
      paths: [] as string[],
    })),
    readContextFile: vi.fn(async (args: { path: string }) => ({
      path: args.path,
      name: args.path.split('/').pop() ?? args.path,
      chars: 42,
      truncated: false,
      excerpt: `excerpt-of-${args.path.split('/').pop() ?? args.path}`,
    })),
  }

  Object.defineProperty(window, 'kryom', {
    configurable: true,
    writable: true,
    value: bridge,
  })

  return bridge
}

function baseProps() {
  return {
    workspaceRoot: null as string | null,
    activeFile: null,
    fileName: '',
    fileContent: '',
    dirty: false,
    defaultModel: 'muse-spark-1.3',
    contextEnabled: false,
    onStatus: vi.fn(),
  }
}

function renderChat() {
  const props = baseProps()
  render(<AiChat {...props} />)
  return props
}

afterEach(() => {
  // Unmount first while the bridge double is still installed: the
  // restore/save effects settle against live mocks, and only then
  // are the globals torn down. Deleting first races still-mounted
  // effects and throws bridge-unavailable flakes.
  cleanup()
  Reflect.deleteProperty(window, 'kryom')
  vi.restoreAllMocks()
})

describe('AiChat attachments', () => {
  it('offers Attach files with no chips initially', () => {
    mockBridge()
    renderChat()
    expect(screen.getByRole('button', { name: 'Attach files' })).not.toBeNull()
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('picks files and shows one chip per file', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles.mockResolvedValueOnce({
      canceled: false,
      paths: ['/proj/a.ts', '/proj/b.ts'],
    })
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    expect(await screen.findByText('a.ts')).not.toBeNull()
    expect(screen.getByText('b.ts')).not.toBeNull()
    expect(bridge.readContextFile).toHaveBeenCalledWith({ path: '/proj/a.ts' })
    expect(bridge.readContextFile).toHaveBeenCalledWith({ path: '/proj/b.ts' })
  })

  it('sends excerpts as a delimited context block', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles.mockResolvedValueOnce({
      canceled: false,
      paths: ['/proj/a.ts'],
    })
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByText('a.ts')
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'explain' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText('attachment-reply')).not.toBeNull()
    const sent = bridge.askAI.mock.calls[0][0] as { context: string }
    expect(sent.context).toContain('Attached files (explicit user context)')
    expect(sent.context).toContain('excerpt-of-a.ts')
  })

  it('removes a chip and drops it from the next request', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles.mockResolvedValueOnce({
      canceled: false,
      paths: ['/proj/a.ts', '/proj/b.ts'],
    })
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.ts' }))
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText('b.ts')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'explain' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText('attachment-reply')
    const sent = bridge.askAI.mock.calls[0][0] as { context: string }
    expect(sent.context).not.toContain('excerpt-of-a.ts')
    expect(sent.context).toContain('excerpt-of-b.ts')
  })

  it('does nothing when the picker is cancelled', async () => {
    const bridge = mockBridge()
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    expect(bridge.pickContextFiles).toHaveBeenCalledTimes(1)
    expect(bridge.readContextFile).not.toHaveBeenCalled()
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('reports a failed read but keeps the rest', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles.mockResolvedValueOnce({
      canceled: false,
      paths: ['/proj/a.ts', '/proj/broken.ts'],
    })
    bridge.readContextFile.mockImplementation(async (args: { path: string }) => {
      if (args.path.endsWith('broken.ts')) {
        throw new Error('binary file')
      }

      return {
        path: args.path,
        name: 'a.ts',
        chars: 42,
        truncated: false,
        excerpt: 'excerpt-of-a.ts',
      }
    })
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    expect(await screen.findByText('a.ts')).not.toBeNull()
    expect(await screen.findByText(/Could not attach/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Could not attach/)).toBeNull()
  })

  it('skips files that are already attached', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles
      .mockResolvedValueOnce({ canceled: false, paths: ['/proj/a.ts'] })
      .mockResolvedValueOnce({
        canceled: false,
        paths: ['/proj/a.ts', '/proj/c.ts'],
      })
    renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    // The c.ts chip proves the second attach fully completed; a.ts
    // must not have been re-read.
    await screen.findByText('c.ts')
    const reads = bridge.readContextFile.mock.calls.filter(
      (call) => (call[0] as { path: string }).path === '/proj/a.ts'
    )
    expect(reads).toHaveLength(1)
  })

  it('supports controlled attachments from the parent', async () => {
    const bridge = mockBridge()
    const onAttachmentsChange = vi.fn()
    const props = {
      ...baseProps(),
      attachments: [
        {
          path: '/proj/a.ts',
          name: 'a.ts',
          chars: 42,
          truncated: false,
          excerpt: 'excerpt-of-a.ts',
        },
      ],
      onAttachmentsChange,
    }
    render(<AiChat {...props} />)
    expect(screen.getByText('a.ts')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.ts' }))
    expect(onAttachmentsChange).toHaveBeenCalledTimes(1)
    expect(typeof onAttachmentsChange.mock.calls[0][0]).toBe('function')
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'explain' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText('attachment-reply')
    const sent = bridge.askAI.mock.calls[0][0] as { context: string }
    expect(sent.context).toContain('excerpt-of-a.ts')
  })
})

describe('AiChat models', () => {
  it('lists catalog models and sends the selected id', async () => {
    const bridge = mockBridge()
    renderChat()
    await screen.findByRole('option', { name: 'Muse Wonder 1.0' })
    const select = screen.getByLabelText('AI model') as HTMLSelectElement
    expect(select.options.length).toBe(2)
    fireEvent.change(select, { target: { value: 'muse-wonder-1.0' } })
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText('attachment-reply')
    const sent = bridge.askAI.mock.calls[0][0] as { model: string }
    expect(sent.model).toBe('muse-wonder-1.0')
    expect(bridge.listProviderModels).toHaveBeenCalledWith({
      providerId: 'meta',
    })
  })

  it('falls back to the stored model when the catalog fails', async () => {
    const bridge = mockBridge()
    bridge.listProviderModels.mockRejectedValueOnce(new Error('offline'))
    renderChat()
    const select = (await screen.findByLabelText(
      'AI model'
    )) as HTMLSelectElement
    expect(select.options.length).toBe(1)
    expect(select.options[0].value).toBe('muse-spark-1.3')
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText('attachment-reply')
  })
})

describe('AiChat retry', () => {
  it('retries a failed prompt without duplicating the user message', async () => {
    const bridge = mockBridge()
    bridge.askAI
      .mockRejectedValueOnce(
        new Error(
          'Meta API request failed. Check your network connection and try again.'
        )
      )
      .mockResolvedValueOnce({ answer: 'second try', model: 'mock-model' })
    renderChat()
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'explain this' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText('Meta AI request failed')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('second try')
    expect(screen.getAllByText('explain this')).toHaveLength(1)
    expect(bridge.askAI).toHaveBeenCalledTimes(2)
    // The retry does not echo the prompt inside its own history.
    const second = bridge.askAI.mock.calls[1][0] as {
      history: unknown[]
    }
    expect(second.history).toEqual([])
  })

  it('offers provider settings for auth failures, not a retry', async () => {
    const bridge = mockBridge()
    bridge.askAI.mockRejectedValueOnce(
      new Error('Meta API authentication failed. Check MODEL_API_KEY and try again.')
    )
    const props = { ...baseProps(), onOpenConnections: vi.fn() }
    render(<AiChat {...props} />)
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(
      await screen.findByText('Meta AI authentication failed')
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Provider Settings' })
    )
    expect(props.onOpenConnections).toHaveBeenCalledTimes(1)
  })

  it('names rate limits and offers a retry', async () => {
    const bridge = mockBridge()
    bridge.askAI.mockRejectedValueOnce(
      new Error('Meta API rate limit reached. Wait a moment and try again.')
    )
    renderChat()
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(
      await screen.findByText('Meta AI rate limit reached')
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
  })
})

describe('AiChat status and suggestions', () => {
  it('shows live request status while waiting', async () => {
    const bridge = mockBridge()
    let resolveAsk!: (value: { answer: string; model: string }) => void
    bridge.askAI.mockImplementationOnce(
      () =>
        new Promise<{ answer: string; model: string }>((resolve) => {
          resolveAsk = resolve
        })
    )
    renderChat()
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'slow' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText(/Contacting Meta AI/)).not.toBeNull()
    await waitFor(() => expect(bridge.askAI).toHaveBeenCalledTimes(1))
    resolveAsk({ answer: 'late reply', model: 'mock-model' })
    await screen.findByText('late reply')
  })

  it('stops the in-flight request on Escape', async () => {
    const bridge = mockBridge()
    bridge.askAI.mockImplementationOnce(
      () => new Promise<{ answer: string; model: string }>(() => {})
    )
    const props = baseProps()
    render(<AiChat {...props} />)
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'slow' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText(/Contacting Meta AI/)
    // Dispatched on the document: it bubbles to the window listener.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(bridge.cancelAI).toHaveBeenCalledTimes(1)
    expect(props.onStatus).toHaveBeenCalledWith('AI request cancelled')
  })

  it('sends a file explanation from the empty-state chip', async () => {
    const bridge = mockBridge()
    render(
      <AiChat
        {...{
          ...baseProps(),
          workspaceRoot: '/proj',
          activeFile: '/proj/a.ts',
          fileName: 'a.ts',
          fileContent: 'const a = 1',
          contextEnabled: true,
        }}
      />
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Explain this file' })
    )
    await screen.findByText('attachment-reply')
    const sent = bridge.askAI.mock.calls[0][0] as {
      prompt: string
      context: string
    }
    expect(sent.prompt).toContain('Explain a.ts')
    expect(sent.context).toContain('const a = 1')
  })

  it('shows no chips without project context', () => {
    mockBridge()
    renderChat()
    expect(
      screen.queryByRole('button', { name: 'Explain this file' })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Summarize this project' })
    ).toBeNull()
  })
})

describe('AiChat code actions', () => {
  it('routes code blocks to the agent flow on request', async () => {
    const bridge = mockBridge()
    bridge.askAI.mockResolvedValueOnce({
      answer: '```ts\nconst x = 1\n```',
      model: 'mock-model',
    })
    const props = { ...baseProps(), onOpenInAgent: vi.fn() }
    render(<AiChat {...props} />)
    fireEvent.change(screen.getByLabelText('Ask Kryom AI'), {
      target: { value: 'give me code' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await screen.findByText('Send to Agent')
    fireEvent.click(screen.getByRole('button', { name: 'Send to Agent' }))
    expect(props.onOpenInAgent).toHaveBeenCalledTimes(1)
    expect(props.onOpenInAgent.mock.calls[0][0]).toContain('const x = 1')
  })

  it('opens attachments in the editor when wired', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles.mockResolvedValueOnce({
      canceled: false,
      paths: ['/proj/a.ts'],
    })
    const props = { ...baseProps(), onOpenFile: vi.fn() }
    render(<AiChat {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    expect(props.onOpenFile).toHaveBeenCalledWith('/proj/a.ts')
  })
})
