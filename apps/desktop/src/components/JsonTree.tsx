import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react'
import type { NodePath } from './jsonTreeUtils'
import { collectExpandableKeys, getChildEntries, isJsonLike, pathToKey, pruneDescendants } from './jsonTreeUtils'

const ROOT_PATH: NodePath = ['$root']

type JsonTreeProps = {
  value: unknown
}

type NodeProps = {
  value: unknown
  path: NodePath
  depth: number
  name?: string | number
}

function formatPrimitive(value: unknown) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `Array(${value.length})`
  if (isJsonLike(value) && getChildEntries(value).length === 0) return '{}'
  const type = typeof value
  switch (type) {
    case 'string':
      return `"${value}"`
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value)
    case 'undefined':
      return 'undefined'
    case 'symbol':
      return (value as symbol).toString()
    case 'function':
      return '[Function]'
    default:
      return value instanceof Date ? value.toISOString() : String(value)
  }
}

export default function JsonTree({ value }: JsonTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([pathToKey(ROOT_PATH)]))

  const styles = `
    .json-tree-container {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      line-height: 1.4;
      color: var(--mantine-color-text);
    }
    .json-tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 6px 2px 0;
      border-radius: 4px;
      transition: background-color 120ms ease;
      position: relative;
    }
    .json-tree-row:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }
    .json-tree-row:hover .json-tree-actions {
      opacity: 1;
    }
    .json-tree-toggle {
      width: 18px;
      height: 18px;
      min-width: 18px;
      min-height: 18px;
      font-size: 11px;
      color: var(--mantine-color-dimmed);
    }
    .json-tree-toggle.placeholder {
      display: inline-flex;
      width: 18px;
      height: 18px;
    }
    .json-tree-key {
      color: var(--mantine-color-text);
      font-weight: 500;
    }
    .json-tree-key::before,
    .json-tree-key::after {
      content: '"';
      color: var(--mantine-color-dimmed);
    }
    .json-tree-colon {
      color: var(--mantine-color-dimmed);
    }
    .json-tree-brace {
      color: var(--mantine-color-dimmed);
    }
    .json-tree-meta {
      color: var(--mantine-color-dimmed);
      font-size: 12px;
      margin-left: 2px;
    }
    .json-tree-ellipsis {
      color: var(--mantine-color-dimmed);
    }
    .json-tree-value {
      white-space: pre-wrap;
    }
    .json-tree-value.string {
      color: #2f9d72;
    }
    .json-tree-value.number {
      color: #1c7ed6;
    }
    .json-tree-value.boolean {
      color: #d9480f;
    }
    .json-tree-value.null,
    .json-tree-value.undefined {
      color: #868e96;
    }
    .json-tree-value.other {
      color: var(--mantine-color-text);
    }
    .json-tree-actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .json-tree-children {
      margin-top: 2px;
    }
  `

  useEffect(() => {
    setExpanded(new Set([pathToKey(ROOT_PATH)]))
  }, [value])

  const toggleNode = (path: NodePath) => {
    const key = pathToKey(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        return pruneDescendants(next, path)
      }
      next.add(key)
      return next
    })
  }

  const expandAll = (path: NodePath, nodeValue: unknown) => {
    const keys = collectExpandableKeys(nodeValue, path)
    if (keys.length === 0) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const key of keys) next.add(key)
      return next
    })
  }

  const collapseAll = (path: NodePath) => {
    setExpanded((prev) => pruneDescendants(prev, path))
  }

  const Node = ({ value: currentValue, path, depth, name }: NodeProps) => {
    const key = pathToKey(path)
    const entries = useMemo(() => getChildEntries(currentValue), [currentValue])
    const hasChildren = entries.length > 0
    const isExpanded = hasChildren && expanded.has(key)
    const isArray = Array.isArray(currentValue)
    const label = name === undefined ? undefined : String(name)
    const braceOpen = isArray ? '[' : '{'
    const braceClose = isArray ? ']' : '}'
    const childCount = entries.length
    const valueClass = getValueClass(currentValue)

    return (
      <div key={key}>
        <div className="json-tree-row" style={{ paddingLeft: depth * 14 }}>
          {hasChildren ? (
            <ActionIcon
              size="xs"
              variant="subtle"
              radius="xl"
              className="json-tree-toggle"
              onClick={() => toggleNode(path)}
              aria-label={isExpanded ? '收起节点' : '展开节点'}
            >
              {isExpanded ? '▾' : '▸'}
            </ActionIcon>
          ) : (
            <span className="json-tree-toggle placeholder" />
          )}
          {label !== undefined && <span className="json-tree-key">{label}</span>}
          {label !== undefined && <span className="json-tree-colon">:</span>}
          {hasChildren ? (
            <>
              <span className="json-tree-brace">{braceOpen}</span>
              <span className="json-tree-ellipsis">{childCount > 0 ? '…' : ''}</span>
              <span className="json-tree-brace">{braceClose}</span>
              <span className="json-tree-meta">
                {childCount} {isArray ? 'items' : 'keys'}
              </span>
            </>
          ) : (
            <span className={`json-tree-value ${valueClass}`}>{formatPrimitive(currentValue)}</span>
          )}
          {hasChildren && (
            <div className="json-tree-actions">
              <Tooltip label="展开整棵子树" withinPortal>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  onClick={(event) => {
                    event.stopPropagation()
                    expandAll(path, currentValue)
                  }}
                  aria-label="展开整棵子树"
                >
                  <IconArrowsMaximize size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="收起整棵子树" withinPortal>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  onClick={(event) => {
                    event.stopPropagation()
                    collapseAll(path)
                  }}
                  aria-label="收起整棵子树"
                >
                  <IconArrowsMinimize size={14} />
                </ActionIcon>
              </Tooltip>
            </div>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="json-tree-children">
            {entries.map(([childKey, childValue]) => (
              <Node key={pathToKey([...path, childKey])} value={childValue} path={[...path, childKey]} depth={depth + 1} name={childKey} />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!isJsonLike(value)) {
    return (
      <div className="json-tree-container">
        <style>{styles}</style>
        <span className={`json-tree-value ${getValueClass(value)}`}>{formatPrimitive(value)}</span>
      </div>
    )
  }

  return (
    <div className="json-tree-container">
      <style>{styles}</style>
      <Node value={value} path={ROOT_PATH} depth={0} />
    </div>
  )
}

function getValueClass(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'other'
  const type = typeof value
  if (type === 'string') return 'string'
  if (type === 'number' || type === 'bigint') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'undefined') return 'undefined'
  return 'other'
}
