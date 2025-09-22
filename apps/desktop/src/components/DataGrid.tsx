"use client"

import * as React from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { Tooltip, CopyButton, ActionIcon } from '@mantine/core'
import { IconCopy } from '@tabler/icons-react'
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

export type DataGridProps = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  height?: number
  columnWidths?: Record<string, number>
  defaultColWidth?: number
  actionColWidth?: number
}

export const DataGrid = React.memo(function DataGrid({ columns, rows, height = 360, columnWidths, defaultColWidth, actionColWidth }: DataGridProps) {
  const hasExternalActions = React.useMemo(() => columns.includes('actions'), [columns])
  const totalCols = hasExternalActions ? columns.length : columns.length + 1
  const allColumnIds = React.useMemo(() => (hasExternalActions ? columns : [...columns, '__rdv_actions']), [columns, hasExternalActions])
  const fallbackColumnWidth = defaultColWidth ?? DEFAULT_COLUMN_WIDTH
  const fallbackActionWidth = actionColWidth ?? DEFAULT_ACTION_COLUMN_WIDTH

  const widthMap = React.useMemo(
    () =>
      buildColumnWidthMap(columns, {
        overrides: columnWidths,
        defaultWidth: fallbackColumnWidth,
        actionColumnId: hasExternalActions ? 'actions' : '__rdv_actions',
        actionColumnWidth: fallbackActionWidth,
        includeActionColumn: !hasExternalActions,
      }),
    [columns, columnWidths, fallbackColumnWidth, fallbackActionWidth, hasExternalActions]
  )

  const totalWidthPx = React.useMemo(() => {
    let w = 0
    for (const id of allColumnIds) w += widthMap.get(id) || fallbackColumnWidth
    return w
  }, [allColumnIds, widthMap, fallbackColumnWidth])

  const columnDefs = React.useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const defs: ColumnDef<Record<string, unknown>>[] = columns.map((key) => ({
        header: key,
        accessorKey: key,
        cell: (info) => {
          const v: any = info.getValue()
          if (React.isValidElement(v)) return v
          if (v == null) return ''
          if (typeof v === 'object') return <JsonCell value={v} />
          if (typeof v === 'string') {
            const s = v.trim()
            if ((s.startsWith('{') || s.startsWith('[')) && s.length > 12) {
              try {
                const parsed = JSON.parse(s)
                return <JsonCell value={parsed} />
              } catch {}
            }
            if (isTimestampWithOffset(v)) {
              return <TimezoneCell value={v} />
            }
            return <TextCell value={v} />
          }
          return String(v)
        },
      }))
    if (!hasExternalActions) {
      defs.push({ id: '__rdv_actions', header: '操作', cell: (info) => <RowViewButton record={info.row.original} /> })
    }
    return defs
  }, [columns, hasExternalActions])

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'scroll', overflowY: 'hidden', display: 'block', position: 'relative' }}>
      <table style={{ width: totalWidthPx + 'px', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
        <colgroup>
          {allColumnIds.map((id) => (
            <col key={id} style={{ width: widthMap.get(id) || fallbackColumnWidth }} />
          ))}
        </colgroup>
        <thead style={{ background: '#f9fafb' }}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const isActions = h.column.id === '__rdv_actions' || h.column.id === 'actions'
                const base: React.CSSProperties = { textAlign: 'left', padding: 0, borderBottom: '1px solid #e5e7eb', background: '#f9fafb', whiteSpace: 'nowrap' }
                const innerBase: React.CSSProperties = {
                  padding: '8px 10px',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                  maxWidth: '100%',
                }
                const headerContent = flexRender(h.column.columnDef.header, h.getContext())
                const headerTitle = typeof headerContent === 'string' ? headerContent : undefined
                return (
                  <th
                    key={h.id}
                    style={
                      isActions
                        ? {
                            ...base,
                            width: fallbackActionWidth,
                            minWidth: fallbackActionWidth,
                            position: 'sticky',
                            right: 0,
                            zIndex: 3,
                            boxShadow: 'inset 1px 0 0 #e5e7eb',
                            background: '#f9fafb',
                          }
                        : { ...base }
                    }
                  >
                    <div style={innerBase} title={headerTitle}>
                      {headerContent}
                    </div>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody style={{ maxHeight: height, overflowY: 'auto' }}>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const isActions = cell.column.id === '__rdv_actions' || cell.column.id === 'actions'
                const tdStyle: React.CSSProperties = {
                  padding: 0,
                  borderBottom: '1px solid #f1f5f9',
                  background: '#fff',
                  whiteSpace: 'nowrap',
                  width: isActions ? fallbackActionWidth : undefined,
                  minWidth: isActions ? fallbackActionWidth : undefined,
                  ...(isActions
                    ? {
                        position: 'sticky',
                        right: 0,
                        zIndex: 2,
                        boxShadow: 'inset 1px 0 0 #e5e7eb',
                        background: '#fff',
                      }
                    : {}),
                }
                const innerStyle: React.CSSProperties = {
                  padding: '8px 10px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }
                return (
                  <td key={cell.id} style={tdStyle}>
                    <div style={innerStyle}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={totalCols} style={{ padding: 12, color: '#64748b' }}>
                无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
})
