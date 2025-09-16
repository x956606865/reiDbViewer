"use client";

import React from "react";
import { Badge, Button, Code, Group, Paper, Text } from "@mantine/core";
import type { CalcItemDef } from "@rei-db-view/types/appdb";
import { computeCalcSql, QueryError } from "@/services/pgExec";

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
  calcResults: Record<string, { loading?: boolean; value?: any; error?: string }>;
  setCalcResults: React.Dispatch<React.SetStateAction<Record<string, { loading?: boolean; value?: any; error?: string }>>>;
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
          return (
            <Paper key={ci.name} withBorder p="xs" style={{ minWidth: 240 }}>
              <Group justify="space-between" align="center">
                <Text size="sm" component="div">
                  <b>{ci.name === "__total_count__" ? "总数" : ci.name}</b> <Badge size="xs" variant="light">{ci.type.toUpperCase()}</Badge>
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  loading={!!state.loading}
                  onClick={async () => {
                    setCalcResults((s) => ({
                      ...s,
                      [ci.name]: { ...s[ci.name], loading: true, error: undefined },
                    }));
                    try {
                      if (ci.type === "sql") {
                        if (!currentId) throw new Error("请先保存/选择查询");
                        if (!userConnId) throw new Error("未设置当前连接");
                        const res = await computeCalcSql({
                          savedId: currentId,
                          values: runValues,
                          userConnId,
                          calcSql: ci.code,
                        });
                        const rows = res.rows;
                        if (ci.name === "__total_count__") {
                          let num: number | null = null;
                          if (rows[0]) {
                            const v = (rows[0] as any).total ?? (rows[0] as any).count ?? Object.values(rows[0])[0];
                            const n = typeof v === "string" ? Number(v) : (typeof v === "number" ? v : null);
                            num = Number.isFinite(n as number) ? (n as number) : null;
                          }
                          if (num === null) throw new Error("返回格式不符合预期，应包含 total/count");
                          onUpdateCount(num);
                          setCalcResults((s) => ({ ...s, [ci.name]: { value: num, loading: false } }));
                        } else {
                          let display: any = null;
                          if (rows.length === 0) display = null;
                          else if (rows.length === 1) {
                            const cols = res.columns?.length ? res.columns : Object.keys(rows[0] || {});
                            display = cols.length === 1 ? (rows[0] as any)[cols[0] as any] : rows[0];
                          } else display = rows;
                          setCalcResults((s) => ({ ...s, [ci.name]: { value: display, loading: false } }));
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
                        setCalcResults((s) => ({ ...s, [ci.name]: { value: val, loading: false } }));
                      }
                    } catch (e: any) {
                      const msg = e instanceof QueryError ? e.message : String(e?.message || e);
                      setCalcResults((s) => ({
                        ...s,
                        [ci.name]: { error: msg, loading: false },
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
                ) : state.value !== undefined ? (
                  typeof state.value === "object" ? (
                    <Code block>{JSON.stringify(state.value, null, 2)}</Code>
                  ) : (
                    <Text size="sm">{String(state.value)}</Text>
                  )
                ) : (
                  <Text size="sm" c="dimmed">未计算</Text>
                )}
              </div>
            </Paper>
          );
        })}
      </Group>
    </Paper>
  );
}
