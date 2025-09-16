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

export function RuntimeCalcCards({
  items,
  calcResults,
  onRunCalc,
}: {
  items: CalcItemDef[];
  calcResults: Record<string, { loading?: boolean; value?: any; error?: string }>;
  onRunCalc: (item: CalcItemDef) => Promise<void>;
}) {
  if (items.length === 0) return null;
  return (
    <Paper withBorder p="xs" mt="xs">
      <Group gap="sm" wrap="wrap">
        {items.map((ci) => {
          const state = calcResults[ci.name] || {};
          const runMode = (ci.runMode ?? "manual") as "always" | "initial" | "manual";
          return (
            <Paper key={ci.name} withBorder p="xs" style={{ minWidth: 240 }}>
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
