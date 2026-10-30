// Unified workbench tab model (Level 3C, Phase 2). Source-code files
// and Meta AI sessions coexist in ONE central tab system: every tab
// is a discriminated WorkbenchTab, and every editor group holds an
// ordered list of tab ids with its own active tab. Pure transitions
// only — no React, no I/O. App.tsx owns the state; these functions
// compute the next state. Level 4 views plug in as `extension` tabs
// (type-level extension point; nothing produces them yet).

export interface CodeTab {
  kind: 'code'
  id: string
  path: string
  content: string
  savedContent: string
  mtimeMs: number | null
}

export interface MetaAITab {
  kind: 'meta-ai'
  id: string
  sessionId: string
}

export interface ExtensionTab {
  kind: 'extension'
  id: string
  extensionId: string
  viewId: string
  title: string
}

export type WorkbenchTab = CodeTab | MetaAITab | ExtensionTab

export interface EditorGroup {
  id: string
  tabIds: string[]
  activeId: string | null
}

export interface WorkbenchState {
  tabs: WorkbenchTab[]
  groups: EditorGroup[]
  activeGroupId: string
}

export function codeTabId(path: string): string {
  return `code:${path}`
}

export function metaTabId(sessionId: string): string {
  return `meta-ai:${sessionId}`
}

export function extensionTabId(
  extensionId: string,
  viewId: string
): string {
  return `extension:${extensionId}:${viewId}`
}

export function isCodeTab(tab: WorkbenchTab): tab is CodeTab {
  return tab.kind === 'code'
}

export function isMetaTab(tab: WorkbenchTab): tab is MetaAITab {
  return tab.kind === 'meta-ai'
}

export function isExtensionTab(tab: WorkbenchTab): tab is ExtensionTab {
  return tab.kind === 'extension'
}

export function findTab(
  tabs: WorkbenchTab[],
  id: string
): WorkbenchTab | null {
  return tabs.find((tab) => tab.id === id) ?? null
}

export function findCodeTabByPath(
  tabs: WorkbenchTab[],
  path: string
): CodeTab | null {
  const found = tabs.find(
    (tab) => tab.kind === 'code' && tab.path === path
  )

  return found && isCodeTab(found) ? found : null
}

// Only code tabs hold unsaved editor state. Meta AI sessions persist
// continuously, so closing their tabs never needs a dirty check.
export function isTabDirty(tab: WorkbenchTab): boolean {
  return isCodeTab(tab) && tab.content !== tab.savedContent
}

export function dirtyTabs(tabs: WorkbenchTab[]): CodeTab[] {
  return tabs.filter(
    (tab): tab is CodeTab => isCodeTab(tab) && isTabDirty(tab)
  )
}

export function initialWorkbench(): WorkbenchState {
  return {
    tabs: [],
    groups: [{ id: 'group-1', tabIds: [], activeId: null }],
    activeGroupId: 'group-1',
  }
}

export function getGroup(
  state: WorkbenchState,
  groupId: string
): EditorGroup | null {
  return state.groups.find((group) => group.id === groupId) ?? null
}

export function getActiveGroup(state: WorkbenchState): EditorGroup {
  return getGroup(state, state.activeGroupId) ?? state.groups[0]
}

// Tabs of one group in strip order; unknown ids are dropped rather
// than rendered.
export function groupTabs(
  state: WorkbenchState,
  group: EditorGroup
): WorkbenchTab[] {
  return group.tabIds
    .map((id) => findTab(state.tabs, id))
    .filter((tab): tab is WorkbenchTab => tab !== null)
}

function nextGroupId(state: WorkbenchState): string {
  let n = state.groups.length + 1

  while (state.groups.some((group) => group.id === `group-${n}`)) {
    n += 1
  }

  return `group-${n}`
}

