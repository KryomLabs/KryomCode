// Advisory destructive-pattern warnings for terminal commands. These
// labels are metadata for the user, not a safety verdict: a command with
// no warnings is NOT certified safe, and execution always requires the
// user to explicitly run it.

const DESTRUCTIVE_PATTERNS = [
  {
    pattern: /\brm\s+[^|;&]*-[a-z]*r[a-z]*f/i,
    label: 'Recursive forced delete (rm -rf).',
  },
  {
    pattern: /\brd\s+\/s\b/i,
    label: 'Windows recursive delete (rd /s).',
  },
  {
    pattern: /\bdel\b[^|;&]*\/[sq]\b/i,
    label: 'Windows destructive delete flags.',
  },
  {
    pattern: /\b(format|mkfs)\b/i,
    label: 'Disk formatting command.',
  },
  {
    pattern: /:\(\)\s*\{\s*:|:&\s*\};:/,
    label: 'Fork-bomb pattern.',
  },
  {
    pattern: /\b(shutdown|reboot|halt)\b/i,
    label: 'System shutdown or reboot.',
  },
  {
    pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*d[a-z]*f|push\s+[^\s]*\s*[^\s]*--force)/i,
    label: 'Destructive git operation.',
  },
  {
    pattern: /\bDROP\s+(TABLE|DATABASE)\b/i,
    label: 'SQL drop statement.',
  },
]

function classifyCommand(command) {
  if (typeof command !== 'string') {
    return []
  }

  return DESTRUCTIVE_PATTERNS.filter((entry) =>
    entry.pattern.test(command)
  ).map((entry) => entry.label)
}

module.exports = {
  classifyCommand,
}
