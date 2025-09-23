"use client";

import React from "react";
import {
  ActionIcon,
  Badge,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconDownload, IconFileText, IconRefresh, IconTrash } from "@tabler/icons-react";
import type {
  QueryApiRunStatus,
  QueryApiScriptRunRecord,
} from "../../../services/queryApiScripts";
import {
  extractRunProgress,
  extractRunScriptInfo,
} from "../../../lib/api-script-run-utils";

const STATUS_META: Record<QueryApiRunStatus, { label: string; color: string }> = {
  pending: { label: "待开始", color: "gray" },
  running: { label: "执行中", color: "blue" },
  succeeded: { label: "已完成", color: "teal" },
  completed_with_errors: { label: "完成（含错误）", color: "orange" },
  failed: { label: "执行失败", color: "red" },
  cancelled: { label: "已取消", color: "gray" },
};

const formatDateTime = (value: number | string | null | undefined): string => {
  if (value == null) return "未记录";
  const date = typeof value === "string" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
};

const formatNumber = (value: number | null | undefined): string => {
  if (value == null) return "-";
  return value.toLocaleString("zh-CN");
};

export function QueryApiScriptRunHistoryList({
  runs,
  loading,
  error,
  onRefresh,
  onExport,
  onViewLog,
  emptyHint = "暂无运行记录。执行脚本后可在此查看历史。",
  onCleanup,
  cleanupDisabled,
  downloadingRunId,
}: {
  runs: QueryApiScriptRunRecord[];
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onExport: (run: QueryApiScriptRunRecord) => void;
  onViewLog: (run: QueryApiScriptRunRecord) => void;
  emptyHint?: string;
  onCleanup?: () => void;
  cleanupDisabled?: boolean;
  downloadingRunId?: string | null;
}) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Text fw={600} size="sm">
              任务历史
            </Text>
            {loading ? <Loader size="sm" /> : null}
            {error ? (
              <Text size="xs" c="red">
                {error}
              </Text>
            ) : null}
          </Group>
          <Group gap="xs">
            {onCleanup ? (
              <Tooltip label="清理超过 24 小时的临时文件">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={onCleanup}
                  disabled={cleanupDisabled || loading}
                  aria-label="清理缓存"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}
            <Tooltip label="刷新任务历史">
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={onRefresh}
                disabled={loading}
                aria-label="刷新任务历史"
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {runs.length === 0 ? (
          <Text size="sm" c="dimmed">
            {emptyHint}
          </Text>
        ) : (
          <ScrollArea h={220} type="auto">
            <Stack gap="sm">
              {runs.map((run, index) => {
                const meta = STATUS_META[run.status];
                const progress = extractRunProgress(run);
                const scriptInfo = extractRunScriptInfo(run);
                const shouldShowDivider = index < runs.length - 1;
                const exportable = run.status !== 'running' && run.status !== 'pending';
                const exportTooltip = !exportable
                  ? '任务执行中，暂不可导出'
                  : run.zipPath
                    ? '导出结果 ZIP'
                    : '生成并导出 ZIP';
                const canViewLog = exportable;
                const logTooltip = !exportable
                  ? '任务执行中，暂不可查看日志'
                  : run.outputDir
                    ? '查看执行日志'
                    : '尝试加载执行日志';
                return (
                  <React.Fragment key={run.id}>
                    <Stack gap={4}>
                      <Group gap="xs" align="center" justify="space-between">
                        <Group gap="xs" align="center">
                          <Text fw={600} size="sm">
                            {scriptInfo.name ?? `运行 ${run.id.slice(0, 8)}`}
                          </Text>
                          <Badge color={meta.color} variant="dot">
                            {meta.label}
                          </Badge>
                        </Group>
                        <Group gap="md" align="center">
                          <Group gap="md">
                            <Text size="xs">
                              成功行：{formatNumber(progress.successRows)}
                            </Text>
                            <Text size="xs" c={progress.errorRows ? "red" : undefined}>
                              错误行：{formatNumber(progress.errorRows)}
                            </Text>
                          </Group>
                          <Group gap="xs">
                            <Tooltip label={exportTooltip}>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="blue"
                                onClick={() => onExport(run)}
                                disabled={!exportable}
                                loading={downloadingRunId === run.id}
                                aria-label="导出结果"
                              >
                                <IconDownload size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={logTooltip}>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                onClick={() => onViewLog(run)}
                                disabled={!canViewLog}
                                aria-label="查看日志"
                              >
                                <IconFileText size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>
                      </Group>
                      {scriptInfo.method && scriptInfo.endpoint ? (
                        <Text size="xs" c="dimmed">
                          {scriptInfo.method} · {scriptInfo.endpoint}
                        </Text>
                      ) : null}
                      <Group gap="md">
                        <Text size="xs" c="dimmed">
                          开始：{formatDateTime(run.startedAt)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          完成：{formatDateTime(run.finishedAt ?? run.updatedAt)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          ZIP：{run.zipPath ? '已生成' : exportable ? '待生成' : '未生成'}
                        </Text>
                      </Group>
                      {run.errorMessage ? (
                        <Text size="xs" c="red">
                          {run.errorMessage}
                        </Text>
                      ) : null}
                    </Stack>
                    {shouldShowDivider ? <Divider /> : null}
                  </React.Fragment>
                );
              })}
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </Paper>
  );
}
