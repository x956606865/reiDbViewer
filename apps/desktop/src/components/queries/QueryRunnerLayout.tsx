"use client";

import React from "react";
import { PaginationSettings } from "./PaginationSettings";
import { RunActionsBar } from "./RunActionsBar";
import { SqlPreviewPanel } from "./SqlPreviewPanel";
import { ResultsPanel } from "./ResultsPanel";
import { PaginationBar } from "./PaginationBar";
import type { QueryTimingState } from "./types";
import type { ExecuteOverride } from "../../hooks/queries/useQueryExecutor";

export type QueryRunnerLayoutPagination = {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  pageSize: number;
  setPageSize: (value: number) => void;
  page: number;
  setPage: (value: number) => void;
  totalRows: number | null;
  totalPages: number | null;
  resetCounters: () => void;
  execute: (override?: ExecuteOverride) => void;
};

export type QueryRunnerLayoutActions = {
  onPreview: () => void;
  onExecute: (override?: ExecuteOverride) => void;
  onExplain: () => void;
  isExecuting: boolean;
  explainFormat: "text" | "json";
  setExplainFormat: (value: "text" | "json") => void;
  explainAnalyze: boolean;
  setExplainAnalyze: (value: boolean) => void;
};

export type QueryRunnerLayoutPreview = {
  ref: React.RefObject<HTMLDivElement | null>;
  isPreviewing: boolean;
  sql: string;
};

export type QueryRunnerLayoutResults = {
  isExecuting: boolean;
  top?: React.ReactNode;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  timing: QueryTimingState | null;
  columnWidths?: Record<string, number>;
  onColumnWidthsChange?: (next: Record<string, number>) => void;
};

export type QueryRunnerLayoutProps = {
  header?: React.ReactNode;
  paramsSection?: React.ReactNode;
  editorSection?: React.ReactNode;
  pagination: QueryRunnerLayoutPagination;
  actions: QueryRunnerLayoutActions;
  preview: QueryRunnerLayoutPreview;
  results: QueryRunnerLayoutResults;
};

export function QueryRunnerLayout({
  header,
  paramsSection,
  editorSection,
  pagination,
  actions,
  preview,
  results,
}: QueryRunnerLayoutProps) {
  const goToPage = (nextPage: number) => {
    pagination.setPage(nextPage);
    pagination.execute({ page: nextPage });
  };

  return (
    <>
      {header}
      {paramsSection}
      {editorSection}

      <PaginationSettings
        pgEnabled={pagination.enabled}
        setPgEnabled={pagination.setEnabled}
        pgSize={pagination.pageSize}
        setPgSize={(value) => pagination.setPageSize(value)}
        pgPage={pagination.page}
        setPgPage={(value) => pagination.setPage(value)}
        resetCounters={pagination.resetCounters}
      />

      <RunActionsBar
        onPreview={actions.onPreview}
        onExecute={() => actions.onExecute()}
        onExplain={actions.onExplain}
        isExecuting={actions.isExecuting}
        explainFormat={actions.explainFormat}
        setExplainFormat={actions.setExplainFormat}
        explainAnalyze={actions.explainAnalyze}
        setExplainAnalyze={actions.setExplainAnalyze}
      />

      <SqlPreviewPanel ref={preview.ref} isPreviewing={preview.isPreviewing} previewSQL={preview.sql} />

      <ResultsPanel
        isExecuting={results.isExecuting}
        top={results.top}
        textResult={results.textResult}
        gridCols={results.gridCols}
        rows={results.rows}
        timing={results.timing}
        columnWidths={results.columnWidths}
        onColumnWidthsChange={results.onColumnWidthsChange}
        footer={
          <PaginationBar
            visible={pagination.enabled && !results.textResult}
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalRows={pagination.totalRows}
            onFirst={() => goToPage(1)}
            onPrev={() => {
              const next = Math.max(1, pagination.page - 1);
              goToPage(next);
            }}
            onNext={() => {
              const next = pagination.page + 1;
              goToPage(next);
            }}
            onLast={() => {
              if (pagination.totalPages) {
                goToPage(pagination.totalPages);
              }
            }}
          />
        }
      />
    </>
  );
}
