"use client";

import React, { useMemo } from "react";
import { Button, Code, Group, Paper, Title } from "@mantine/core";
import { IconPlus, IconScan } from "@tabler/icons-react";
import type { editor } from "monaco-editor";
import { CodeEditor } from "@/components/code/CodeEditor";

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
  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      tabSize: 2,
      insertSpaces: true,
      suggestOnTriggerCharacters: true,
    }),
    [],
  );

  return (
    <Paper withBorder p="md">
      <Title order={4}>SQL</Title>
      <CodeEditor
        value={sql}
        onChange={onChange}
        language="sql"
        height={320}
        minHeight={280}
        options={options}
        ariaLabel="SQL editor"
        modelPath="file:///saved-sql.sql"
        fallbackEditable
        placeholder="-- 在此编写 SQL 查询，可使用 {{变量}} 占位符"
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
