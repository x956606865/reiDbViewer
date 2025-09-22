'use client'

import * as React from 'react'
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef,
  type MRT_TableOptions,
} from 'mantine-react-table'
import { flexRender, type ColumnSizingState } from '@tanstack/react-table'
import TextCell from './TextCell'
import JsonCell from './JsonCell'
import TimezoneCell from './TimezoneCell'
import RowViewButton from './RowViewButton'
import { isTimestampWithOffset } from '../lib/timezone-detect'
import {
  DEFAULT_ACTION_COLUMN_WIDTH,
  DEFAULT_COLUMN_WIDTH,
  buildColumnWidthMap,
} from '../lib/column-width'

const ACTION_COLUMN_ID = '__rdv_actions'

export type ResizableDataGridFeatures = {
  enableSorting?: boolean
  enableColumnFilters?: boolean
  enableColumnOrdering?: boolean
  enableColumnDragging?: boolean
  enableColumnPinning?: boolean
  enableRowVirtualization?: boolean
  enableColumnVirtualization?: boolean
}

export type ResizableDataGridProps = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  height?: number
  columnWidths?: Record<string, number>
  defaultColWidth?: number
  actionColWidth?: number
  includeDefaultActions?: boolean
  additionalColumns?: MRT_ColumnDef<Record<string, unknown>>[]
  features?: ResizableDataGridFeatures
  tableOptions?: Pick<
    MRT_TableOptions<Record<string, unknown>>,
    'mantineTableProps' | 'mantineTableContainerProps' | 'localization'
  >
  onColumnWidthsChange?: (next: Record<string, number>) => void
}

