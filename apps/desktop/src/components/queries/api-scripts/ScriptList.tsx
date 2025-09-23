"use client";

import React from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconPlus, IconCopy, IconTrash } from "@tabler/icons-react";
import { LeftDrawer } from "../../LeftDrawer";
import type { QueryApiScriptSummary } from "../../../services/queryApiScripts";

const formatUpdatedLabel = (value: string | null | undefined): string => {
  if (!value) return "未记录";
  try {
    const date = new Date(value);
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
  } catch {
    return "未记录";
  }
};

const errorPolicyLabel = (policy: string) =>
  policy === "abort" ? "出错终止" : "出错继续";

export function QueryApiScriptList({
  scripts,
  selectedId,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  busy,
  loading,
  error,
}: {
  scripts: QueryApiScriptSummary[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (script: QueryApiScriptSummary) => void;
  onDelete: (script: QueryApiScriptSummary) => void;
  busy?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <LeftDrawer
      title="API 脚本"
      storageKey="rdv.desktop.apiScripts.drawer.pin"
      widthExpanded={320}
    >
      <Stack gap="sm">
        <Group gap="xs">
          <Button
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => onCreate()}
            disabled={!!busy}
          >
            新建脚本
          </Button>
        </Group>
        {error ? (
          <Text c="red" size="sm">
            {error}
          </Text>
        ) : null}
        {scripts.length === 0 ? (
          <Text c="dimmed" size="sm">
            {loading ? '脚本列表加载中...' : '当前查询暂无脚本。点击「新建脚本」开始配置。'}
          </Text>
        ) : (
          <Stack gap="xs">
            {scripts.map((script) => {
              const isActive = script.id === selectedId;
              return (
                <Paper
                  key={script.id}
                  withBorder
                  p="sm"
                  radius="md"
                  style={{
                    cursor: "pointer",
                    borderColor: isActive
                      ? "var(--mantine-color-blue-filled)"
                      : undefined,
                    backgroundColor: isActive
                      ? "var(--mantine-color-blue-0)"
                      : undefined,
                  }}
                  onClick={() => onSelect(script.id)}
                >
                  <Stack gap={4}>
                    <Group justify="space-between" gap="xs" align="center">
                      <Text fw={600} size="sm" style={{ flex: 1 }}>
                        {script.name}
                      </Text>
                      <Group gap={6}>
                        <Tooltip label="复制脚本">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              onDuplicate(script);
                            }}
                            aria-label="复制脚本"
                          >
                            <IconCopy size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="删除脚本">
                          <ActionIcon
                            size="sm"
                            color="red"
                            variant="subtle"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              onDelete(script);
                            }}
                            aria-label="删除脚本"
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                    <Group gap={6}>
                      <Badge size="xs" color="blue" variant="light">
                        {script.method}
                      </Badge>
                      <Badge size="xs" color={script.errorPolicy === "abort" ? "red" : "green"} variant="light">
                        {errorPolicyLabel(script.errorPolicy)}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {script.endpoint}
                    </Text>
                    <Text size="xs" c="dimmed">
                      最近更新：{formatUpdatedLabel(script.updatedAt)}
                    </Text>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Stack>
    </LeftDrawer>
  );
}
