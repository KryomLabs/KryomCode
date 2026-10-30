// AiChat attachment tests: native file picking, chips, removal,
// and excerpt injection into the request context. Uncontrolled
// (local state) plus the controlled props ChatSessions uses.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AiChat } from './AiChat'

function mockBridge() {
  const bridge = {
    restoreChat: vi.fn(async () => ({ restored: false, messages: [] })),
    saveChat: vi.fn(async () => ({ saved: true })),
    getAIStatus: vi.fn(async () => ({ modelKeyConfigured: true })),
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