// Picks the tab to activate after closing closingId: the right
// neighbor, else the left neighbor, else null.
export function nextActiveId(
  tabIds: string[],
  closingId: string,
  activeId: string | null
): string | null {
  if (activeId !== closingId) {
    return activeId
  }

  const index = tabIds.indexOf(closingId)

  if (index === -1) {
    return activeId
  }

  const remaining = tabIds.filter((id) => id !== closingId)

  if (remaining.length === 0) {
    return null
  }

  return remaining[Math.min(index, remaining.length - 1)]
}

// Drops tab records no group references anymore. Meta AI tab records
// are cheap descriptors: dropping one never deletes the underlying
// persistent session (see meta-sessions.ts).
function collectOrphans(state: WorkbenchState): WorkbenchState {
  const referenced = new Set<string>()

  for (const group of state.groups) {
    for (const id of group.tabIds) {
      referenced.add(id)
    }
  }

  return {
    ...state,
    tabs: state.tabs.filter((tab) => referenced.has(tab.id)),
  }
}

function normalizeGroups(state: WorkbenchState): WorkbenchState {
  let groups = state.groups.map((group) => ({
    ...group,
    tabIds: group.tabIds.filter((id) =>
      state.tabs.some((tab) => tab.id === id)
    ),
  }))

  groups = groups.map((group) => ({
    ...group,
    activeId:
      group.activeId && group.tabIds.includes(group.activeId)
        ? group.activeId
        : (group.tabIds[group.tabIds.length - 1] ?? null),
  }))

  // Empty groups collapse except the primary one, so closing the last
  // tab of a split heals the layout instead of stranding a void.
  const kept = groups.filter(
    (group, index) => index === 0 || group.tabIds.length > 0
  )
  const finalGroups =
    kept.length > 0
      ? kept
      : [{ id: 'group-1', tabIds: [], activeId: null }]

  const activeGroupId = finalGroups.some(
    (group) => group.id === state.activeGroupId
  )
    ? state.activeGroupId
    : finalGroups[0].id

  return { ...state, groups: finalGroups, activeGroupId }
}

function withGroups(
  state: WorkbenchState,
  groups: EditorGroup[],
  activeGroupId?: string
): WorkbenchState {
  return normalizeGroups(
    collectOrphans({
      ...state,
      groups,
      activeGroupId: activeGroupId ?? state.activeGroupId,
    })
  )
}

// Opens a tab (appending unless already open) and activates it in the
// target group. Opening an already-open tab only moves activation.
export function openTab(
  state: WorkbenchState,
  tab: WorkbenchTab,
  groupId?: string
): WorkbenchState {
  const targetId = groupId ?? state.activeGroupId
  const tabs = state.tabs.some((entry) => entry.id === tab.id)
    ? state.tabs
    : [...state.tabs, tab]

  const groups = state.groups.map((group) => {
    if (group.id !== targetId) {
      return group
    }

    return {
      ...group,
      tabIds: group.tabIds.includes(tab.id)
        ? group.tabIds
        : [...group.tabIds, tab.id],
      activeId: tab.id,
    }
  })

  return withGroups({ ...state, tabs }, groups, targetId)
}

export function activateTab(
  state: WorkbenchState,
  groupId: string,
  id: string
): WorkbenchState {
  const group = getGroup(state, groupId)

  if (!group || !group.tabIds.includes(id)) {
    return state
  }

  return {
    ...state,
    groups: state.groups.map((entry) =>
      entry.id === groupId ? { ...entry, activeId: id } : entry
    ),
    activeGroupId: groupId,
  }
}

export function focusGroup(
  state: WorkbenchState,
  groupId: string
): WorkbenchState {
  if (!getGroup(state, groupId)) {
    return state
  }

  return { ...state, activeGroupId: groupId }
}

export function closeTab(
  state: WorkbenchState,
  id: string
): WorkbenchState {
  if (!state.tabs.some((tab) => tab.id === id)) {
    return state
  }

  const groups = state.groups.map((group) => {
    if (!group.tabIds.includes(id)) {
      return group
    }

    const tabIds = group.tabIds.filter((entry) => entry !== id)

    return {
      ...group,
      tabIds,
      activeId: nextActiveId(group.tabIds, id, group.activeId),
    }
  })

  return withGroups(state, groups)
}

