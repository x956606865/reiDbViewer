"use client";

import React from "react";
import { Code, LoadingOverlay, Paper, ScrollArea, Stack, Title } from "@mantine/core";
import { DataGrid } from "../../components/DataGrid";

export function ResultsPanel({
  isExecuting,
  top,
  textResult,
  gridCols,
  rows,
  footer,
}: {
  isExecuting: boolean;
  top?: React.ReactNode;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  footer?: React.ReactNode;
}) {
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
          <Title order={4}>查询结果</Title>
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
