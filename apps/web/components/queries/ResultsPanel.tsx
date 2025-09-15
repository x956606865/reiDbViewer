"use client";

import React from "react";
import { Code, LoadingOverlay, Paper, ScrollArea, Title } from "@mantine/core";
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
    <Paper withBorder p="xs" style={{ position: "relative" }}>
      <LoadingOverlay visible={isExecuting} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
      <Title order={4}>结果</Title>
      {top}
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
  );
}

