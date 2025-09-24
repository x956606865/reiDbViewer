"use client";

import React from "react";
import { Badge, Loader, Stack, Tabs, Text } from "@mantine/core";
import type {
  QueryApiScriptRunRecord,
  QueryApiScriptSummary,
} from "../../../services/queryApiScripts";
import { RightDrawer } from "../../RightDrawer";
import { QueryApiScriptRunnerBar } from "./ScriptRunnerBar";
import { QueryApiScriptRunStatusCard } from "./ScriptRunStatusCard";
import { QueryApiScriptRunHistoryList } from "./ScriptRunHistoryList";

const TAB_STORAGE_KEY = "rdv.desktop.apiScripts.taskDrawer.tab";

export type RunnerSectionProps = {
  scripts: QueryApiScriptSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (script: QueryApiScriptSummary) => void;
  onRun: () => void;
  disabled?: boolean;
  running?: boolean;
  hasFreshResult?: boolean;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
};

export type StatusSectionProps = {
  run: QueryApiScriptRunRecord | null;
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  canceling?: boolean;
};

export type HistorySectionProps = {
  runs: QueryApiScriptRunRecord[];
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onExport: (run: QueryApiScriptRunRecord) => void;
  onViewLog: (run: QueryApiScriptRunRecord) => void;
  onCleanup?: () => void;
  cleanupDisabled?: boolean;
  downloadingRunId?: string | null;
  onDelete?: (run: QueryApiScriptRunRecord) => void;
  deleteDisabled?: boolean;
  deletingRunId?: string | null;
  onClear?: () => void;
  clearDisabled?: boolean;
};

export type QueryApiScriptTaskDrawerProps = {
  runner: RunnerSectionProps;
  status: StatusSectionProps;
  history: HistorySectionProps;
};

export function QueryApiScriptTaskDrawer({
  runner,
  status,
  history,
}: QueryApiScriptTaskDrawerProps) {
  const prefersStatusTab = status.run && (status.run.status === "running" || status.run.status === "pending");
  const initialTab = React.useMemo(() => {
    if (typeof window === "undefined") {
      return prefersStatusTab ? "status" : "select";
    }
    try {
      const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
      if (stored) return stored;
    } catch {}
    return prefersStatusTab ? "status" : "select";
  }, [prefersStatusTab]);

  const [tab, setTab] = React.useState<string>(initialTab);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {}
  }, [tab]);

  React.useEffect(() => {
    if (!prefersStatusTab) return;
    setTab((prev) => (prev === "status" ? prev : "status"));
  }, [prefersStatusTab]);

  const historyCount = history.runs.length;
  return (
    <RightDrawer
      title="脚本任务"
      widthExpanded={360}
      storageKey="rdv.desktop.apiScripts.taskDrawer.pin"
    >
      <Tabs value={tab} onChange={(value) => value && setTab(value)} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="select">选择任务</Tabs.Tab>
          <Tabs.Tab
            value="status"
            rightSection={
              status.loading
                ? <Loader size="xs" />
                : prefersStatusTab
                  ? <Badge size="xs" color="blue" variant="light">执行中</Badge>
                  : undefined
            }
          >
            运行中任务
          </Tabs.Tab>
          <Tabs.Tab
            value="history"
            rightSection={
              history.loading
                ? <Loader size="xs" />
                : historyCount > 0
                  ? <Badge size="xs" variant="light">{historyCount}</Badge>
                  : undefined
            }
          >
            任务历史
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="select" pt="xs">
          <Stack gap="sm">
            <QueryApiScriptRunnerBar {...runner} />
            {runner.loading ? (
              <Text size="xs" c="dimmed">
                脚本列表加载中...
              </Text>
            ) : runner.scripts.length === 0 ? (
              <Text size="xs" c="dimmed">
                当前查询暂无脚本。点击「新建脚本」开始配置。
              </Text>
            ) : null}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="status" pt="xs">
          <QueryApiScriptRunStatusCard {...status} />
        </Tabs.Panel>

        <Tabs.Panel value="history" pt="xs">
          <QueryApiScriptRunHistoryList {...history} />
        </Tabs.Panel>
      </Tabs>
    </RightDrawer>
  );
}
