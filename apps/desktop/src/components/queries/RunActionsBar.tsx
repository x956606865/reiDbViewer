"use client";

import React from "react";
import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Select,
  Switch,
  Tooltip,
} from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";

export function RunActionsBar({
  onPreview,
  onExecute,
  onExplain,
  isExecuting,
  explainFormat,
  setExplainFormat,
  explainAnalyze,
  setExplainAnalyze,
}: {
  onPreview: () => void;
  onExecute: () => void;
  onExplain: () => void;
  isExecuting: boolean;
  explainFormat: "text" | "json";
  setExplainFormat: (v: "text" | "json") => void;
  explainAnalyze: boolean;
  setExplainAnalyze: (v: boolean) => void;
}) {
  return (
    <Paper withBorder p="md">
      <Group mt="sm">
        <Button onClick={onPreview} variant="light">
          预览 SQL
        </Button>
        <Button onClick={onExecute} loading={isExecuting}>
          执行
        </Button>
        <Button onClick={onExplain} variant="default" loading={isExecuting}>
          Explain
        </Button>
        <Select
          data={[
            { value: "text", label: "TEXT" },
            { value: "json", label: "JSON" },
          ]}
          value={explainFormat}
          onChange={(v) => setExplainFormat(((v as any) || "text") as any)}
          w={120}
        />
        <Group gap="xs" align="center">
          <Switch
            checked={explainAnalyze}
            onChange={(e) => setExplainAnalyze(e.currentTarget.checked)}
            label="ANALYZE"
          />
          <Tooltip
            label={
              <div>
                <div>
                  <b>EXPLAIN</b>：仅显示计划（估算的 cost/rows）。
                </div>
                <div>
                  <b>EXPLAIN ANALYZE</b>：真实执行并返回实际行数/耗时等。
                </div>
                <div style={{ marginTop: 6 }}>
                  本应用仅允许在只读 SQL 上使用 ANALYZE；写语句将被拒绝。
                </div>
              </div>
            }
            withArrow
            multiline
            w={360}
            position="bottom"
          >
            <ActionIcon variant="subtle" color="gray" aria-label="Explain Analyze 帮助">
              <IconHelpCircle size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}

