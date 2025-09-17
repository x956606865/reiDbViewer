"use client";

import React from "react";
import { Code, Group, LoadingOverlay, Paper, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { DataGrid } from "../../components/DataGrid";

type TimingState = {
  totalMs?: number | null;
  connectMs?: number | null;
  queryMs?: number | null;
  countMs?: number | null;
};

const formatDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

const buildTimingLabel = (timing?: TimingState | null) => {
  if (!timing) return null;
  const parts: string[] = [];
  const { totalMs, connectMs, queryMs, countMs } = timing;
  if (totalMs != null) parts.push(`总 ${formatDuration(Math.round(totalMs))}`);
  if (connectMs != null) parts.push(`连接 ${formatDuration(Math.round(connectMs))}`);
  if (queryMs != null) parts.push(`查询 ${formatDuration(Math.round(queryMs))}`);
  if (countMs != null) parts.push(`计数 ${formatDuration(Math.round(countMs))}`);
  return parts.length ? parts.join(' · ') : null;
};

export function ResultsPanel({
  isExecuting,
  top,
  textResult,
  gridCols,
  rows,
  footer,
  timing,
}: {
  isExecuting: boolean;
  top?: React.ReactNode;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  footer?: React.ReactNode;
  timing?: TimingState | null;
}) {
  const durationLabel = buildTimingLabel(timing);

  return (
    <div style={{ position: "relative" }}>
      <LoadingOverlay visible={isExecuting} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
      <Stack gap="xs">
        {top && (
          <Paper withBorder p="xs">
            <Title order={4}>计算数据</Title>
            <div style={{ marginTop: 8 }}>{top}</div>
          </Paper>
        )}
        <Paper withBorder p="xs">
          <Group justify="space-between" align="center" gap="xs">
            <Title order={4}>查询结果</Title>
            {durationLabel ? (
              <Text size="xs" c="dimmed">
                耗时 {durationLabel}
              </Text>
            ) : null}
          </Group>
          <div style={{ marginTop: 8 }}>
            {textResult ? (
              <Paper withBorder p="sm">
                <ScrollArea h={320}>
                  <Code block>{textResult || "（无返回）"}</Code>
                </ScrollArea>
              </Paper>
            ) : (
              <DataGrid columns={gridCols} rows={rows} />
            )}
          </div>
          {footer}
        </Paper>
      </Stack>
    </div>
  );
}
