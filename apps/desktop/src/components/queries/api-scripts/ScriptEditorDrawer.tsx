"use client";

import React, { useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { ZodError } from "zod";
import {
  QUERY_API_ERROR_POLICIES,
  QUERY_API_METHODS,
  QUERY_API_MAX_BATCH,
  QUERY_API_MAX_SLEEP_MS,
  QUERY_API_MAX_TIMEOUT_MS,
  QUERY_API_MIN_TIMEOUT_MS,
  type QueryApiScriptInput,
} from "../../../services/queryApiScripts";
import {
  createHeaderDraft,
  scriptFormToInput,
  type QueryApiScriptFormHeader,
  type QueryApiScriptFormState,
} from "../../../lib/query-api-script-form";

const methodOptions = QUERY_API_METHODS.map((value) => ({ value, label: value }));
const errorPolicyOptions = QUERY_API_ERROR_POLICIES.map((value) => ({
  value,
  label: value === "abort" ? "出错终止" : "出错继续",
}));

const buildErrorMap = (error: ZodError): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!map[key]) map[key] = issue.message;
  }
  return map;
};

const headerErrorKey = (index: number, field: keyof QueryApiScriptFormHeader) =>
  `headers.${index}.${field}`;

export function QueryApiScriptEditorDrawer({
  opened,
  mode,
  form,
  setForm,
  saving,
  deleting,
  submitError,
  onSubmit,
  onDelete,
  onClose,
}: {
  opened: boolean;
  mode: "create" | "edit" | "duplicate";
  form: QueryApiScriptFormState;
  setForm: React.Dispatch<React.SetStateAction<QueryApiScriptFormState>>;
  saving?: boolean;
  deleting?: boolean;
  submitError?: string | null;
  onSubmit: (input: QueryApiScriptInput) => Promise<boolean>;
  onDelete?: (() => Promise<boolean>) | null;
  onClose: () => void;
}) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const title = useMemo(() => {
    if (mode === "create") return "新建 API 脚本";
    if (mode === "duplicate") return "复制 API 脚本";
    return "编辑 API 脚本";
  }, [mode]);

  const applyField = <K extends keyof QueryApiScriptFormState>(field: K, value: QueryApiScriptFormState[K]) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateHeader = (index: number, patch: Partial<QueryApiScriptFormHeader>) => {
    setForm((prev) => {
      const nextHeaders = prev.headers.map((hdr, idx) =>
        idx === index
          ? {
              ...hdr,
              ...patch,
            }
          : hdr,
      );
      return {
        ...prev,
        headers: nextHeaders,
      };
    });
  };

  const removeHeader = (index: number) => {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.filter((_, idx) => idx !== index),
    }));
  };

  const addHeader = () => {
    setForm((prev) => ({
      ...prev,
      headers: [...prev.headers, createHeaderDraft()],
    }));
  };

  const handleSubmit = async () => {
    try {
      const input = scriptFormToInput(form);
      setFieldErrors({});
      const success = await onSubmit(input);
      if (!success) return;
    } catch (err) {
      if (err instanceof ZodError) {
        setFieldErrors(buildErrorMap(err));
        return;
      }
      throw err;
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={title}
      position="right"
      size="lg"
      overlayProps={{ blur: 2 }}
    >
      <Stack gap="md" mih="100%">
        <Stack gap="sm">
          <TextInput
            label="脚本名称"
            placeholder="例如：订单同步"
            value={form.name}
            onChange={(event) => applyField("name", event.currentTarget.value)}
            error={fieldErrors["name"]}
            required
          />
          <TextInput
            label="描述"
            placeholder="可选：简要说明脚本用途"
            value={form.description}
            onChange={(event) => applyField("description", event.currentTarget.value)}
            error={fieldErrors["description"]}
          />
          <TextInput
            label="目标 API 地址"
            placeholder="https://"
            value={form.endpoint}
            onChange={(event) => applyField("endpoint", event.currentTarget.value)}
            error={fieldErrors["endpoint"]}
            required
          />
          <Group align="flex-end" gap="sm">
            <Select
              label="HTTP 方法"
              data={methodOptions}
              value={form.method}
              onChange={(val) => applyField("method", val ?? "")}
              error={fieldErrors["method"]}
              w={120}
            />
            <Select
              label="错误策略"
              data={errorPolicyOptions}
              value={form.errorPolicy}
              onChange={(val) => applyField("errorPolicy", val ?? "")}
              error={fieldErrors["errorPolicy"]}
              w={160}
            />
          </Group>
        </Stack>

        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Text fw={600}>请求头</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={addHeader}
            >
              新增 Header
            </Button>
          </Group>
          {form.headers.length === 0 ? (
            <Text c="dimmed" size="sm">
              未配置 Header。
            </Text>
          ) : (
            <Stack gap="xs">
              {form.headers.map((header, index) => (
                <Group key={header.id} align="flex-end" gap="xs" wrap="nowrap">
                  <TextInput
                    label="键"
                    placeholder="Authorization"
                    value={header.key}
                    onChange={(event) => updateHeader(index, { key: event.currentTarget.value })}
                    error={fieldErrors[headerErrorKey(index, "key")]}
                    flex={1}
                  />
                  <TextInput
                    label="值"
                    placeholder="" 
                    value={header.value}
                    type={header.sensitive ? "password" : "text"}
                    onChange={(event) => updateHeader(index, { value: event.currentTarget.value })}
                    error={fieldErrors[headerErrorKey(index, "value")]}
                    flex={1.3}
                  />
                  <Switch
                    label="敏感"
                    checked={header.sensitive}
                    onChange={(event) => updateHeader(index, { sensitive: event.currentTarget.checked })}
                  />
                  <Tooltip label="删除该 Header">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => removeHeader(index)}
                      aria-label="删除 Header"
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>

        <Stack gap="sm">
          <Group gap="sm">
            <NumberInput
              label="批次拉取数量 fetchSize"
              value={form.fetchSize}
              onChange={(value) => applyField("fetchSize", Number(value ?? 0))}
              min={1}
              max={QUERY_API_MAX_BATCH}
              error={fieldErrors["fetchSize"]}
              clampBehavior="strict"
              w={200}
            />
            <NumberInput
              label="批次发送 sendBatchSize"
              value={form.sendBatchSize}
              onChange={(value) => applyField("sendBatchSize", Number(value ?? 0))}
              min={1}
              max={QUERY_API_MAX_BATCH}
              error={fieldErrors["sendBatchSize"]}
              clampBehavior="strict"
              w={200}
            />
          </Group>
          <Group gap="sm">
            <NumberInput
              label="请求超时 (ms)"
              value={form.requestTimeoutMs}
              onChange={(value) => applyField("requestTimeoutMs", Number(value ?? 0))}
              min={QUERY_API_MIN_TIMEOUT_MS}
              max={QUERY_API_MAX_TIMEOUT_MS}
              error={fieldErrors["requestTimeoutMs"]}
              clampBehavior="strict"
              w={200}
            />
            <NumberInput
              label="每次请求休眠 (ms)"
              value={form.sleepMs}
              onChange={(value) => applyField("sleepMs", Number(value ?? 0))}
              min={0}
              max={QUERY_API_MAX_SLEEP_MS}
              error={fieldErrors["sleepMs"]}
              clampBehavior="strict"
              w={200}
            />
          </Group>
        </Stack>

        <Textarea
          label="请求体模板（可选）"
          placeholder="默认以 JSON 数组发送 batch"
          minRows={4}
          autosize
          value={form.bodyTemplate}
          onChange={(event) => applyField("bodyTemplate", event.currentTarget.value)}
          error={fieldErrors["bodyTemplate"]}
        />

        {submitError ? (
          <Text c="red" size="sm">
            {submitError}
          </Text>
        ) : null}

        <Group justify="space-between" mt="auto">
          <Group gap="xs">
            <Button variant="default" onClick={onClose} disabled={saving}>
              取消
            </Button>
            {onDelete ? (
              <Button
                color="red"
                onClick={async () => {
                  if (onDelete) await onDelete();
                }}
                disabled={saving || deleting}
              >
                {deleting ? "删除中..." : "删除"}
              </Button>
            ) : null}
          </Group>
          <Button onClick={handleSubmit} loading={saving}>
            {mode === "create" || mode === "duplicate" ? "保存脚本" : "更新脚本"}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
