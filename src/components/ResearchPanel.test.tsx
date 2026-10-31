// ResearchPanel (Deep Research workspace) tests: composer + depth
// selection, tab navigation, source filtering, citation jumps,
// session rename/delete, export, handoff copy, and empty states.
// The desktop bridge is a mock installed via defineProperty;
// everything else is the production component.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResearchPanel } from './ResearchPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const COMPLETED_SESSION: KryomResearchSession = {
  id: 'rs-test1',
  version: 2,
  objective: 'Test research objective',
  name: '',
  depth: 'standard',
  questions: ['What is the state of the art?'],
  queries: [{ query: 'test query', questionId: 'q1', at: '2026-01-01T00:00:00.000Z' }],
  steps: [
    { id: 'planning', label: 'Planning research', status: 'done', detail: '2 questions', error: '', startedAt: null, finishedAt: null },
  ],
  plan: {
    subQuestions: [
      { id: 'q1', text: 'What is the state of the art?', queries: ['test query'], status: 'done', sourcesFound: 2 },
    ],
    searchTerms: ['test'],
    evidenceNeeds: ['Need primary sources.'],
    ambiguityNotes: [],
    via: 'extractive (keyword-driven)',
  },
  sources: [
    {
      id: 'src-aaa',
      provider: 'arxiv',
      title: 'First Test Paper',
      url: 'https://example.com/first',
      authors: ['Author One'],
      publishedAt: '2024-02-02',
      abstract: 'First abstract with enough text.',
      venue: 'arXiv',
      doi: null,
      sourceType: 'preprint',
      accessStatus: 'open',
      excerpt: '',
      supports: ['q1'],
      retrievedAt: '2026-01-01T00:00:00.000Z',
      quality: { signals: [{ label: 'Open access', detail: 'Readable.', polarity: 'positive' }], summary: 'Usable.' },
    },
    {
      id: 'src-bbb',
      provider: 'duckduckgo',
      title: 'Second Web Page',
      url: 'https://example.com/second',
      authors: [],
      publishedAt: null,
      abstract: '',
      venue: '',
      doi: null,
      sourceType: 'web',
      accessStatus: 'unknown',
      excerpt: 'A short web excerpt.',
      supports: ['q1'],
      retrievedAt: '2026-01-01T00:00:00.000Z',
      quality: null,
    },
  ],
  evidence: [],
  findings: [
    { claim: 'First finding claim.', sourceIndexes: [1], confidence: 'medium', note: 'note one' },
  ],
  claims: [
    { id: 'clm-1', text: 'First abstract with enough text.', sourceId: 'src-aaa', questionIds: ['q1'], method: 'extractive', status: 'insufficient-evidence', supportingSourceIds: [], explanation: 'No corroboration.' },
  ],
  conflicts: [],
  decisions: [],
  brief: { version: 1, markdown: '# Report\n\nClaim text [1] and more [2].\n', generatedAt: '2026-01-01', via: 'extractive' },
  implementationTasks: ['Task one.'],
  verification: [],
  errors: [],
  status: 'completed',
  statusDetail: 'Research completed with 2 source(s).',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function mockBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    listProviderModels: vi.fn(async () => ({
      models: [
        { providerId: 'meta', providerName: 'Meta AI', modelId: 'muse-spark-1.3', displayName: 'Muse Spark 1.3' },
        { providerId: 'meta', providerName: 'Meta AI', modelId: 'muse-wonder-1.0', displayName: 'Muse Wonder 1.0' },
      ],
    })),
    getActiveResearch: vi.fn(async () => null),
    listResearch: vi.fn(async () => []),
    startResearch: vi.fn(async (_args: unknown) => ({ id: 'rs-test1', status: 'running' })),
    getResearchStatus: vi.fn(async () => COMPLETED_SESSION),
    cancelResearch: vi.fn(async () => COMPLETED_SESSION),
    resumeResearch: vi.fn(async () => ({ id: 'rs-test1', status: 'running' })),
    selectResearch: vi.fn(async () => ({ id: 'rs-test1' })),
    renameResearch: vi.fn(async (_args: unknown) => COMPLETED_SESSION),
    deleteResearch: vi.fn(async () => ({ id: 'rs-test1', deleted: true })),
    searchResearch: vi.fn(async () => []),
    exportResearch: vi.fn(async (_args: unknown) => ({ id: 'rs-test1', format: 'markdown', fileName: 'report-rs-test1.md', content: '# Report' })),
    handoffResearch: vi.fn(async () => ({ id: 'rs-test1', target: 'chat', text: 'handoff text' })),
    exportBriefDocx: vi.fn(async () => ({ bytes: 2048 })),
    saveAs: vi.fn(async () => ({ path: '/tmp/report.md' })),
    openExternal: vi.fn(async () => ({ success: true })),
    ...overrides,
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
    onStatus: vi.fn(),
    onImplement: vi.fn(),
    onAsk: vi.fn(),
  }
}

