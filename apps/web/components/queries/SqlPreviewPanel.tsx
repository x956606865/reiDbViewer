"use client";

import React from "react";
import { Code, LoadingOverlay, Paper, ScrollArea, Title } from "@mantine/core";

export const SqlPreviewPanel = React.forwardRef<HTMLDivElement, {
  isPreviewing: boolean;
  previewSQL: string;
}>(function SqlPreviewPanel({ isPreviewing, previewSQL }, ref) {
  return (
    <Paper withBorder p="sm" style={{ position: "relative" }} ref={ref}>
      <LoadingOverlay visible={isPreviewing} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
      <Title order={4}>SQL</Title>
      <Paper withBorder p="sm" mt="xs">
        <ScrollArea h={180}>
          <Code block>{previewSQL || '（点击“预览 SQL”或“执行”）'}</Code>
        </ScrollArea>
      </Paper>
    </Paper>
  );
});

