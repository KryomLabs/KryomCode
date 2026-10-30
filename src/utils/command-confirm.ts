// Pre-execution command confirmation (Level 2B.5). Commands with
// destructive-pattern warnings always confirm; the confirm-all
// setting extends that to every command. A failed warning scan
// fails closed (confirms with a scan-failure note).
export async function confirmCommandRun(
  command: string,
  options: {
    requireConfirmAll: boolean
    classify: (command: string) => Promise<string[]>
    confirm: (
      title: string,
      message: string,
      confirmLabel: string
    ) => Promise<boolean>
  }
): Promise<boolean> {
  let warnings: string[] | null = null

  try {
    warnings = await options.classify(command)
  } catch {
    warnings = null
  }

  if (
    warnings !== null &&
    warnings.length === 0 &&
    !options.requireConfirmAll
  ) {
    return true
  }

  const shown = command.length > 200 ? `${command.slice(0, 200)}…` : command
  const reason =
    warnings === null
      ? 'The command could not be scanned for destructive patterns.'
      : warnings.length > 0
        ? warnings.join(' ')
        : 'Confirm every command is enabled in Settings.'

  return options.confirm(
    'Run this command?',
    `"${shown}"\n\n${reason}`,
    'Run command'
  )
}
