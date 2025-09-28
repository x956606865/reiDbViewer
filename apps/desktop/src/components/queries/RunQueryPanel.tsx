"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SavedQueryVariableDef, CalcItemDef } from "@rei-db-view/types/appdb";
import { RunParamsPanel } from "./RunParamsPanel";
import { RuntimeCalcCards } from "./RuntimeCalcCards";
import { QueryRunnerLayout } from "./QueryRunnerLayout";
import type { QueryTimingState, CalcResultState } from "./types";
import type { ExecuteOverride } from "../../hooks/queries/useQueryExecutor";
import type { ChartConfig } from "@rei-db-view/shared/queries/types";
import { QueryChartPreviewModal } from "@rei-db-view/shared/components/queries/QueryChartPreviewModal";
import {
  getColumnKinds,
  findFirstSeriesColumn,
  isSeriesCompatible,
} from "@rei-db-view/shared/queries/chart-utils";

const DEFAULT_LIMIT = 10;

export function RunQueryPanel({
  userConnId,
  currentConn,
  currentQueryName,
  vars,
  runValues,
  setRunValues,
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
  explainFormat,
  setExplainFormat,
  explainAnalyze,
  setExplainAnalyze,
  sqlPreviewRef,
  isPreviewing,
  previewSQL,
  textResult,
  gridCols,
  rows,
  queryTiming,
  columnWidths,
  onColumnWidthsChange,
  runtimeCalcItems,
  calcResults,
  onRunCalc,
  onUpdateTotal: _onUpdateTotal,
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
  onExecute: (override?: ExecuteOverride) => void;
  onExplain: () => void;
  isExecuting: boolean;
  explainFormat: "text" | "json";
  setExplainFormat: (v: "text" | "json") => void;
  explainAnalyze: boolean;
  setExplainAnalyze: (v: boolean) => void;
  sqlPreviewRef: React.RefObject<HTMLDivElement | null>;
  isPreviewing: boolean;
  previewSQL: string;
  textResult: string | null;
  gridCols: string[];
  rows: Array<Record<string, unknown>>;
  queryTiming: QueryTimingState | null;
  columnWidths?: Record<string, number>;
  onColumnWidthsChange?: (next: Record<string, number>) => void;
  runtimeCalcItems: CalcItemDef[];
  calcResults: Record<string, CalcResultState>;
  onRunCalc: (item: CalcItemDef) => Promise<void>;
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
  const chartAvailable = useMemo(() => rows.length > 0 && !textResult, [rows.length, textResult]);
  const chartEnabled = chartAvailable && gridCols.length > 0;

  useEffect(() => {
    setChartConfig((prev) => {
      if (!chartAvailable) {
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

      if (prev.xKey === nextX && prev.yKey === nextY && prev.limit === nextLimit) {
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
  }, [chartAvailable, columnKinds, gridCols, rows]);

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

  const resultsTop =
    runtimeCalcItems.length > 0 ? (
      <RuntimeCalcCards
        items={runtimeCalcItems}
        calcResults={calcResults}
        onRunCalc={onRunCalc}
        withContainer={false}
      />
    ) : undefined;

  return (
    <>
      <QueryRunnerLayout
        paramsSection={
          <RunParamsPanel
            userConnId={userConnId}
          currentConn={currentConn}
          currentQueryName={currentQueryName}
          vars={vars}
          runValues={runValues}
          setRunValues={setRunValues}
        />
      }
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
        top: resultsTop,
        textResult,
        gridCols,
        rows,
        timing: queryTiming,
        columnWidths,
        onColumnWidthsChange,
        chartEnabled,
        onOpenChart: () => setChartConfig((prev) => ({ ...prev, opened: true })),
      }}
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
