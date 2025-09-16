"use client";

import React from "react";
import { Badge, Button, Code, Group, Paper, Text } from "@mantine/core";
import type { CalcItemDef } from "@rei-db-view/types/appdb";

type CalcResultState = {
  loading?: boolean;
  value?: any;
  error?: string;
  groupRows?: Array<{ name: string; value: any }>;
};

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
  onRunCalc,
}: {
  items: CalcItemDef[];
  calcResults: Record<string, CalcResultState>;
  onRunCalc: (item: CalcItemDef) => Promise<void>;
}) {
  if (items.length === 0) return null;
  return (
    <Paper withBorder p="xs" mt="xs">
      <Group gap="sm" wrap="wrap">
        {items.map((ci) => {
          const state = calcResults[ci.name] || {};
          const runMode = (ci.runMode ?? "manual") as "always" | "initial" | "manual";
          const isGroup = (ci.kind ?? "single") === "group";
          const hasGroupResult = isGroup && Array.isArray(state.groupRows);
          const groupRows = isGroup && hasGroupResult ? state.groupRows ?? [] : [];
          const cardStyle = isGroup
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
                  onClick={() => {
                    void onRunCalc(ci);
                  }}
                >
                  计算
                </Button>
              </Group>
              <div style={{ marginTop: 6 }}>
                {state.error ? (
                  <Text size="sm" c="red">{state.error}</Text>
                ) : isGroup ? (
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
                      {groupRows.map((row, idx) => {
                        const valueContent = renderValue(row.value);
                        return (
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
                            <div>{valueContent}</div>
                          </Paper>
                        );
                      })}
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
