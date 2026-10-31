// WelcomePage routing tests: the hero collects the first prompt per
// mode and hands it to the real AiChat / ResearchPanel components,
// which call the desktop bridge. The bridge is a mock installed via
// defineProperty (no casts); everything else is the production path.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DialogProvider } from './dialogs'
import { WelcomePage, type DiscoveryMode } from './WelcomePage'

function renderWelcome(props: Parameters<typeof WelcomePage>[0]) {
  return render(
    <DialogProvider>
      <WelcomePage {...props} />
    </DialogProvider>
  )
}

function mockBridge() {
  const bridge = {
    restoreChat: vi.fn(async () => ({ restored: false, messages: [] })),
    saveChat: vi.fn(async () => ({ saved: true })),
    getAIStatus: vi.fn(async () => ({ modelKeyConfigured: true })),
    listProviderModels: vi.fn(async () => ({ models: [] })),
    askAI: vi.fn(async (_args: unknown) => ({
      answer: 'mock reply',
      model: 'mock-model',
    })),
    cancelAI: vi.fn(async () => ({})),
    getActiveResearch: vi.fn(async () => null),
    listResearch: vi.fn(async () => []),
    startResearch: vi.fn(async (_args: unknown) => DONE_SESSION),
    getResearchStatus: vi.fn(async () => DONE_SESSION),
  }

  Object.defineProperty(window, 'kryom', {
    configurable: true,
    writable: true,
    value: bridge,
  })

  return bridge
}

const DONE_SESSION: KryomResearchSession = {
  id: 'r1',
  version: 1,
  objective: 'test topic',
  questions: [],
  queries: [],
  steps: [],
  sources: [],
  evidence: [],
  findings: [],
  decisions: [],
  brief: { version: 1, markdown: '', generatedAt: null, via: 'test' },
  implementationTasks: [],
  verification: [],
  errors: [],
  status: 'completed',
  statusDetail: 'done',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function baseProps(mode: DiscoveryMode) {
  return {
    mode,
    onModeChange: vi.fn(),
    workspaceRoot: null as string | null,
    defaultModel: 'muse-spark-1.3',
    activeFile: null,
    fileName: '',
    fileContent: '',
    fileDirty: false,
    contextEnabled: false,
    chatResearchId: null,
    onDetachChatResearch: () => undefined,
    onOpenInAgent: () => undefined,
    onResearchImplement: () => undefined,
    onResearchAsk: () => undefined,
    onStatus: vi.fn(),
    onOpenProviderSettings: () => undefined,
  }
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

describe('WelcomePage', () => {
  it('shows the hero before the first submit and calls nothing', () => {
    const bridge = mockBridge()
    renderWelcome(baseProps('chat'))
    expect(screen.getByText('What should we build & discover?')).not.toBeNull()
    expect(screen.getByLabelText('Chat prompt')).not.toBeNull()
    expect(bridge.askAI).not.toHaveBeenCalled()
  })

  it('routes a chat hero submit to the AI backend', async () => {
    const bridge = mockBridge()
    renderWelcome(baseProps('chat'))
    fireEvent.change(screen.getByLabelText('Chat prompt'), {
      target: { value: 'explain closures' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('mock reply')).not.toBeNull()
    expect(bridge.askAI).toHaveBeenCalledTimes(1)
    expect(bridge.askAI.mock.calls[0][0]).toMatchObject({
      prompt: 'explain closures',
    })
    // The hero hands off to the experience.
    expect(screen.queryByText('What should we build & discover?')).toBeNull()
  })

  it('keeps per-mode progress: research still shows its hero', async () => {
    mockBridge()
    const props = baseProps('chat')
    const view = renderWelcome(props)
    fireEvent.change(screen.getByLabelText('Chat prompt'), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('mock reply')).not.toBeNull()
    view.rerender(
      <DialogProvider>
        <WelcomePage {...props} mode="research" />
      </DialogProvider>
    )
    expect(screen.getByLabelText('Research topic')).not.toBeNull()
  })

  it('refuses a research hero submit without a workspace', () => {
    const bridge = mockBridge()
    const props = baseProps('research')
    renderWelcome(props)
    const input = screen.getByLabelText('Research topic')
    fireEvent.change(input, {
      target: { value: 'test topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(props.onStatus).toHaveBeenCalledWith('Open a workspace to run research')
    expect(bridge.startResearch).not.toHaveBeenCalled()
    // The hero stays up with the typed text intact.
    expect(screen.getByLabelText('Research topic')).not.toBeNull()
    expect((input as HTMLInputElement).value).toBe('test topic')
  })

  it('routes a research hero submit to the research backend', async () => {
    const bridge = mockBridge()
    const props = { ...baseProps('research'), workspaceRoot: '/test' }
    renderWelcome(props)
    fireEvent.change(screen.getByLabelText('Research topic'), {
      target: { value: 'test topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()
    expect(bridge.startResearch).toHaveBeenCalledTimes(1)
    expect(bridge.startResearch.mock.calls[0][0]).toMatchObject({
      objective: 'test topic',
    })
  })

  it('consumes an external prompt like a hero submit', async () => {
    const bridge = mockBridge()
    const onInitialPromptConsumed = vi.fn()
    renderWelcome({
      ...baseProps('chat'),
      initialPrompt: { text: 'Explain this error', nonce: 7 },
      onInitialPromptConsumed,
    })
    expect(await screen.findByText('mock reply')).not.toBeNull()
    expect(bridge.askAI).toHaveBeenCalledTimes(1)
    expect(bridge.askAI.mock.calls[0][0]).toMatchObject({
      prompt: 'Explain this error',
    })
    expect(onInitialPromptConsumed).toHaveBeenCalledTimes(1)
    // The hero hands off to the experience.
    expect(screen.queryByText('What should we build & discover?')).toBeNull()
  })
})
