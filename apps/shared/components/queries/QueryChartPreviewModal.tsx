"use client";

import React from "react";
import { Alert, Box, Group, Modal, NumberInput, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { LineChart } from "@mantine/charts";
import type { ChartConfig } from "../../queries/types";
import {
  buildLineChartData,
  getColumnKinds,
  isSeriesCompatible,
  ColumnKind,
} from "../../queries/chart-utils";

const MIN_LIMIT = 3;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 10;

type QueryChartPreviewModalProps = {
  opened: boolean;
  onClose: () => void;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  config: ChartConfig;
  onChange: (next: Partial<ChartConfig>) => void;
};

export function QueryChartPreviewModal({
  opened,
  onClose,
  columns,
  rows,
  config,
  onChange,
}: QueryChartPreviewModalProps) {
  const columnKinds = React.useMemo(() => getColumnKinds(rows, columns), [rows, columns]);

  const seriesColumns = React.useMemo(
    () =>
      columns.filter((column) => {
        const kind = columnKinds[column];
        return isSeriesCompatible(kind) || kind === "json";
      }),
    [columns, columnKinds],
  );

  const limitValue = React.useMemo(() => {
    if (config.limit && config.limit >= MIN_LIMIT) return Math.min(config.limit, MAX_LIMIT);
    return Math.min(DEFAULT_LIMIT, Math.max(rows.length, MIN_LIMIT));
  }, [config.limit, rows.length]);

  const xKind = config.xKey ? columnKinds[config.xKey] : undefined;
  const yKind = config.yKey ? columnKinds[config.yKey] : undefined;
  const requiresXPath = xKind === "json";
  const requiresYPath = yKind === "json";

  const chartPayload = React.useMemo(
    () =>
      buildLineChartData({
        rows,
        xKey: config.xKey,
        yKey: config.yKey,
        limit: limitValue,
        xJsonPath: config.xJsonPath,
        yJsonPath: config.yJsonPath,
        columnKinds,
      }),
    [columnKinds, config.xJsonPath, config.yJsonPath, config.xKey, config.yKey, limitValue, rows],
  );

  const { data, series, error, valueFormatter, xKind: resolvedXKind } = chartPayload;
  const showSeriesWarning = seriesColumns.length === 0;
  const columnOptions = columns.map((column) => ({
    value: column,
    label: appendKindLabel(column, columnKinds[column]),
  }));
  const seriesOptions = seriesColumns.map((column) => ({
    value: column,
    label: appendKindLabel(column, columnKinds[column]),
  }));
  const xJsonPathValue = config.xJsonPath ?? "";
  const yJsonPathValue = config.yJsonPath ?? "";

  return (
    <Modal opened={opened} onClose={onClose} title="折线图预览" size="lg" keepMounted={false} radius="md">
      <Stack gap="md">
        <Group align="flex-end" gap="sm">
          <Stack gap={4} flex={1} style={{ minWidth: 0 }}>
            <Select
              label="横轴列"
              placeholder="选择横轴"
              data={columnOptions}
              value={config.xKey}
              onChange={(value) => onChange({ xKey: value ?? null })}
              comboboxProps={{ withinPortal: true }}
            />
            {requiresXPath && (
              <TextInput
                label="JSON Path"
                placeholder="例如 payload.items[0].timestamp"
                value={xJsonPathValue}
                onChange={(event) => onChange({ xJsonPath: event.currentTarget.value })}
              />
            )}
          </Stack>
          <Stack gap={4} flex={1} style={{ minWidth: 0 }}>
            <Select
              label="纵轴列"
              placeholder="选择纵轴"
              data={seriesOptions}
              value={config.yKey}
              onChange={(value) => onChange({ yKey: value ?? null })}
              disabled={seriesOptions.length === 0}
              comboboxProps={{ withinPortal: true }}
            />
            {requiresYPath && (
              <TextInput
                label="JSON Path"
                placeholder="例如 stats[0].count"
                value={yJsonPathValue}
                onChange={(event) => onChange({ yJsonPath: event.currentTarget.value })}
              />
            )}
          </Stack>
          <NumberInput
            label="采样行数"
            min={MIN_LIMIT}
            max={MAX_LIMIT}
            step={1}
            value={limitValue}
            onChange={(value) => {
              const next = typeof value === "number" ? value : DEFAULT_LIMIT;
              onChange({ limit: Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, next)) });
            }}
            clampBehavior="strict"
            flex={1}
          />
        </Group>

        {showSeriesWarning && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            当前结果集中没有可用于纵轴的数值或日期列，请检查查询或调整格式。
          </Alert>
        )}

        {config.xKey && config.yKey ? (
          <Box>
            <Text c="dimmed" size="sm" mb="xs">
              图表仅基于当前分页的数据绘制。
            </Text>
            {series.length === 0 || error ? (
              <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">
                {error ?? "没有足够的数据点用于绘制折线图。"}
              </Alert>
            ) : (
              <LineChart
                h={360}
                data={data}
                dataKey={config.xKey}
                series={series.map((item) => ({ ...item, color: "blue.6" }))}
                withLegend={false}
                valueFormatter={valueFormatter}
                xAxisProps={resolvedXKind === "numeric" ? undefined : { tickFormatter: (value: string | number) => String(value) }}
                curveType="linear"
                connectNulls
              />
            )}
          </Box>
        ) : (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">
            请先选择横轴和纵轴列以生成图表。
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}

function appendKindLabel(column: string, kind: ColumnKind | undefined): string {
  if (kind === "numeric") {
    return `${column} · 数值`;
  }
  if (kind === "date") {
    return `${column} · 日期`;
  }
  if (kind === "json") {
    return `${column} · JSON`;
  }
  return column;
}
