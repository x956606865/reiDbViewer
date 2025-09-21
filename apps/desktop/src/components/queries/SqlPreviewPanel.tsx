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
  Title,
  Tooltip,
} from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";

export const SqlPreviewPanel = React.forwardRef<HTMLDivElement, {
  isPreviewing: boolean;
  previewSQL: string;
}>(function SqlPreviewPanel({ isPreviewing, previewSQL }, ref) {
  const trimmed = previewSQL.trim();
  const hasSql = trimmed.length > 0;
  const displaySql = hasSql
    ? previewSQL
    : "（点击“预览 SQL”或“执行”）";

  return (
    <Paper withBorder p="sm" style={{ position: "relative" }} ref={ref}>
      <LoadingOverlay visible={isPreviewing} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
      <Group justify="space-between" align="center" gap="xs">
        <Title order={4} style={{ margin: 0 }}>
          SQL
        </Title>
        {hasSql ? (
          <CopyButton value={previewSQL} timeout={1200}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "已复制" : "复制 SQL"}>
                <ActionIcon
                  size="sm"
                  variant="light"
                  color={copied ? "teal" : "gray"}
                  onClick={copy}
                  aria-label="复制 SQL"
                >
                  <IconCopy size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        ) : (
          <Tooltip label="暂无 SQL 可复制">
            <ActionIcon
              size="sm"
              variant="light"
              color="gray"
              aria-label="暂无 SQL 可复制"
              disabled
            >
              <IconCopy size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <ScrollArea
        h={200}
        type="auto"
        style={{ marginTop: "var(--mantine-spacing-xs)" }}
      >
        <Code block>{displaySql}</Code>
      </ScrollArea>
    </Paper>
  );
});
