'use client'

import * as React from 'react'
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef,
} from 'mantine-react-table'
import { Group, TextInput, Button } from '@mantine/core'
import {
  IconArrowsSort,
  IconArrowNarrowDown,
  IconArrowNarrowUp,
  IconSearch,
  IconFilter,
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconEye,
  IconEyeOff,
  IconPinned,
  IconPinnedOff,
} from '@tabler/icons-react'
import JsonCell from './JsonCell'

export type SmartGridProps = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  height?: number
  sorting?: any
  onSortingChange?: (updater: any) => void
  columnFilters?: any
  onColumnFiltersChange?: (updater: any) => void
  onApplyFilters?: () => void
  jsonColumns?: string[]
}

export default function SmartGrid({
  columns,
  rows,
  height = 420,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  onApplyFilters,
  jsonColumns,
}: SmartGridProps) {
  const colDefs = React.useMemo<
    MRT_ColumnDef<Record<string, unknown>>[]
  >(() => {
    return columns.map((key) => ({
      header: key,
      accessorKey: key,
      enableSorting: true,
      enableColumnFilter: true,
      filterVariant: 'text',
      accessorFn: (row) => {
        const v: any = row[key]
        if (v == null) return ''
        if (typeof v === 'object') {
          try { return JSON.stringify(v) } catch { return String(v) }
        }
        return String(v)
      },
      mantineTableHeadCellProps: { style: { whiteSpace: 'nowrap' } },
      mantineTableBodyCellProps: { style: { fontFamily: 'var(--mantine-font-family-monospace)' } },
      // JSON 列使用专用渲染器
      ...(jsonColumns && jsonColumns.includes(key)
        ? { Cell: ({ cell }: any) => <JsonCell value={cell.getValue()} previewMax={32} /> }
        : {}),
    }))
  }, [columns, jsonColumns])

  const gray = 'var(--mantine-color-dimmed)'
  const BOX = 16
  const GLYPH = 14
  const wrapIcon = (C: any, dy = 0) => {
    const WrappedIcon = (props: any) => (
      <span
        style={{ display: 'inline-flex', width: BOX, height: BOX, alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', transform: dy ? `translateY(${dy}px)` : undefined }}
      >
        <C stroke={1.75} color={gray} size={GLYPH} {...props} />
      </span>
    )
    const baseName = C?.displayName || C?.name || 'Icon'
    ;(WrappedIcon as any).displayName = `WrapIcon(${baseName})`
    return WrappedIcon
  }
  const icons: any = {
    IconArrowsSort: wrapIcon(IconArrowsSort),
    IconArrowDown: wrapIcon(IconArrowNarrowDown),
    IconArrowUp: wrapIcon(IconArrowNarrowUp),
    IconSearch: wrapIcon(IconSearch),
    IconFilter: wrapIcon(IconFilter, -0.5),
    IconChevronDown: wrapIcon(IconChevronDown),
    IconChevronUp: wrapIcon(IconChevronUp),
    IconGripVertical: wrapIcon(IconGripVertical),
    IconEye: wrapIcon(IconEye),
    IconEyeOff: wrapIcon(IconEyeOff),
    IconPinned: wrapIcon(IconPinned),
    IconPinnedOff: wrapIcon(IconPinnedOff),
  }

  const table = useMantineReactTable({
    columns: colDefs,
    data: rows,
    enableColumnResizing: true,
    columnResizeMode: 'onEnd',
    enableColumnOrdering: true,
    enableColumnDragging: false,
    enableColumnFilters: true,
    columnFilterDisplayMode: 'popover',
    enableFilters: true,
    enableSorting: true,
    manualSorting: true,
    manualFiltering: true,
    enableStickyHeader: true,
    enableHiding: true,
    enablePinning: true,
    enableTopToolbar: false,
    enableBottomToolbar: false,
    enablePagination: false,
    enableRowVirtualization: rows.length > 50,
    enableColumnVirtualization: columns.length > 12,
    columnVirtualizerOptions: { overscan: 3 },
    rowVirtualizerOptions: { overscan: 8 },
    defaultColumn: {
      minSize: 80,
      size: 160,
      maxSize: 480,
      Filter: ({ column }) => {
        const val = (column.getFilterValue() as string) ?? ''
        return (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              aria-label={`Filter by ${String(column.id)}`}
              value={val}
              onChange={(e) => column.setFilterValue(e.currentTarget.value)}
              size="xs"
              placeholder={`Filter by ${String(column.id)}`}
              style={{ flex: 1, minWidth: 140 }}
            />
            <Button size="xs" variant="default" onClick={() => onApplyFilters?.()}>应用</Button>
          </Group>
        )
      },
    },
    mantinePaperProps: { withBorder: true },
    mantineTableProps: { highlightOnHover: true, striped: 'odd' },
    mantineTableHeadRowProps: { style: { height: 34 } },
    mantineTableHeadCellProps: {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--mantine-color-dimmed)',
        gap: 6,
        verticalAlign: 'middle',
        lineHeight: '16px',
        paddingTop: 6,
        paddingBottom: 6,
      },
    },
    mantineTableBodyCellProps: {
      style: { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: 560 },
    },
    mantineTableContainerProps: { className: 'rdv-grid', style: { maxHeight: height, overflow: 'auto' } },
    initialState: { density: 'xs', columnOrder: columns, showColumnFilters: false },
    state: { sorting, columnFilters },
    onSortingChange,
    onColumnFiltersChange,
    icons,
  })

  return <MantineReactTable table={table} />
}
