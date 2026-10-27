// Pure tab-state helpers for the multi-file editor. No React, no I/O:
// App.tsx owns the state, these functions compute the transitions.

export interface TabState {
  path: string
  content: string
  savedContent: string
  mtimeMs: number | null
}

export function isDirty(tab: TabState): boolean {
  return tab.content !== tab.savedContent
}

export function findTab(tabs: TabState[], path: string): TabState | null {
  return tabs.find((tab) => tab.path === path) ?? null
}

export function dirtyTabs(tabs: TabState[]): TabState[] {
  return tabs.filter(isDirty)
}

// Appends the tab unless a tab with the same path is already open.
export function openTab(tabs: TabState[], tab: TabState): TabState[] {
  if (tabs.some((entry) => entry.path === tab.path)) {
    return tabs
  }

  return [...tabs, tab]
}

export function updateTab(
  tabs: TabState[],
  path: string,
  patch: Partial<TabState>
): TabState[] {
  return tabs.map((tab) =>
    tab.path === path ? { ...tab, ...patch } : tab
  )
}

export function removeTabs(tabs: TabState[], paths: string[]): TabState[] {
  if (paths.length === 0) {
    return tabs
  }

  const doomed = new Set(paths)

  return tabs.filter((tab) => !doomed.has(tab.path))
}

function underDir(filePath: string, dirPath: string): boolean {
  return (
    filePath.startsWith(`${dirPath}/`) || filePath.startsWith(`${dirPath}\\`)
  )
}

// Tabs pointing at targetPath itself or at files inside it (for
// folder rename/delete reconciliation).
export function tabsUnder(tabs: TabState[], targetPath: string): TabState[] {
  return tabs.filter(
    (tab) => tab.path === targetPath || underDir(tab.path, targetPath)
  )
}

// Re-points tabs after a rename: exact matches move to newPath, files
// under a renamed folder keep their relative suffix.
export function repathTabs(
  tabs: TabState[],
  oldPath: string,
  newPath: string
): TabState[] {
  return tabs.map((tab) => {
    if (tab.path === oldPath) {
      return { ...tab, path: newPath }
    }

    if (underDir(tab.path, oldPath)) {
      return { ...tab, path: newPath + tab.path.slice(oldPath.length) }
    }

    return tab
  })
}

// Picks the tab to activate after closing closingPath: the right
// neighbor, else the left neighbor, else null.
export function nextActivePath(
  tabs: TabState[],
  closingPath: string,
  activePath: string | null
): string | null {
  if (activePath !== closingPath) {
    return activePath
  }

  const index = tabs.findIndex((tab) => tab.path === closingPath)

  if (index === -1) {
    return activePath
  }

  const remaining = tabs.filter((tab) => tab.path !== closingPath)

  if (remaining.length === 0) {
    return null
  }

  return remaining[Math.min(index, remaining.length - 1)].path
}
