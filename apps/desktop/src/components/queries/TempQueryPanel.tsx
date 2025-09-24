"use client";

import React, { useMemo, useEffect } from "react";
import { Badge, Code, Group, Paper, Text, Title } from "@mantine/core";
import type { editor } from "monaco-editor";
import { CodeEditor } from "@/components/code/CodeEditor";
import { ensureSchemaMetadataForConnection } from "@/lib/schema-metadata-store";
import { QueryRunnerLayout } from "./QueryRunnerLayout";
import type { QueryTimingState } from "./types";
import type { ExecuteOverride } from "../../hooks/queries/useQueryExecutor";

export function TempQueryPanel({
  userConnId,
  currentConn,
  sql,
  setSql,
  pgEnabled,
  setPgEnabled,
  pgSize,
  setPgSize,
  pgPage,
  setPgPage,
  pgTotalRows,
  pgTotalPages,
  onResetCounters,
  onPreview,
  onExecute,
  onExplain,
  isExecuting,
  sqlPreviewRef,
  isPreviewing,
  previewSQL,
  textResult,
  gridCols,
  rows,
  queryTiming,
  explainFormat,
  setExplainFormat,
  explainAnalyze,
  setExplainAnalyze,
}: {
  userConnId: string | null;
  currentConn: { alias: string; host?: string | null } | null;
  sql: string;
  setSql: (value: string) => void;
  pgEnabled: boolean;
  setPgEnabled: (v: boolean) => void;
  pgSize: number;
  setPgSize: (n: number) => void;
  pgPage: number;
  setPgPage: (n: number) => void;
  pgTotalRows: number | null;
  pgTotalPages: number | null;
  onResetCounters: () => void;
  onPreview: () => void;
  onExecute: (override?: ExecuteOverride) => void;
  onExplain: () => void;
  isExecuting: boolean;
  sqlPreviewRef: React.RefObject<HTMLDivElement | null>;
  isPreviewing: boolean;
  previewSQL: string;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  queryTiming: QueryTimingState | null;
  explainFormat: "text" | "json";
  setExplainFormat: (v: "text" | "json") => void;
  explainAnalyze: boolean;
  setExplainAnalyze: (v: boolean) => void;
}) {
  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({ tabSize: 2, insertSpaces: true, suggestOnTriggerCharacters: true }),
    [],
  );

  useEffect(() => {
    void ensureSchemaMetadataForConnection(userConnId ?? null).catch(() => {});
  }, [userConnId]);

  const headerSection = (
    <Paper withBorder p="md">
      <Title order={4}>临时查询</Title>
      <Text size="sm" c="dimmed" mt="xs">
        直接输入 SQL 并执行，不会保存到 Saved SQL 列表。
      </Text>
      <Group mt="sm" gap="sm" align="center">
        <Text size="sm" c="dimmed">
          当前连接：
        </Text>
        {userConnId ? (
          <Badge color="green">
            <Code>
              {currentConn?.alias || userConnId}
              {currentConn?.host ? (
                <>
                  {" "}
                  <span style={{ color: "var(--mantine-color-dimmed)" }}>
                    ({currentConn.host})
                  </span>
                </>
              ) : null}
            </Code>
          </Badge>
        ) : (
          <Badge color="gray">未选择</Badge>
        )}
      </Group>
    </Paper>
  );

  const editorSection = (
    <Paper withBorder p="md">
      <Title order={5}>SQL</Title>
      <CodeEditor
        value={sql}
        onChange={setSql}
        language="sql"
        height={320}
        minHeight={280}
        options={editorOptions}
        ariaLabel="临时 SQL 编辑器"
        modelPath="file:///temp-query.sql"
        fallbackEditable
        placeholder="-- 输入要执行的 SQL"
      />
    </Paper>
  );

  return (
    <QueryRunnerLayout
      header={headerSection}
      editorSection={editorSection}
      pagination={{
        enabled: pgEnabled,
        setEnabled: setPgEnabled,
        pageSize: pgSize,
        setPageSize: setPgSize,
        page: pgPage,
        setPage: setPgPage,
        totalRows: pgTotalRows,
        totalPages: pgTotalPages,
        resetCounters: onResetCounters,
        execute: onExecute,
      }}
      actions={{
        onPreview,
        onExecute,
        onExplain,
        isExecuting,
        explainFormat,
        setExplainFormat,
        explainAnalyze,
        setExplainAnalyze,
      }}
      preview={{
        ref: sqlPreviewRef,
        isPreviewing,
        sql: previewSQL,
      }}
      results={{
        isExecuting,
        textResult,
        gridCols,
        rows,
        timing: queryTiming,
      }}
    />
  );
}
