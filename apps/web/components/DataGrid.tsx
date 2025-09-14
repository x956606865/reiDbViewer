"use client"

import * as React from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { Tooltip, CopyButton, ActionIcon } from '@mantine/core'
import { IconCopy } from '@tabler/icons-react'
import JsonCell from './JsonCell'
import RowViewButton from './RowViewButton'

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
  const DEFAULT_COL_WIDTH = defaultColWidth ?? 160
  const ACTION_COL_WIDTH = actionColWidth ?? 120

  const guessWidth = React.useCallback((name: string): number => {
    const n = name.toLowerCase()
    if (columnWidths && typeof columnWidths[name] === 'number') return columnWidths[name]
    if (n.includes('email')) return 240
    if (n.includes('url') || n.includes('link')) return 300
    if (n.includes('name') || n.includes('title')) return 200
    if (n.includes('desc')) return 260
    if (n.includes('status') || n.includes('state')) return 140
    if (n.endsWith('_id') || n === 'id') return 140
    if (n.includes('date') || n.includes('time') || n.endsWith('at')) return 200
    if (n.includes('json')) return 240
    return DEFAULT_COL_WIDTH
  }, [columnWidths, DEFAULT_COL_WIDTH])

  const widthMap = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const c of columns) m.set(c, guessWidth(c))
    if (!hasExternalActions) m.set('__rdv_actions', ACTION_COL_WIDTH)
    return m
  }, [columns, guessWidth, hasExternalActions, ACTION_COL_WIDTH])

  const totalWidthPx = React.useMemo(() => {
    let w = 0
    for (const id of allColumnIds) w += widthMap.get(id) || DEFAULT_COL_WIDTH
    return w
  }, [allColumnIds, widthMap, DEFAULT_COL_WIDTH])

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
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tooltip label={v} withArrow withinPortal multiline maw={640} position="top-start">
                  <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{v}</span>
                </Tooltip>
                <CopyButton value={v} timeout={1200}>
                  {({ copied, copy }) => (
                    <ActionIcon size="sm" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} title={copied ? '已复制' : '复制'}>
                      <IconCopy size={14} />
                    </ActionIcon>
                  )}
                </CopyButton>
              </div>
            )
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
            <col key={id} style={{ width: widthMap.get(id) || DEFAULT_COL_WIDTH }} />
          ))}
        </colgroup>
        <thead style={{ background: '#f9fafb' }}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const isActions = h.column.id === '__rdv_actions' || h.column.id === 'actions'
                const base: React.CSSProperties = { textAlign: 'left', padding: 0, borderBottom: '1px solid #e5e7eb', background: '#f9fafb', whiteSpace: 'nowrap' }
                const innerBase: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 }
                return (
                  <th key={h.id} style={{ ...base, width: isActions ? 120 : undefined, minWidth: isActions ? 120 : undefined }}>
                    <div style={isActions ? { position: 'sticky', right: 0, zIndex: 2, boxShadow: 'inset 1px 0 0 #e5e7eb', background: '#f9fafb', ...innerBase } : innerBase}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
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
                  width: isActions ? 120 : undefined,
                  minWidth: isActions ? 120 : undefined,
                }
                const innerStyle: React.CSSProperties = {
                  padding: '8px 10px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }
                return (
                  <td key={cell.id} style={tdStyle}>
                    <div style={isActions ? { position: 'sticky', right: 0, zIndex: 1, boxShadow: 'inset 1px 0 0 #e5e7eb', background: '#fff', ...innerStyle } : innerStyle}>
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
