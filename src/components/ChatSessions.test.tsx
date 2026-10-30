// ChatSessions tests: conversation tabs over AiChat, backed by a
// small stateful bridge double (the real session store is covered
// by the backend .cjs suite). Dialog flows run through the real
// DialogProvider.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DialogProvider } from './dialogs'
import { ChatSessions } from './ChatSessions'

interface SessionRow {
  id: string
  title: string
  messageCount: number
}

function mockBridge() {
  const state = {
    sessions: [
      { id: 'general', title: 'General', messageCount: 2 },
      { id: 's2', title: 'Debug auth', messageCount: 4 },
    ] as SessionRow[],
    activeId: 'general',
  }

  const bridge = {
    restoreChat: vi.fn(async () => ({ restored: false, messages: [] })),
    saveChat: vi.fn(async () => ({ saved: true })),
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
    listChatSessions: vi.fn(async () => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      activeId: state.activeId,
    })),
    createChatSession: vi.fn(async (_args: unknown) => {
      const created = {
        id: `s${state.sessions.length + 1}`,
        title: `Conversation ${state.sessions.length}`,
        messageCount: 0,
      }
      state.sessions.push(created)
      state.activeId = created.id
      return { ...created, updatedAt: '2026-01-01T00:00:00.000Z' }
    }),
    switchChatSession: vi.fn(async (args: { id: string }) => {
      const found = state.sessions.find((session) => session.id === args.id)

      if (!found) {
        throw new Error('Conversation was not found.')
      }

      state.activeId = found.id
      return { id: found.id, title: found.title, messages: [] }
    }),
    renameChatSession: vi.fn(async (args: { id: string; title?: string }) => {
      const found = state.sessions.find((session) => session.id === args.id)

      if (!found) {
        throw new Error('Conversation was not found.')
      }

      found.title = (args.title ?? '').trim() || found.title
      return { ...found, updatedAt: '2026-01-01T00:00:00.000Z' }
    }),
    deleteChatSession: vi.fn(async (args: { id: string }) => {
      state.sessions = state.sessions.filter(
        (session) => session.id !== args.id
      )

      if (state.activeId === args.id) {
        state.activeId = 'general'
      }

      return { id: args.id, deleted: true }
    }),
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
    workspaceRoot: '/test' as string | null,
    activeFile: null,
    fileName: '',
    fileContent: '',
    dirty: false,
    defaultModel: 'muse-spark-1.3',
    contextEnabled: false,
    onStatus: vi.fn(),
    pendingPrompt: null,
    researchSessionId: null,
    onDetachResearch: () => undefined,
    onOpenConnections: () => undefined,
    onOpenInAgent: () => undefined,
  }
}

function renderSessions() {
  const props = baseProps()

  render(
    <DialogProvider>
      <ChatSessions {...props} />
    </DialogProvider>
  )

  return props
}

afterEach(() => {
  Reflect.deleteProperty(window, 'kryom')
  vi.restoreAllMocks()
})

describe('ChatSessions', () => {
  it('hides the tab bar without a project and lists nothing', async () => {
    const bridge = mockBridge()
    const props = { ...baseProps(), workspaceRoot: null }

    render(
      <DialogProvider>
        <ChatSessions {...props} />
      </DialogProvider>
    )

    expect(screen.queryByRole('tablist')).toBeNull()
    expect(bridge.listChatSessions).not.toHaveBeenCalled()
    // AiChat still mounts beneath.
    expect(await screen.findByRole('textbox')).not.toBeNull()
  })

  it('lists conversations with the active tab pressed', async () => {
    mockBridge()
    renderSessions()
    const general = await screen.findByRole('tab', { name: 'General' })
    expect(general.getAttribute('aria-selected')).toBe('true')
    const other = screen.getByRole('tab', { name: 'Debug auth' })
    expect(other.getAttribute('aria-selected')).toBe('false')
    // General can neither be renamed nor deleted.
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('switches conversations through the tabs', async () => {
    const bridge = mockBridge()
    const props = renderSessions()
    fireEvent.click(await screen.findByRole('tab', { name: 'Debug auth' }))
    expect(bridge.switchChatSession).toHaveBeenCalledWith({ id: 's2' })
    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'Debug auth' }).getAttribute('aria-selected')
      ).toBe('true')
    })
    expect(props.onStatus).toHaveBeenCalledWith('Switched to Debug auth')
  })

  it('creates a new conversation and activates it', async () => {
    const bridge = mockBridge()
    renderSessions()
    await screen.findByRole('tab', { name: 'General' })
    fireEvent.click(screen.getByRole('button', { name: '+ New' }))
    expect(bridge.createChatSession).toHaveBeenCalledTimes(1)
    const created = await screen.findByRole('tab', { name: 'Conversation 2' })
    expect(created.getAttribute('aria-selected')).toBe('true')
  })

  it('renames the active conversation through a prompt', async () => {
    const bridge = mockBridge()
    renderSessions()
    fireEvent.click(await screen.findByRole('tab', { name: 'Debug auth' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Auth deep dive' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    expect(bridge.renameChatSession).toHaveBeenCalledWith({
      id: 's2',
      title: 'Auth deep dive',
    })
    expect(await screen.findByRole('tab', { name: 'Auth deep dive' })).not.toBeNull()
  })

  it('cancelling the rename prompt keeps the title', async () => {
    const bridge = mockBridge()
    renderSessions()
    fireEvent.click(await screen.findByRole('tab', { name: 'Debug auth' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(bridge.renameChatSession).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Debug auth' })).not.toBeNull()
  })

  it('deletes the active conversation after confirmation', async () => {
    const bridge = mockBridge()
    renderSessions()
    fireEvent.click(await screen.findByRole('tab', { name: 'Debug auth' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/permanently deleted/)).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(bridge.deleteChatSession).toHaveBeenCalledWith({ id: 's2' })
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Debug auth' })).toBeNull()
    })
    expect(
      screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')
    ).toBe('true')
  })

  it('cancelling the delete confirm keeps the conversation', async () => {
    const bridge = mockBridge()
    renderSessions()
    fireEvent.click(await screen.findByRole('tab', { name: 'Debug auth' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(bridge.deleteChatSession).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Debug auth' })).not.toBeNull()
  })

  it('keeps attachments scoped to their conversation', async () => {
    const bridge = mockBridge()
    bridge.pickContextFiles.mockResolvedValueOnce({
      canceled: false,
      paths: ['/proj/a.ts'],
    })
    renderSessions()
    await screen.findByRole('tab', { name: 'General' })
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('tab', { name: 'Debug auth' }))
    await waitFor(() => {
      expect(screen.queryByText('a.ts')).toBeNull()
    })
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    await screen.findByText('a.ts')
    // Restored from session state, not re-read from disk.
    expect(bridge.readContextFile).toHaveBeenCalledTimes(1)
  })

  it('reports session errors inline with dismissal', async () => {
    const bridge = mockBridge()
    Object.defineProperty(window, 'kryom', {
      configurable: true,
      writable: true,
      value: {
        ...bridge,
        listChatSessions: vi.fn(async () => {
          throw new Error('store offline')
        }),
      },
    })
    renderSessions()
    expect(await screen.findByText('store offline')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('store offline')).toBeNull()
  })
})
