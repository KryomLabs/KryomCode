// Pure Meta AI timeline builder + provider-error classifier (Level
// 3C, Phase 4). Every timeline entry derives from a real record: a
// session message, a tracked plan step or verification report, a
// research step, an orchestration history entry, or a changed-file
// manifest entry. Nothing here invents progress, percentages, or
// completion — undated or unknown states render with their honest
// label or not at all. Minimal structural interfaces (instead of the
// global Kryom* contracts) keep this module dependency-free so the
// workbench regression gate compiles it standalone.
import type {
  MetaChangedFile,
  MetaMessage,
} from '../state/meta-sessions'

export type TimelineKind =
  | 'session'
  | 'message'
  | 'plan'
  | 'verification'
  | 'research'
  | 'orchestration'
  | 'file'

export interface TimelineEvent {
  at: string
  kind: TimelineKind
  label: string
  detail?: string
}

export interface TimelinePlanStep {
  label: string
  state: string
  startedAt: string | null
  finishedAt: string | null
  detail?: string
}

export interface TimelineReport {
  check: string
  conclusion: string
  at: string
}

export interface TimelinePlan {
  title: string
  status: string
  verification: string
  createdAt: string
  steps: TimelinePlanStep[]
  reports: TimelineReport[]
}

export interface TimelineResearchStep {
  label: string
  status: string
  detail?: string
  finishedAt: string | null
}

export interface TimelineResearch {
  objective: string
  status: string
  updatedAt: string
  steps: TimelineResearchStep[]
  sources: number
}

export interface TimelineOrchEntry {
  at: string
  kind: string
  task?: string
  reason?: string
}

export interface TimelineOrchRun {
  id: string
  state: string
  planTitle: string
  history: TimelineOrchEntry[]
}

export interface TimelineInput {
  sessionCreatedAt: string
  sessionTitle: string
  messages: MetaMessage[]
  plan: TimelinePlan | null
  research: TimelineResearch | null
  orchRun: TimelineOrchRun | null
  changedFiles: MetaChangedFile[]
}

const MAX_EVENTS = 100

function validDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) {
    return null
  }

  const time = Date.parse(value)

  return Number.isNaN(time) ? null : value
}

function push(
  events: TimelineEvent[],
  at: string | null,
  kind: TimelineKind,
  label: string,
  detail?: string
): void {
  if (!at) {
    return
  }

  events.push(detail === undefined ? { at, kind, label } : { at, kind, label, detail })
}

function humanizeState(state: string): string {
  return state.replace(/_/g, ' ')
}

export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = []

  push(
    events,
    validDate(input.sessionCreatedAt),
    'session',
    `Session started — ${input.sessionTitle}`
  )

  for (const message of input.messages) {
    if (message.role === 'user') {
      push(events, validDate(message.at), 'message', 'You asked', message.content.slice(0, 160))
    } else {
      push(
        events,
        validDate(message.at),
        'message',
        message.model ? `Meta AI responded (${message.model})` : 'Meta AI responded',
        message.content.slice(0, 160)
      )
    }
  }

  if (input.plan) {
    push(
      events,
      validDate(input.plan.createdAt),
      'plan',
      `Plan created — ${input.plan.title}`,
      `Status: ${humanizeState(input.plan.status)} · verification: ${humanizeState(input.plan.verification)}`
    )

    for (const step of input.plan.steps) {
      const stamp = validDate(step.finishedAt) ?? validDate(step.startedAt)

      push(
        events,
        stamp,
        'plan',
        `${step.label} — ${humanizeState(step.state)}`,
        step.detail ? step.detail.slice(0, 200) : undefined
      )
    }

    for (const report of input.plan.reports) {
      push(
        events,
        validDate(report.at),
        'verification',
        `Verification ${report.check}: ${humanizeState(report.conclusion)}`
      )
    }
  }

  if (input.research) {
    for (const step of input.research.steps) {
      if (step.status !== 'done' && step.status !== 'failed' && step.status !== 'skipped') {
        continue
      }

      push(
        events,
        validDate(step.finishedAt) ?? validDate(input.research.updatedAt),
        'research',
        `Research ${step.label} — ${humanizeState(step.status)}`,
        step.detail ? step.detail.slice(0, 200) : undefined
      )
    }

    push(
      events,
      validDate(input.research.updatedAt),
      'research',
      `Research ${humanizeState(input.research.status)} — ${input.research.sources} source(s)`,
      input.research.objective.slice(0, 160)
    )
  }

  if (input.orchRun) {
    for (const entry of input.orchRun.history) {
      const label =
        entry.kind === 'started'
          ? `Orchestration started — ${input.orchRun.planTitle}`
          : entry.task
            ? `Orchestration ${humanizeState(entry.kind)} — ${entry.task}`
            : `Orchestration ${humanizeState(entry.kind)}`

      push(events, validDate(entry.at), 'orchestration', label, entry.reason?.slice(0, 200))
    }
  }

  for (const file of input.changedFiles) {
    const verb =
      file.action === 'added'
        ? 'Added'
        : file.action === 'deleted'
          ? 'Deleted'
          : 'Modified'

    push(events, validDate(file.at), 'file', `${verb} ${file.path}`, `via ${file.source}`)
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  return events.slice(-MAX_EVENTS)
}

export type AIErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'cancelled'
  | 'missing-key'
  | 'unknown'

// Classifies provider failures from the backend's documented wording
// so the workspace can show the right recovery action. Anything
// unrecognized stays 'unknown' and renders verbatim.
export function classifyAIError(message: string): AIErrorKind {
  const text = message.toLowerCase()

  if (/cancelled/.test(text)) {
    return 'cancelled'
  }

  if (/not configured/.test(text)) {
    return 'missing-key'
  }

  if (/authentication failed|unauthorized|invalid.*(api key|key)|forbidden|401|403/.test(text)) {
    return 'auth'
  }

  if (/rate limit|429|too many requests/.test(text)) {
    return 'rate-limit'
  }

  if (/network connection|failed to fetch|fetch failed|networkerror|econn|enotfound|etimedout|timed out|offline/.test(text)) {
    return 'network'
  }

  return 'unknown'
}
