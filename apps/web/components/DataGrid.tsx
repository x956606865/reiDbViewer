'use client'

import * as React from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'

export type DataGridProps = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  height?: number
}

export function DataGrid({ columns, rows, height = 360 }: DataGridProps) {
  const columnDefs = React.useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((key) => ({
        header: key,
        accessorKey: key,
        cell: (info) => {
          const v: any = info.getValue()
          if (React.isValidElement(v)) return v
          if (v == null) return ''
          if (typeof v === 'object') {
            try {
              return JSON.stringify(v)
            } catch {
              return String(v)
            }
          }
          return String(v)
        },
      })),
    [columns]
  )

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ background: '#f9fafb' }}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={{ maxHeight: height, overflowY: 'auto' }}>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ padding: 12, color: '#64748b' }}>
                无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
