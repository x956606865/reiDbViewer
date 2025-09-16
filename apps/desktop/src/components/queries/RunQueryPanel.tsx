"use client";

import React from "react";
import type { SavedQueryVariableDef, CalcItemDef } from "@rei-db-view/types/appdb";
import { PaginationSettings } from "./PaginationSettings";
import { RunParamsPanel } from "./RunParamsPanel";
import { RunActionsBar } from "./RunActionsBar";
import { SqlPreviewPanel } from "./SqlPreviewPanel";
import { ResultsPanel } from "./ResultsPanel";
import { RuntimeCalcCards } from "./RuntimeCalcCards";
import { PaginationBar } from "./PaginationBar";

export function RunQueryPanel({
  // connection + vars
  userConnId,
  currentConn,
  vars,
  runValues,
  setRunValues,
  // pagination
  pgEnabled,
  setPgEnabled,
  pgSize,
  setPgSize,
  pgPage,
  setPgPage,
  pgTotalRows,
  pgTotalPages,
  onResetCounters,
  // actions
  onPreview,
  onExecute,
  onExplain,
  isExecuting,
  explainFormat,
  setExplainFormat,
  explainAnalyze,
  setExplainAnalyze,
  // preview
  sqlPreviewRef,
  isPreviewing,
  previewSQL,
  // results
  textResult,
  gridCols,
  rows,
  // calc
  runtimeCalcItems,
  calcResults,
  onRunCalc,
  // count updates
  onUpdateTotal,
}: {
  userConnId?: string | null;
  currentConn: { id: string; alias: string; host?: string | null } | null;
  vars: SavedQueryVariableDef[];
  runValues: Record<string, any>;
  setRunValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  pgEnabled: boolean;
  setPgEnabled: (v: boolean) => void;
  pgSize: number;
  setPgSize: (v: number) => void;
  pgPage: number;
  setPgPage: (v: number) => void;
  pgTotalRows: number | null;
  pgTotalPages: number | null;
  onResetCounters: () => void;
  onPreview: () => void;
  onExecute: (override?: { page?: number; pageSize?: number; forceCount?: boolean; countOnly?: boolean }) => void;
  onExplain: () => void;
  isExecuting: boolean;
  explainFormat: "text" | "json";
  setExplainFormat: (v: "text" | "json") => void;
  explainAnalyze: boolean;
  setExplainAnalyze: (v: boolean) => void;
  sqlPreviewRef: React.RefObject<HTMLDivElement>;
  isPreviewing: boolean;
  previewSQL: string;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  runtimeCalcItems: CalcItemDef[];
  calcResults: Record<string, { loading?: boolean; value?: any; error?: string }>;
  onRunCalc: (item: CalcItemDef) => Promise<void>;
  onUpdateTotal: (totalRows: number | null, totalPages: number | null) => void;
}) {
  return (
    <>
      <RunParamsPanel
        userConnId={userConnId}
        currentConn={currentConn}
        vars={vars}
        runValues={runValues}
        setRunValues={setRunValues}
      />

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
        onPreview={() => onPreview()}
        onExecute={() => onExecute()}
        onExplain={() => onExplain()}
        isExecuting={isExecuting}
        explainFormat={explainFormat}
        setExplainFormat={setExplainFormat}
        explainAnalyze={explainAnalyze}
        setExplainAnalyze={setExplainAnalyze}
      />

      <SqlPreviewPanel ref={sqlPreviewRef} isPreviewing={isPreviewing} previewSQL={previewSQL} />

      <ResultsPanel
        isExecuting={isExecuting}
        top={
          <RuntimeCalcCards
            items={runtimeCalcItems}
            calcResults={calcResults}
            onRunCalc={onRunCalc}
          />
        }
        textResult={textResult}
        gridCols={gridCols}
        rows={rows}
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
