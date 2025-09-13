"use client"

import * as React from 'react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'

export type SmartGridProps = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  height?: number
}

export default function SmartGrid({ columns, rows, height = 420 }: SmartGridProps) {
  const colDefs = React.useMemo<MRT_ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((key) => ({
        header: key,
        accessorKey: key,
        enableSorting: true,
        enableColumnFilter: true,
        filterVariant: 'text',
        // 对象/数组转字符串以便排序/筛选
        accessorFn: (row) => {
          const v: any = row[key]
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
        mantineTableHeadCellProps: { style: { whiteSpace: 'nowrap' } },
        mantineTableBodyCellProps: { style: { fontFamily: 'var(--mantine-font-family-monospace)' } },
      })),
    [columns]
  )

  const table = useMantineReactTable({
    columns: colDefs,
    data: rows,
    enableColumnResizing: true,
    columnResizeMode: 'onEnd',
    enableColumnOrdering: true,
    enableColumnFilters: true,
    columnFilterDisplayMode: 'popover', // 过滤放到弹出层，去掉表头下方的输入行
    enableFilters: true,
    enableSorting: true,
    enableStickyHeader: true,
    enableHiding: true,
    enablePinning: true,
    enableTopToolbar: false, // 关闭顶部工具栏，减少干扰
    enableBottomToolbar: false, // 分页由外部控制
    enablePagination: false,
    // 大数据集建议开启虚拟化
    enableRowVirtualization: rows.length > 50,
    enableColumnVirtualization: columns.length > 12,
    columnVirtualizerOptions: { overscan: 3 },
    rowVirtualizerOptions: { overscan: 8 },
    defaultColumn: { minSize: 80, size: 160, maxSize: 480 },
    mantinePaperProps: { withBorder: true },
    mantineTableProps: { highlightOnHover: true, striped: 'odd' },
    mantineTableHeadCellProps: { style: { fontSize: 12, fontWeight: 600 } },
    mantineTableBodyCellProps: {
      style: {
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        maxWidth: 560,
      },
    },
    mantineTableContainerProps: {
      style: {
        maxHeight: height,
        overflow: 'auto', // 同时允许纵向与横向滚动
      },
    },
    initialState: {
      density: 'xs',
      columnOrder: columns,
      showColumnFilters: false,
    },
  })

  return <MantineReactTable table={table} />
}