describe('ResearchPanel workspace', () => {
  it('asks for a workspace before anything else', () => {
    mockBridge()
    render(<ResearchPanel {...baseProps()} workspaceRoot={null} />)

    expect(screen.getByText('Open a project to run research.')).not.toBeNull()
  })

  it('starts research with the selected depth and model', async () => {
    const bridge = mockBridge()
    render(<ResearchPanel {...baseProps()} />)

    fireEvent.change(screen.getByLabelText('Research objective'), {
      target: { value: 'my topic' },
    })
    await screen.findByRole('option', { name: 'Muse Wonder 1.0' })
    fireEvent.change(screen.getByLabelText('Research depth'), {
      target: { value: 'deep' },
    })
    fireEvent.change(screen.getByLabelText('Research model'), {
      target: { value: 'muse-wonder-1.0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start research' }))

    await waitFor(() => expect(bridge.startResearch).toHaveBeenCalledTimes(1))
    expect(bridge.startResearch.mock.calls[0][0]).toMatchObject({
      objective: 'my topic',
      depth: 'deep',
      model: 'muse-wonder-1.0',
    })
  })

  it('loads the active session and navigates tabs without losing state', async () => {
    mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Sources/ }))
    expect(screen.getByText(/First Test Paper/)).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Evidence/ }))
    expect(screen.getByText(/insufficient-evidence/)).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    expect(screen.getByText(/First finding claim/)).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Report/ }))
    expect(await screen.findAllByRole('button', { name: 'Open source 1' })).not.toHaveLength(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))
    expect(screen.getByText(/extractive \(keyword-driven\)/)).not.toBeNull()
  })

  it('filters sources by type and inspects details', async () => {
    mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Sources/ }))

    fireEvent.change(screen.getByLabelText('Filter by source type'), {
      target: { value: 'web' },
    })

    expect(screen.queryByText(/First Test Paper/)).toBeNull()
    expect(screen.getByText(/Second Web Page/)).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Filter by source type'), {
      target: { value: 'all' },
    })
    fireEvent.change(screen.getByLabelText('Filter sources'), {
      target: { value: 'first test' },
    })

    expect(screen.getByText(/First Test Paper/)).not.toBeNull()
    expect(screen.queryByText(/Second Web Page/)).toBeNull()
  })

  it('jumps from a report citation to the source detail', async () => {
    mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Report/ }))

    const citations = await screen.findAllByRole('button', { name: 'Open source 1' })
    fireEvent.click(citations[0])

    expect(await screen.findByTestId('source-detail-1')).not.toBeNull()
    expect(screen.getByText(/Author One/)).not.toBeNull()
  })

  it('renames a session through the bridge', async () => {
    const bridge = mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Session name'), {
      target: { value: 'New name' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(bridge.renameResearch).toHaveBeenCalledTimes(1))
    expect(bridge.renameResearch.mock.calls[0][0]).toMatchObject({
      id: 'rs-test1',
      name: 'New name',
    })
  })

  it('confirms before deleting a session', async () => {
    const bridge = mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    bridge.listResearch = vi.fn(async () => [
      { id: 'rs-test1', objective: 'Test research objective', status: 'completed', sources: 2, briefVersion: 1, updatedAt: '', createdAt: '' },
    ])
    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    const deleteButton = await screen.findByRole('button', { name: 'Delete session rs-test1' })
    fireEvent.click(deleteButton)

    expect(bridge.deleteResearch).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(deleteButton)

    await waitFor(() => expect(bridge.deleteResearch).toHaveBeenCalledTimes(1))
  })

  it('exports markdown through export plus save-as', async () => {
    const bridge = mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Report/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Markdown' }))

    await waitFor(() => expect(bridge.exportResearch).toHaveBeenCalledTimes(1))
    expect(bridge.exportResearch.mock.calls[0][0]).toMatchObject({ id: 'rs-test1', format: 'markdown' })
    expect(bridge.saveAs).toHaveBeenCalledTimes(1)
  })

  it('copies a chat handoff from the findings tab', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const bridge = mockBridge({ getActiveResearch: vi.fn(async () => COMPLETED_SESSION) })
    render(<ResearchPanel {...baseProps()} />)

    expect(await screen.findByText(/COMPLETED/)).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy chat handoff' }))

    await waitFor(() => expect(bridge.handoffResearch).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith('handoff text')
  })

  it('shows an error box when research fails to start', async () => {
    mockBridge({ startResearch: vi.fn(async () => { throw new Error('boom') }) })
    render(<ResearchPanel {...baseProps()} />)

    fireEvent.change(screen.getByLabelText('Research objective'), {
      target: { value: 'failing topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start research' }))

    expect(await screen.findByRole('alert')).not.toBeNull()
    expect(screen.getByText('boom')).not.toBeNull()
  })
})
