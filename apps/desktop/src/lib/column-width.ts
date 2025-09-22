export type ColumnWidthOverrides = Record<string, number>

export const DEFAULT_COLUMN_WIDTH = 160
export const DEFAULT_ACTION_COLUMN_WIDTH = 120

export type GuessColumnWidthOptions = {
  overrides?: ColumnWidthOverrides
  defaultWidth?: number
}

export function guessColumnWidth(name: string, options: GuessColumnWidthOptions = {}): number {
  const { overrides, defaultWidth = DEFAULT_COLUMN_WIDTH } = options
  if (overrides && typeof overrides[name] === 'number') {
    return overrides[name] as number
  }

  const n = name.toLowerCase()
  if (n.includes('email')) return 240
  if (n.includes('url') || n.includes('link')) return 300
  if (n.includes('name') || n.includes('title')) return 200
  if (n.includes('desc')) return 260
  if (n.includes('status') || n.includes('state')) return 140
  if (n.endsWith('_id') || n === 'id') return 140
  if (n.includes('date') || n.includes('time') || n.endsWith('at')) return 200
  if (n.includes('json')) return 240

  return defaultWidth
}

export type BuildColumnWidthMapOptions = {
  overrides?: ColumnWidthOverrides
  defaultWidth?: number
  actionColumnId?: string
  actionColumnWidth?: number
  includeActionColumn?: boolean
}

export function buildColumnWidthMap(
  columns: string[],
  options: BuildColumnWidthMapOptions = {}
): Map<string, number> {
  const {
    overrides,
    defaultWidth = DEFAULT_COLUMN_WIDTH,
    actionColumnId,
    actionColumnWidth = DEFAULT_ACTION_COLUMN_WIDTH,
    includeActionColumn = true,
  } = options

  const map = new Map<string, number>()

  for (const column of columns) {
    const width = guessColumnWidth(column, { overrides, defaultWidth })
    map.set(column, width)
  }

  if (actionColumnId) {
    const hasActionColumn = columns.includes(actionColumnId)
    if (hasActionColumn || includeActionColumn) {
      const overrideWidth = overrides?.[actionColumnId]
      map.set(actionColumnId, typeof overrideWidth === 'number' ? overrideWidth : actionColumnWidth)
    }
  }

  return map
}
