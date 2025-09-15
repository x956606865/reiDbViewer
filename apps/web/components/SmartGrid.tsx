'use client';

import * as React from 'react';
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef,
} from 'mantine-react-table';
import { Group, TextInput, Button } from '@mantine/core';
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
} from '@tabler/icons-react';

export type SmartGridProps = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  height?: number;
  sorting?: any;
  onSortingChange?: (updater: any) => void;
  columnFilters?: any;
  onColumnFiltersChange?: (updater: any) => void;
  onApplyFilters?: () => void;
};

export default function SmartGrid({
  columns,
  rows,
  height = 420,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  onApplyFilters,
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
      // 对象/数组转字符串以便排序/筛选
      accessorFn: (row) => {
        const v: any = row[key];
        if (v == null) return '';
        if (typeof v === 'object') {
          try {
            return JSON.stringify(v);
          } catch {
            return String(v);
          }
        }
        return String(v);
      },
      mantineTableHeadCellProps: { style: { whiteSpace: 'nowrap' } },
      mantineTableBodyCellProps: {
        style: { fontFamily: 'var(--mantine-font-family-monospace)' },
      },
    }));
  }, [columns]);

  // 统一化的轻量中性色图标：固定在 16x16 盒内，垂直居中，避免不同 glyph 视盒差异造成的错位
  const gray = 'var(--mantine-color-dimmed)';
  const BOX = 16;
  const GLYPH = 14; // 内部图标尺寸略小，留 1px 内边距，视觉居中更稳
  const wrapIcon = (C: any, dy = 0) => {
    const WrappedIcon = (props: any) => (
      <span
        style={{
          display: 'inline-flex',
          width: BOX,
          height: BOX,
          alignItems: 'center',
          justifyContent: 'center',
          verticalAlign: 'middle',
          transform: dy ? `translateY(${dy}px)` : undefined,
        }}
      >
        <C stroke={1.75} color={gray} size={GLYPH} {...props} />
      </span>
    );
    // Give the inner component a display name for lint/devtools.
    const baseName = C?.displayName || C?.name || 'Icon';
    (WrappedIcon as any).displayName = `WrapIcon(${baseName})`;
    return WrappedIcon;
  };
  const icons: any = {
    IconArrowsSort: wrapIcon(IconArrowsSort),
    IconArrowDown: wrapIcon(IconArrowNarrowDown),
    IconArrowUp: wrapIcon(IconArrowNarrowUp),
    IconSearch: wrapIcon(IconSearch),
    // 某些滤镜图标的视盒偏移略大，轻微上移 0.5px 提升对齐感
    IconFilter: wrapIcon(IconFilter, -0.5),
    IconChevronDown: wrapIcon(IconChevronDown),
    IconChevronUp: wrapIcon(IconChevronUp),
    IconGripVertical: wrapIcon(IconGripVertical), // 拖拽手柄（若显示）
    IconEye: wrapIcon(IconEye),
    IconEyeOff: wrapIcon(IconEyeOff),
    IconPinned: wrapIcon(IconPinned),
    IconPinnedOff: wrapIcon(IconPinnedOff),
  };

  const table = useMantineReactTable({
    columns: colDefs,
    data: rows,
    enableColumnResizing: true,
    columnResizeMode: 'onEnd',
    enableColumnOrdering: true,
    enableColumnDragging: false, // 隐藏拖拽手柄，保持更专业的简洁外观
    enableColumnFilters: true,
    columnFilterDisplayMode: 'popover', // 过滤放到弹出层，去掉表头下方的输入行
    enableFilters: true,
    enableSorting: true,
    manualSorting: true,
    manualFiltering: true,
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
    defaultColumn: {
      minSize: 80,
      size: 160,
      maxSize: 480,
      // 自定义筛选 UI：输入框 + 应用按钮（只更新草稿，点击“应用”才提交）
      Filter: ({ column, table }) => {
        const val = (column.getFilterValue() as string) ?? '';
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
            <Button
              size="xs"
              variant="default"
              onClick={() => onApplyFilters?.()}
            >
              应用
            </Button>
          </Group>
        );
      },
    },
    mantinePaperProps: { withBorder: true },
    mantineTableProps: { highlightOnHover: true, striped: 'odd' },
    mantineTableHeadRowProps: { style: { height: 34 } },
    mantineTableHeadCellProps: {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--mantine-color-dimmed)', // 与图标一致的中性灰
        gap: 6,
        verticalAlign: 'middle',
        lineHeight: '16px', // 与图标容器 16px 匹配，文本与图标同基线
        paddingTop: 6,
        paddingBottom: 6,
      },
    },
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
      // 若存在名为 actions 的列，默认固定到右侧
      columnPinning: columns.includes('actions')
        ? { right: ['actions'] }
        : { right: [] },
    },
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange,
    onColumnFiltersChange,
    icons,
    // 将“应用筛选”传入内部，用于自定义 Filter 中调用
    meta: { applyFilters: onApplyFilters },
  });

  return <MantineReactTable table={table} />;
}
