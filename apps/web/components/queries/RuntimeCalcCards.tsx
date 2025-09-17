"use client";

import React from "react";
import { Badge, Button, Code, Group, Paper, Text } from "@mantine/core";
import type { CalcItemDef } from "@rei-db-view/types/appdb";

const RUN_MODE_LABEL: Record<"always" | "initial" | "manual", string> = {
  always: "完全",
  initial: "首次拉取",
  manual: "手动",
};
const RUN_MODE_COLOR: Record<"always" | "initial" | "manual", string> = {
  always: "teal",
  initial: "blue",
  manual: "gray",
};

type CalcResultState = {
  loading?: boolean;
  value?: any;
  error?: string;
  groupRows?: Array<{ name: string; value: any }>;
};

const renderValue = (value: any) => {
  if (value === undefined) return <Text size="sm" c="dimmed">未计算</Text>;
  if (value === null) return <Text size="sm" c="dimmed">null</Text>;
  if (typeof value === "object") {
    try {
      return <Code block>{JSON.stringify(value, null, 2)}</Code>;
    } catch {
      return <Code block>{String(value)}</Code>;
    }
  }
  return <Text size="sm">{String(value)}</Text>;
};

export function RuntimeCalcCards({
  items,
  calcResults,
  setCalcResults,
  currentId,
  userConnId,
  runValues,
  rows,
  onUpdateCount,
}: {
  items: CalcItemDef[];
  calcResults: Record<string, CalcResultState>;
  setCalcResults: React.Dispatch<React.SetStateAction<Record<string, CalcResultState>>>;
  currentId: string | null;
  userConnId: string | null | undefined;
  runValues: Record<string, any>;
  rows: Array<Record<string, unknown>>;
  onUpdateCount: (total: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Paper withBorder p="xs" mt="xs">
      <Group gap="sm" wrap="wrap">
        {items.map((ci) => {
          const state = calcResults[ci.name] || {};
          const runMode = (ci.runMode ?? "manual") as "always" | "initial" | "manual";
          const variant = (ci.kind ?? "single") as "single" | "group";
          const hasGroupResult = variant === "group" && Array.isArray(state.groupRows);
          const groupRows = variant === "group" && hasGroupResult ? state.groupRows ?? [] : [];
          const cardStyle =
            variant === "group"
              ? { width: "100%", minWidth: "100%" }
              : { minWidth: 240 };
          return (
            <Paper key={ci.name} withBorder p="xs" style={cardStyle}>
              <Group justify="space-between" align="center">
                <Text size="sm" component="div">
                  <b>{ci.name === "__total_count__" ? "总数" : ci.name}</b>{" "}
                  <Group component="span" gap={6} align="center">
                    <Badge size="xs" variant="light">
                      {ci.type.toUpperCase()}
                    </Badge>
                    <Badge size="xs" variant="outline" color={RUN_MODE_COLOR[runMode]}>
                      {RUN_MODE_LABEL[runMode]}
                    </Badge>
                  </Group>
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  loading={!!state.loading}
                  onClick={async () => {
                    setCalcResults((s) => ({
                      ...s,
                      [ci.name]: {
                        ...s[ci.name],
                        loading: true,
                        error: undefined,
                        groupRows: variant === "group" ? undefined : s[ci.name]?.groupRows,
                      },
                    }));
                    try {
                      if (ci.type === "sql") {
                        if (!currentId) throw new Error("请先保存/选择查询");
                        if (!userConnId) throw new Error("未设置当前连接");
                        const res = await fetch("/api/saved-sql/compute", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ savedQueryId: currentId, values: runValues, userConnId, calcSql: ci.code }),
                        });
                        const j = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(j?.error || `计算失败（HTTP ${res.status}）`);
                        const rows = Array.isArray(j.rows) ? j.rows : [];
                        if (ci.name === "__total_count__") {
                          let num: number | null = null;
                          if (rows[0]) {
                            const v = (rows[0] as any).total ?? (rows[0] as any).count ?? Object.values(rows[0])[0];
                            const n = typeof v === "string" ? Number(v) : (typeof v === "number" ? v : null);
                            num = Number.isFinite(n as number) ? (n as number) : null;
                          }
                          if (num === null) throw new Error("返回格式不符合预期，应包含 total/count");
                          onUpdateCount(num);
                          setCalcResults((s) => ({
                            ...s,
                            [ci.name]: { value: num, loading: false },
                          }));
                        } else if (variant === "group") {
                          const columns = Array.isArray(j.columns) && j.columns.length
                            ? j.columns
                            : Object.keys(rows[0] || {});
                          if (columns.length < 2) {
                            throw new Error("计算数据组 SQL 需要至少两列（name, value）");
                          }
                          const [nameCol, valueCol] = columns;
                          const normalized = rows.map((row) => {
                            const rawName = (row as any)[nameCol as any];
                            if (rawName === undefined || rawName === null) {
                              throw new Error("name 列不能为空");
                            }
                            return {
                              name: String(rawName),
                              value: (row as any)[valueCol as any],
                            };
                          });
                          setCalcResults((s) => ({
                            ...s,
                            [ci.name]: { value: normalized, groupRows: normalized, loading: false },
                          }));
                        } else {
                          let display: any = null;
                          if (rows.length === 0) display = null;
                          else if (rows.length === 1) {
                            const cols = Array.isArray(j.columns) ? j.columns : Object.keys(rows[0] || {});
                            display = cols.length === 1 ? (rows[0] as any)[cols[0] as any] : rows[0];
                          } else display = rows;
                          setCalcResults((s) => ({
                            ...s,
                            [ci.name]: { value: display, loading: false, groupRows: undefined },
                          }));
                        }
                      } else {
                        const helpers = {
                          fmtDate: (v: any) => (v ? new Date(v).toISOString() : ""),
                          json: (v: any) => JSON.stringify(v),
                          sumBy: (arr: any[], sel: (r: any) => number) => arr.reduce((s, r) => s + (Number(sel(r)) || 0), 0),
                          avgBy: (arr: any[], sel: (r: any) => number) => {
                            const a = arr.map(sel).map(Number).filter((n) => Number.isFinite(n));
                            return a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
                          },
                        };
                        // eslint-disable-next-line no-new-func
                        const fn = new Function("vars", "rows", "helpers", `"use strict"; return ( ${ci.code} )(vars, rows, helpers)`) as any;
                        const val = fn(runValues, rows, helpers);
                        setCalcResults((s) => ({
                          ...s,
                          [ci.name]: { value: val, loading: false, groupRows: undefined },
                        }));
                      }
                    } catch (e: any) {
                      setCalcResults((s) => ({
                        ...s,
                        [ci.name]: {
                          ...s[ci.name],
                          error: String(e?.message || e),
                          loading: false,
                          groupRows: undefined,
                        },
                      }));
                    }
                  }}
                >
                  计算
                </Button>
              </Group>
              <div style={{ marginTop: 6 }}>
                {state.error ? (
                  <Text size="sm" c="red">{state.error}</Text>
                ) : variant === "group" ? (
                  !hasGroupResult ? (
                    <Text size="sm" c="dimmed">未计算</Text>
                  ) : groupRows.length === 0 ? (
                    <Text size="sm" c="dimmed">暂无数据</Text>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        width: "100%",
                      }}
                    >
                      {groupRows.map((row, idx) => (
                        <Paper
                          key={`${ci.name}-${row.name}-${idx}`}
                          withBorder
                          p="xs"
                          radius="sm"
                          style={{ flex: "0 1 220px", display: "flex", flexDirection: "column", gap: 4 }}
                        >
                          <Text size="sm" fw={600}>
                            {row.name}
                          </Text>
                          <div>{renderValue(row.value)}</div>
                        </Paper>
                      ))}
                    </div>
                  )
                ) : (
                  renderValue(state.value)
                )}
              </div>
            </Paper>
          );
        })}
      </Group>
    </Paper>
  );
}
