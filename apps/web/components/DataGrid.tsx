"use client"

import * as React from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import JsonCell from './JsonCell'
import RowViewButton from './RowViewButton'

export type DataGridProps = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  height?: number
}

export const DataGrid = React.memo(function DataGrid({ columns, rows, height = 360 }: DataGridProps) {
  const hasExternalActions = React.useMemo(() => columns.includes('actions'), [columns])
  const totalCols = hasExternalActions ? columns.length : columns.length + 1

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
            return v
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
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
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
