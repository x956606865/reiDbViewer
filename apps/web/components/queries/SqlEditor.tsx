"use client";

import React from "react";
import { Button, Code, Group, Paper, Textarea, Title } from "@mantine/core";
import { IconPlus, IconScan } from "@tabler/icons-react";

export function SqlEditor({
  sql,
  onChange,
  onDetectVars,
  onAddVar,
}: {
  sql: string;
  onChange: (value: string) => void;
  onDetectVars: () => void;
  onAddVar: () => void;
}) {
  return (
    <Paper withBorder p="md">
      <Title order={4}>SQL</Title>
      <Textarea
        mt="sm"
        value={sql}
        onChange={(e) => onChange(e.currentTarget.value)}
        autosize
        minRows={8}
        styles={{
          input: { fontFamily: "var(--mantine-font-family-monospace)" },
        }}
      />
      <Group gap="xs" mt="xs">
        <Button
          size="xs"
          leftSection={<IconScan size={14} />}
          variant="light"
          onClick={onDetectVars}
        >
          从 SQL 提取变量
        </Button>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          variant="light"
          onClick={onAddVar}
        >
          新增变量
        </Button>
      </Group>
    </Paper>
  );
}

