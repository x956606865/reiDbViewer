"use client";

import React from "react";
import {
  ActionIcon,
  Code,
  CopyButton,
  Group,
  LoadingOverlay,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { ResizableDataGrid } from "../../components/ResizableDataGrid";
import { IconCopy } from "@tabler/icons-react";
import type { QueryTimingState } from "./types";

const formatDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

const buildTimingLabel = (timing?: QueryTimingState | null) => {
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
  columnWidths,
  onColumnWidthsChange,
}: {
  isExecuting: boolean;
  top?: React.ReactNode;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  footer?: React.ReactNode;
  timing?: QueryTimingState | null;
  columnWidths?: Record<string, number>;
  onColumnWidthsChange?: (next: Record<string, number>) => void;
}) {
  const durationLabel = buildTimingLabel(timing);
  const textPlaceholder = "（无返回）";
  const trimmedText = (textResult ?? "").trim();
  const hasCopyableText = trimmedText.length > 0;
  const displayText = textResult && textResult.length > 0 ? textResult : textPlaceholder;

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
                <Group justify="space-between" align="center" gap="xs">
                  <Text fw={600} size="sm">
                    文本输出
                  </Text>
                  {hasCopyableText ? (
                    <CopyButton value={textResult} timeout={1200}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? "已复制" : "复制结果"}>
                          <ActionIcon
                            size="sm"
                            variant="light"
                            color={copied ? "teal" : "gray"}
                            onClick={copy}
                            aria-label="复制结果"
                          >
                            <IconCopy size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                  ) : (
                    <Tooltip label="暂无文本可复制">
                      <ActionIcon
                        size="sm"
                        variant="light"
                        color="gray"
                        aria-label="暂无文本可复制"
                        disabled
                      >
                        <IconCopy size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
                <ScrollArea
                  h={320}
                  type="auto"
                  style={{ marginTop: "var(--mantine-spacing-xs)" }}
                >
                  <Code block>{displayText}</Code>
                </ScrollArea>
              </Paper>
            ) : (
              <ResizableDataGrid
                columns={gridCols}
                rows={rows}
                columnWidths={columnWidths}
                onColumnWidthsChange={onColumnWidthsChange}
              />
            )}
          </div>
          {footer}
        </Paper>
      </Stack>
    </div>
  );
}
