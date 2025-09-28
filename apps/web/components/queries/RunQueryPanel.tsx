"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SavedQueryVariableDef, CalcItemDef } from "@rei-db-view/types/appdb";
import { PaginationSettings } from "./PaginationSettings";
import { RunParamsPanel } from "./RunParamsPanel";
import { RunActionsBar } from "./RunActionsBar";
import { SqlPreviewPanel } from "./SqlPreviewPanel";
import { ResultsPanel } from "./ResultsPanel";
import { RuntimeCalcCards } from "./RuntimeCalcCards";
import { PaginationBar } from "./PaginationBar";
import type { ChartConfig } from "@rei-db-view/shared/queries/types";
import { QueryChartPreviewModal } from "@rei-db-view/shared/components/queries/QueryChartPreviewModal";
import {
  getColumnKinds,
  findFirstSeriesColumn,
  isSeriesCompatible,
} from "@rei-db-view/shared/queries/chart-utils";

type CalcResultState = {
  loading?: boolean;
  value?: any;
  error?: string;
  groupRows?: Array<{ name: string; value: any }>;
};

const DEFAULT_LIMIT = 10;

export function RunQueryPanel({
  // connection + vars
  userConnId,
  currentConn,
  currentQueryName,
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
  setCalcResults,
  currentId,
  // count updates
  onUpdateTotal,
}: {
  userConnId?: string | null;
  currentConn: { id: string; alias: string; host?: string | null } | null;
  currentQueryName?: string | null;
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
  calcResults: Record<string, CalcResultState>;
  setCalcResults: React.Dispatch<React.SetStateAction<Record<string, CalcResultState>>>;
  currentId: string | null;
  onUpdateTotal: (totalRows: number | null, totalPages: number | null) => void;
}) {
  const [chartConfig, setChartConfig] = useState<ChartConfig>({
    opened: false,
    xKey: null,
    yKey: null,
    limit: DEFAULT_LIMIT,
    xJsonPath: "",
    yJsonPath: "",
  });

  const columnKinds = useMemo(() => getColumnKinds(rows, gridCols), [rows, gridCols]);
  const hasTabularData = useMemo(() => rows.length > 0 && !textResult, [rows.length, textResult]);
  const chartEnabled = hasTabularData && gridCols.length > 0;

  useEffect(() => {
    setChartConfig((prev) => {
      if (!hasTabularData) {
        if (!prev.opened) {
          return prev;
        }
        return { ...prev, opened: false };
      }

      const nextX = prev.xKey && gridCols.includes(prev.xKey) ? prev.xKey : gridCols[0] ?? null;
      const nextY =
        prev.yKey && gridCols.includes(prev.yKey) && isSeriesCompatible(columnKinds[prev.yKey])
          ? prev.yKey
          : findFirstSeriesColumn(gridCols, columnKinds);
      const nextLimit = prev.limit > 0 ? prev.limit : Math.min(DEFAULT_LIMIT, rows.length || DEFAULT_LIMIT);

      if (
        prev.xKey === nextX &&
        prev.yKey === nextY &&
        prev.limit === nextLimit
      ) {
        return prev;
      }

      const nextState: ChartConfig = {
        ...prev,
        xKey: nextX,
        yKey: nextY,
        limit: nextLimit,
      };

      if (prev.xKey !== nextX) {
        nextState.xJsonPath = "";
      }

      if (prev.yKey !== nextY) {
        nextState.yJsonPath = "";
      }

      return nextState;
    });
  }, [columnKinds, gridCols, hasTabularData, rows]);

  const handleChartChange = React.useCallback((next: Partial<ChartConfig>) => {
    setChartConfig((prev) => {
      const merged: ChartConfig = { ...prev, ...next };

      if ("xKey" in next && next.xKey !== prev.xKey) {
        merged.xJsonPath = "";
      }

      if ("yKey" in next && next.yKey !== prev.yKey) {
        merged.yJsonPath = "";
      }

      return merged;
    });
  }, []);

  return (
    <>
      <RunParamsPanel
        userConnId={userConnId}
        currentConn={currentConn}
        currentQueryName={currentQueryName}
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
            setCalcResults={setCalcResults}
            currentId={currentId}
            userConnId={userConnId}
            runValues={runValues}
            rows={rows}
            onUpdateCount={(total) => {
              const totalRows = typeof total === "number" ? total : null;
              const totalPages = totalRows != null ? Math.max(1, Math.ceil(totalRows / pgSize)) : null;
              onUpdateTotal(totalRows, totalPages);
            }}
            withContainer={false}
          />
        }
        textResult={textResult}
        gridCols={gridCols}
        rows={rows}
        chartEnabled={chartEnabled}
        onOpenChart={() => setChartConfig((prev) => ({ ...prev, opened: true }))}
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

      <QueryChartPreviewModal
        opened={chartConfig.opened}
        onClose={() => setChartConfig((prev) => ({ ...prev, opened: false }))}
        columns={gridCols}
        rows={rows}
        config={chartConfig}
        onChange={handleChartChange}
      />
    </>
  );
}
