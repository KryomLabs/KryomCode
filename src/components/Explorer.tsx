import { useState } from 'react'
import { baseName, parentDir } from '../utils/paths'
import { FileIcon, FolderIcon, PencilIcon, TrashIcon } from './FileIcons'

export interface ExplorerProps {
  workspace: KryomWorkspace | null
  activeFile: string | null
  loading: boolean
  projectInfo: string | null
  onOpenFile: (node: KryomNode) => void
  onRefresh: () => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (node: KryomNode) => void
  onDelete: (node: KryomNode) => void
}

interface RowProps {
  node: KryomNode
  depth: number
  activeFile: string | null
  selected: string | null
  onSelect: (path: string) => void
  onOpenFile: (node: KryomNode) => void
  onRename: (node: KryomNode) => void
  onDelete: (node: KryomNode) => void
}

function ExplorerRow(props: RowProps) {
  const { node } = props
  const isSelected = props.selected === node.path
  const isActive = props.activeFile === node.path

  if (node.type === 'directory') {
    return (
      <div key={node.path}>
        <details open={props.depth === 0}>
          <summary
            className={`tree-row${isSelected ? ' selected' : ''}`}
            style={{ paddingLeft: 12 + props.depth * 14 }}
            onClick={() => props.onSelect(node.path)}
          >
            <span className="tree-icon" aria-hidden="true">
              <FolderIcon />
            </span>{' '}
            {node.name}
          </summary>

          {(node.children ?? []).map((child) => (
            <ExplorerRow
              key={child.path}
              node={child}
              depth={props.depth + 1}
              activeFile={props.activeFile}
              selected={props.selected}
              onSelect={props.onSelect}
              onOpenFile={props.onOpenFile}
              onRename={props.onRename}
              onDelete={props.onDelete}
            />
          ))}
        </details>
      </div>
    )
  }

  return (
    <div
      key={node.path}
      className={`tree-row-wrap${isSelected ? ' selected' : ''}`}
      style={{ paddingLeft: 12 + props.depth * 14 }}
    >
      <button
        className={`tree-row file-row${isActive ? ' selected' : ''}`}
        onClick={() => {
          props.onSelect(node.path)
          props.onOpenFile(node)
        }}
        title={node.path}
      >
        <span className="tree-icon" aria-hidden="true">
          <FileIcon />
        </span>{' '}
        {node.name}
      </button>

      {isSelected && (
        <span className="row-actions">
          <button
            title={`Rename ${node.name}`}
            aria-label={`Rename ${node.name}`}
            onClick={() => props.onRename(node)}
          >
            <PencilIcon />
          </button>
          <button
            title={`Delete ${node.name}`}
            aria-label={`Delete ${node.name}`}
            onClick={() => props.onDelete(node)}
          >
            <TrashIcon />
          </button>
        </span>
      )}
    </div>
  )
}

export function Explorer(props: ExplorerProps) {
  const [selected, setSelected] = useState<string | null>(null)

  const selectedDir = (): string | null => {
    if (!props.workspace) {
      return null
    }

    if (!selected) {
      return props.workspace.root
    }

    if (selected === props.activeFile || !isDirectoryPath(selected)) {
      return parentDir(selected)
    }

    return selected
  }

  const isDirectoryPath = (target: string): boolean => {
    const find = (nodes: KryomNode[]): boolean =>
      nodes.some(
        (node) =>
          (node.path === target && node.type === 'directory') ||
          (node.children ? find(node.children) : false)
      )

    return props.workspace ? find(props.workspace.tree) : false
  }

  const findNode = (target: string): KryomNode | null => {
    const walk = (nodes: KryomNode[]): KryomNode | null => {
      for (const node of nodes) {
        if (node.path === target) {
          return node
        }

        if (node.children) {
          const found = walk(node.children)

          if (found) {
            return found
          }
        }
      }

      return null
    }

    return props.workspace ? walk(props.workspace.tree) : null
  }

  const selectedNode = selected ? findNode(selected) : null
  const targetDir = selectedDir()

  return (
    <div className="explorer">
      {!props.workspace ? (
        <p className="muted padded">Open a folder to get started.</p>
      ) : (
        <>
          <div className="root-name">
            <span className="tree-icon" aria-hidden="true">
              <FolderIcon />
            </span>{' '}
            {baseName(props.workspace.root)}
          </div>

          {props.projectInfo && (
            <div className="project-info">{props.projectInfo}</div>
          )}

          <div className="explorer-actions">
            <button
              title="New file in selected folder"
              disabled={!targetDir || props.loading}
              onClick={() => targetDir && props.onNewFile(targetDir)}
            >
              + File
            </button>
            <button
              title="New folder in selected folder"
              disabled={!targetDir || props.loading}
              onClick={() => targetDir && props.onNewFolder(targetDir)}
            >
              + Folder
            </button>
            <button
              title="Refresh explorer"
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              {props.loading ? '…' : 'Refresh'}
            </button>
          </div>

          {selectedNode && selectedNode.type === 'directory' && (
            <div className="explorer-actions">
              <button onClick={() => props.onRename(selectedNode)}>
                Rename folder
              </button>
              <button onClick={() => props.onDelete(selectedNode)}>
                Delete folder
              </button>
            </div>
          )}

          <div className="tree">
            {props.workspace.tree.map((node) => (
              <ExplorerRow
                key={node.path}
                node={node}
                depth={0}
                activeFile={props.activeFile}
                selected={selected}
                onSelect={setSelected}
                onOpenFile={props.onOpenFile}
                onRename={props.onRename}
                onDelete={props.onDelete}
              />
            ))}

            {props.workspace.tree.length === 0 && (
              <p className="muted padded">This folder is empty.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