export function closeOtherTabs(
  state: WorkbenchState,
  groupId: string,
  keepId: string
): WorkbenchState {
  const group = getGroup(state, groupId)

  if (!group || !group.tabIds.includes(keepId)) {
    return state
  }

  const groups = state.groups.map((entry) =>
    entry.id === groupId
      ? { ...entry, tabIds: [keepId], activeId: keepId }
      : entry
  )

  return withGroups(state, groups)
}

// VS Code-style split: the new group opens beside the source showing
// the source's active tab. Both groups reference the same tab record,
// so edits stay in sync.
export function splitGroupRight(
  state: WorkbenchState,
  groupId: string
): WorkbenchState {
  const group = getGroup(state, groupId)

  if (!group || !group.activeId) {
    return state
  }

  if (state.groups.length >= 3) {
    return state
  }

  const id = nextGroupId(state)
  const index = state.groups.findIndex((entry) => entry.id === groupId)
  const groups = [...state.groups]

  groups.splice(index + 1, 0, {
    id,
    tabIds: [group.activeId],
    activeId: group.activeId,
  })

  return { ...state, groups, activeGroupId: id }
}

export function closeGroup(
  state: WorkbenchState,
  groupId: string
): WorkbenchState {
  if (state.groups.length <= 1) {
    return state
  }

  const groups = state.groups.filter((group) => group.id !== groupId)

  if (groups.length === state.groups.length) {
    return state
  }

  const activeGroupId =
    state.activeGroupId === groupId
      ? groups[groups.length - 1].id
      : state.activeGroupId

  return withGroups(state, groups, activeGroupId)
}

export function updateCodeTab(
  tabs: WorkbenchTab[],
  id: string,
  patch: Partial<Omit<CodeTab, 'kind' | 'id'>>
): WorkbenchTab[] {
  return tabs.map((tab) =>
    tab.id === id && isCodeTab(tab) ? { ...tab, ...patch } : tab
  )
}

function underDir(filePath: string, dirPath: string): boolean {
  return (
    filePath.startsWith(`${dirPath}/`) || filePath.startsWith(`${dirPath}\\`)
  )
}

// Ids of code tabs pointing at targetPath itself or files inside it
// (for folder rename/delete reconciliation).
export function tabsUnderPath(
  tabs: WorkbenchTab[],
  targetPath: string
): string[] {
  return tabs
    .filter(
      (tab) =>
        isCodeTab(tab) &&
        (tab.path === targetPath || underDir(tab.path, targetPath))
    )
    .map((tab) => tab.id)
}

// Re-points code tabs after a rename: exact matches move to newPath,
// files under a renamed folder keep their relative suffix. Tab ids
// follow the path so groups keep referencing the same records.
export function repathCodeTabs(
  state: WorkbenchState,
  oldPath: string,
  newPath: string
): WorkbenchState {
  const renamed = new Map<string, string>()

  const tabs = state.tabs.map((tab) => {
    if (!isCodeTab(tab)) {
      return tab
    }

    if (tab.path === oldPath) {
      renamed.set(tab.id, codeTabId(newPath))
      return { ...tab, id: codeTabId(newPath), path: newPath }
    }

    if (underDir(tab.path, oldPath)) {
      const moved = newPath + tab.path.slice(oldPath.length)

      renamed.set(tab.id, codeTabId(moved))
      return { ...tab, id: codeTabId(moved), path: moved }
    }

    return tab
  })

  if (renamed.size === 0) {
    return state
  }

  const remap = (id: string | null): string | null =>
    id !== null && renamed.has(id) ? (renamed.get(id) as string) : id

  return {
    ...state,
    tabs,
    groups: state.groups.map((group) => ({
      ...group,
      tabIds: group.tabIds.map((id) => remap(id) as string),
      activeId: remap(group.activeId),
    })),
  }
}
