// Conservative intent classifier (workbench redesign). Distinguishes
// ordinary Chat/Research requests (answered in the central Welcome /
// Discovery workspace) from coding-agent requests (file creation,
// code generation or modification, implementation, debugging). Only
// STRONG action signals route to the agent; ambiguous input stays
// where the user typed it — the classifier never silently moves a
// request. Pure and dependency-free, covered by check-workbench.
export type IntentKind = 'chat' | 'research' | 'agent'

// Explicit coding actions. Each pattern requires an action verb plus
// a code/target object so questions ABOUT code ("what does this
// function do") stay in chat while requests to CHANGE code route to
// the agent.
const AGENT_PATTERNS: RegExp[] = [
  /\bcreate\s+(a\s+|an\s+|the\s+|new\s+)?(\w+\s+){0,2}(file|component|module|class|function|test|endpoint|api|script|page|migration)\b/i,
  /\b(add|implement)\s+(a\s+|an\s+|the\s+|new\s+)?(\w+\s+){0,2}(feature|function|method|endpoint|route|component|test|validation|handler|middleware)\b/i,
  /\b(generate|write|scaffold)\s+(the\s+|me\s+|some\s+|my\s+)?(\w+\s+){0,2}(code|implementation|boilerplate|tests?|component|function|class|script)\b/i,
  /\b(modify|update|change|edit|refactor|rewrite|migrate)\s+(the\s+|this\s+|that\s+|my\s+)?(\w+\s+){0,2}(code|file|function|component|implementation|logic)\b/i,
  /\b(fix|debug|repair|resolve)\s+(the\s+|this\s+|that\s+|my\s+|a\s+|an\s+)?(\w+\s+){0,2}(bug|error|issue|failure|failures|test|tests|crash|exception|file|code)\b/i,
  /\bfix\s+[a-z0-9_./-]+\.(ts|tsx|js|jsx|py|java|rs|go|c|cpp|rb|php)\b/i,
  /\bimplement\s+(this|that|it|the\s+plan|from\s+research|the\s+brief)\b/i,
  /\brun\s+the\s+(project\s+)?implementation\b/i,
  /\b(plan\s+and\s+implement|plan\s*&\s*implement)\b/i,
  /\badd\s+(.+?\s+)?to\s+[a-z0-9_./-]+\.(ts|tsx|js|jsx|py|java|rs|go|c|cpp)\b/i,
  /\b(delete|remove)\s+(the\s+|this\s+)?(file|function|component|dead\s+code)\b/i,
]

// Explicit research signals. Ordinary questions ("what is X") stay in
// chat unless they ask for comparison, investigation, or sources.
const RESEARCH_PATTERNS: RegExp[] = [
  /\bresearch\b/i,
  /\bcompare\b.{0,40}\b(vs|versus|or|approach|approaches|options|alternatives|frameworks|libraries)\b/i,
  /\b(vs|versus)\b.{0,40}\b(which|better|best|difference|differences|compare)\b/i,
  /\b(investigate|survey|evaluate|assess)\s+(the\s+|available\s+|different\s+)?(options|approaches|libraries|frameworks|strategies|patterns)\b/i,
  /\bwhat\s+are\s+the\s+(best|recommended|standard)\s+(practices|approaches|patterns|libraries)\b/i,
  /\bfind\s+(me\s+)?(sources|citations|references|papers|articles)\b/i,
  /\bpros\s+and\s+cons\b/i,
  /\bstate\s+of\s+the\s+art\b/i,
]

export function classifyIntent(text: string): IntentKind {
  const input = text.trim()

  if (!input) {
    return 'chat'
  }

  for (const pattern of AGENT_PATTERNS) {
    if (pattern.test(input)) {
      return 'agent'
    }
  }

  for (const pattern of RESEARCH_PATTERNS) {
    if (pattern.test(input)) {
      return 'research'
    }
  }

  return 'chat'
}
