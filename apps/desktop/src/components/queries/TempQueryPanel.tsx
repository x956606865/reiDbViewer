"use client";

import React, { useMemo, useEffect } from "react";
import { Badge, Code, Group, Paper, Text, Title } from "@mantine/core";
import type { editor } from "monaco-editor";
import { CodeEditor } from "@/components/code/CodeEditor";
import { PaginationSettings } from "./PaginationSettings";
import { RunActionsBar } from "./RunActionsBar";
import { SqlPreviewPanel } from "./SqlPreviewPanel";
import { ResultsPanel } from "./ResultsPanel";
import { PaginationBar } from "./PaginationBar";
import { ensureSchemaMetadataForConnection } from "@/lib/schema-metadata-store";

type QueryTimingState = {
  totalMs?: number | null;
  connectMs?: number | null;
  queryMs?: number | null;
  countMs?: number | null;
};

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
  onExecute: (override?: { page?: number; pageSize?: number; forceCount?: boolean; countOnly?: boolean }) => void;
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

  return (
    <>
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

      <PaginationSettings
        pgEnabled={pgEnabled}
        setPgEnabled={setPgEnabled}
        pgSize={pgSize}
        setPgSize={(n) => setPgSize(n)}
        pgPage={pgPage}
        setPgPage={(n) => setPgPage(n)}
        resetCounters={onResetCounters}
      />

      <RunActionsBar
        onPreview={onPreview}
        onExecute={() => onExecute()}
        onExplain={onExplain}
        isExecuting={isExecuting}
        explainFormat={explainFormat}
        setExplainFormat={setExplainFormat}
        explainAnalyze={explainAnalyze}
        setExplainAnalyze={setExplainAnalyze}
      />

      <SqlPreviewPanel ref={sqlPreviewRef} isPreviewing={isPreviewing} previewSQL={previewSQL} />

      <ResultsPanel
        isExecuting={isExecuting}
        top={null}
        textResult={textResult}
        gridCols={gridCols}
        rows={rows}
        timing={queryTiming}
        footer={
          <PaginationBar
            visible={pgEnabled && !textResult}
            page={pgPage}
            totalPages={pgTotalPages}
            totalRows={pgTotalRows}
            onFirst={() => {
              setPgPage(1);
              onExecute({ page: 1 });
            }}
            onPrev={() => {
              const next = Math.max(1, pgPage - 1);
              setPgPage(next);
              onExecute({ page: next });
            }}
            onNext={() => {
              const next = pgPage + 1;
              setPgPage(next);
              onExecute({ page: next });
            }}
            onLast={() => {
              if (pgTotalPages) {
                setPgPage(pgTotalPages);
                onExecute({ page: pgTotalPages });
              }
            }}
          />
        }
      />
    </>
  );
}