export function ResizableDataGrid({
  columns,
  rows,
  height = 360,
  columnWidths,
  defaultColWidth,
  actionColWidth,
  includeDefaultActions = true,
  additionalColumns,
  features,
  tableOptions,
  onColumnWidthsChange,
}: ResizableDataGridProps) {
  const actionColumnId = React.useMemo(
    () => (columns.includes('actions') ? 'actions' : ACTION_COLUMN_ID),
    [columns]
  )
  const shouldAppendDefaultActions = includeDefaultActions && !columns.includes('actions')
  const fallbackColumnWidth = defaultColWidth ?? DEFAULT_COLUMN_WIDTH
  const fallbackActionWidth = actionColWidth ?? DEFAULT_ACTION_COLUMN_WIDTH
  const extraColumns = React.useMemo(() => additionalColumns ?? [], [additionalColumns])

  const widthMap = React.useMemo(
    () =>
      buildColumnWidthMap(columns, {
        overrides: columnWidths,
        defaultWidth: fallbackColumnWidth,
        actionColumnId,
        actionColumnWidth: fallbackActionWidth,
        includeActionColumn: shouldAppendDefaultActions,
      }),
    [columns, columnWidths, fallbackColumnWidth, fallbackActionWidth, actionColumnId, shouldAppendDefaultActions]
  )

  const initialColumnSizing = React.useMemo<ColumnSizingState>(() => {
    const sizing: ColumnSizingState = {}
    widthMap.forEach((width, key) => {
      sizing[key] = width
    })
    return sizing
  }, [widthMap])

  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>(initialColumnSizing)
  const skipNextEmitRef = React.useRef(false)
  const lastEmittedSignatureRef = React.useRef<string>('')

  const computePayload = React.useCallback(
    (sizing: ColumnSizingState): Record<string, number> => {
      const payload: Record<string, number> = {}
      for (const key of columns) {
        const raw = sizing[key]
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
          payload[key] = Math.round(raw)
        }
      }
      return payload
    },
    [columns]
  )

  React.useEffect(() => {
    setColumnSizing(initialColumnSizing)
    skipNextEmitRef.current = true
    lastEmittedSignatureRef.current = JSON.stringify(computePayload(initialColumnSizing))
  }, [initialColumnSizing, computePayload])

  React.useEffect(() => {
    if (!onColumnWidthsChange) return
    const payload = computePayload(columnSizing)
    const signature = JSON.stringify(payload)
    if (signature === lastEmittedSignatureRef.current) {
      skipNextEmitRef.current = false
      return
    }
    lastEmittedSignatureRef.current = signature
    if (skipNextEmitRef.current) {
      skipNextEmitRef.current = false
      return
    }
    onColumnWidthsChange(payload)
  }, [columnSizing, onColumnWidthsChange, computePayload])

  const enableSorting = features?.enableSorting ?? false
  const enableColumnFilters = features?.enableColumnFilters ?? false
  const enableColumnOrdering = features?.enableColumnOrdering ?? false
  const enableColumnDragging = features?.enableColumnDragging ?? false
  const enableColumnPinning = features?.enableColumnPinning ?? true
  const enableRowVirtualization = features?.enableRowVirtualization ?? false
  const enableColumnVirtualization = features?.enableColumnVirtualization ?? false

  const baseColumns = React.useMemo<MRT_ColumnDef<Record<string, unknown>>[]>(() => {
    const headerInnerStyle: React.CSSProperties = {
      padding: '8px 14px 8px 10px',
      fontWeight: 600,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'block',
      maxWidth: '100%',
    }
    const cellInnerStyle: React.CSSProperties = {
      padding: '8px 10px',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    return columns.map((key) => {
      const size = widthMap.get(key) ?? fallbackColumnWidth
      return {
        header: key,
        accessorKey: key,
        size,
        minSize: Math.min(120, size),
        maxSize: Math.max(size * 2, 480),
        enableResizing: true,
        enableSorting,
        enableColumnFilter: enableColumnFilters,
        enableColumnDragging,
        enableColumnOrdering,
        enablePinning: enableColumnPinning,
        grow: false,
        mantineTableHeadCellProps: {
          style: {
            padding: 0,
            borderBottom: '1px solid #e5e7eb',
            background: '#f9fafb',
            position: 'relative',
            overflow: 'visible',
          },
        },
        mantineTableBodyCellProps: {
          style: {
            padding: 0,
            borderBottom: '1px solid #f1f5f9',
            background: '#fff',
          },
        },
        Cell: ({ row, cell }) => {
          const rawValue = row?.original?.[key]
          let rendered: React.ReactNode
          if (React.isValidElement(rawValue)) {
            rendered = rawValue
          } else {
            const value = rawValue ?? cell.getValue()
            if (value == null) {
              rendered = ''
            } else if (typeof value === 'object') {
              rendered = <JsonCell value={value} />
            } else if (typeof value === 'string') {
              const s = value.trim()
              if ((s.startsWith('{') || s.startsWith('[')) && s.length > 12) {
                try {
                  const parsed = JSON.parse(s)
                  rendered = <JsonCell value={parsed} />
                } catch {
                  rendered = <TextCell value={s} />
                }
              } else if (isTimestampWithOffset(s)) {
                rendered = <TimezoneCell value={s} />
              } else {
                rendered = <TextCell value={s} />
              }
            } else {
              rendered = String(value)
            }
          }
          return <div style={cellInnerStyle}>{rendered}</div>
        },
        Header: ({ header }) => {
          const content = flexRender(header.column.columnDef.header, header.getContext())
          const title = typeof content === 'string' ? content : undefined
          return (
            <div style={headerInnerStyle} title={title}>
              {content}
            </div>
          )
        },
      }
    })
  }, [columns, widthMap, fallbackColumnWidth, enableSorting, enableColumnFilters, enableColumnDragging, enableColumnOrdering, enableColumnPinning])

  const actionColumn = React.useMemo<MRT_ColumnDef<Record<string, unknown>> | null>(() => {
    if (!shouldAppendDefaultActions) return null
    return {
      id: ACTION_COLUMN_ID,
      header: '操作',
      size: fallbackActionWidth,
      minSize: fallbackActionWidth,
      maxSize: fallbackActionWidth,
      enableColumnFilter: false,
      enableSorting: false,
      enableResizing: true,
      enablePinning: true,
      grow: false,
      mantineTableHeadCellProps: {
        style: {
          padding: 0,
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
          position: 'sticky',
          right: 0,
          zIndex: 3,
          boxShadow: 'inset 1px 0 0 #e5e7eb',
          overflow: 'visible',
        },
      },
      mantineTableBodyCellProps: {
        style: {
          padding: 0,
          borderBottom: '1px solid #f1f5f9',
          background: '#fff',
          position: 'sticky',
          right: 0,
          zIndex: 2,
          boxShadow: 'inset 1px 0 0 #e5e7eb',
        },
      },
      Header: ({ header }) => (
        <div
          style={{
            padding: '8px 14px 8px 10px',
            fontWeight: 600,
            display: 'block',
            whiteSpace: 'nowrap',
          }}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
        </div>
      ),
      Cell: ({ row }) => (
        <div
          style={{
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          <RowViewButton record={row.original} />
        </div>
      ),
    }
  }, [shouldAppendDefaultActions, fallbackActionWidth])

  const columnDefs = React.useMemo(() => {
    const defs: MRT_ColumnDef<Record<string, unknown>>[] = [...baseColumns]
    if (extraColumns.length) defs.push(...extraColumns)
    if (actionColumn) defs.push(actionColumn)
    return defs
  }, [baseColumns, extraColumns, actionColumn])

  const columnOrder = React.useMemo(() => {
    return columnDefs
      .map((col) => col.id ?? col.accessorKey)
      .filter((id): id is string => !!id)
  }, [columnDefs])

  const hasActionColumn = React.useMemo(
    () => columnDefs.some((col) => (col.id ?? col.accessorKey) === actionColumnId),
    [columnDefs, actionColumnId]
  )

  const pinnedColumns = React.useMemo(() => {
    if (!enableColumnPinning || !hasActionColumn) return undefined
    return { right: [actionColumnId] }
  }, [enableColumnPinning, hasActionColumn, actionColumnId])

  const table = useMantineReactTable({
    columns: columnDefs,
    data: rows,
    enableColumnResizing: true,
    columnResizeMode: 'onEnd',
    enableSorting,
    enableColumnFilters,
    enableColumnOrdering,
    enableColumnDragging,
    enableColumnPinning,
    enableRowVirtualization,
    enableColumnVirtualization,
    enableRowNumbers: false,
    enableColumnActions: false,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    enableFilters: enableColumnFilters,
    enablePagination: false,
    enableTopToolbar: false,
    enableBottomToolbar: false,
    enableGlobalFilter: false,
    enableStickyHeader: true,
    layoutMode: 'grid-no-grow',
    defaultColumn: {
      minSize: 80,
      maxSize: 640,
      mantineTableBodyCellProps: {
        style: {
          padding: '8px 10px',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
    },
    mantinePaperProps: {
      withBorder: true,
      shadow: 'xs',
      radius: 'sm',
      className: 'rdv-resizable-grid',
      style: {
        borderColor: '#e5e7eb',
        borderRadius: 6,
      },
    },
    mantineTableProps: {
      highlightOnHover: false,
      striped: false,
      withColumnBorders: false,
      captionSide: 'top',
      style: {
        tableLayout: 'fixed',
      },
      ...tableOptions?.mantineTableProps,
    },
    mantineTableContainerProps: {
      style: {
        maxHeight: height,
        overflowX: 'auto',
        overflowY: 'auto',
      },
      ...tableOptions?.mantineTableContainerProps,
    },
    mantineTableHeadCellProps: {
      style: {
        padding: 0,
        borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb',
        position: 'relative',
        overflow: 'visible',
      },
    },
    mantineTableBodyCellProps: {
      style: {
        padding: 0,
        borderBottom: '1px solid #f1f5f9',
        background: '#fff',
      },
    },
    localization: {
      noRecordsToDisplay: '无数据',
      ...tableOptions?.localization,
    },
    initialState: {
      density: 'xs',
      columnOrder,
      columnPinning: pinnedColumns,
    },
    state: {
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
  })

  return <MantineReactTable table={table} />
}
