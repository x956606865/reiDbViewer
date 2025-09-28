"use client";

import React from "react";
import { Button, Code, Group, LoadingOverlay, Paper, ScrollArea, Stack, Title, Tooltip } from "@mantine/core";
import { IconChartLine } from "@tabler/icons-react";
import { DataGrid } from "../../components/DataGrid";

export function ResultsPanel({
  isExecuting,
  top,
  textResult,
  gridCols,
  rows,
  footer,
  chartEnabled = false,
  onOpenChart,
}: {
  isExecuting: boolean;
  top?: React.ReactNode;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  footer?: React.ReactNode;
  chartEnabled?: boolean;
  onOpenChart?: () => void;
}) {
  const showChartButton = typeof onOpenChart === "function";

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
          <Group justify="space-between" align="center">
            <Title order={4}>查询结果</Title>
            {showChartButton && !textResult && (
              <Tooltip label="仅基于当前页的数据绘制" position="left" withArrow>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconChartLine size={16} />}
                  onClick={onOpenChart}
                  disabled={!chartEnabled || rows.length === 0}
                >
                  折线图预览
                </Button>
              </Tooltip>
            )}
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
