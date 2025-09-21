"use client";

import React, { useMemo } from "react";
import {
  ActionIcon,
  Button,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconRefresh, IconTrash, IconX } from "@tabler/icons-react";
import { fetchEnumOptions } from "@/services/pgExec";
import type { SavedQueryVariableDef } from "@rei-db-view/types/appdb";
import type { editor } from "monaco-editor";
import { CodeEditor } from "@/components/code/CodeEditor";

const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const VAR_TYPES: Array<{ value: SavedQueryVariableDef["type"]; label: string }>
  = [
    { value: "text", label: "text" },
    { value: "number", label: "number" },
    { value: "boolean", label: "boolean" },
    { value: "date", label: "date" },
    { value: "timestamp", label: "timestamp" },
    { value: "json", label: "json" },
    { value: "uuid", label: "uuid" },
    { value: "raw", label: "raw" },
    { value: "enum", label: "enum" },
  ];

export function VariablesEditor({
  vars,
  setVars,
  runValues,
  setRunValues,
  onRemoveVar,
  userConnId,
}: {
  vars: SavedQueryVariableDef[];
  setVars: React.Dispatch<React.SetStateAction<SavedQueryVariableDef[]>>;
  runValues: Record<string, any>;
  setRunValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onRemoveVar: (name: string) => void;
  userConnId?: string | null;
}) {
  const hasEnum = vars.some((v) => v.type === "enum");
  const sqlOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: false },
      wordWrap: "on",
      lineNumbers: "off",
      fontSize: 13,
      scrollBeyondLastLine: false,
    }),
    [],
  );
  return (
    <Paper withBorder p="md">
      <Title order={4}>变量定义</Title>
      <Table mt="sm" withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>名称</Table.Th>
            <Table.Th>类型</Table.Th>
            {hasEnum && <Table.Th>枚举选项</Table.Th>}
            <Table.Th>必填</Table.Th>
            <Table.Th>默认值</Table.Th>
            <Table.Th w={60}>操作</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {vars.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={hasEnum ? 6 : 5}>
                <Text c="dimmed">无变量</Text>
              </Table.Td>
            </Table.Tr>
          )}
          {vars.map((v, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <TextInput
                  value={v.name}
                  onChange={(e) => {
                    const nextName = e.currentTarget.value;
                    setVars((vs) =>
                      vs.map((x, idx) => (idx === i ? { ...x, name: nextName } : x))
                    );
                    setRunValues((rv) => {
                      const copy = { ...rv } as Record<string, any>;
                      const oldName = v.name;
                      if (
                        oldName !== nextName &&
                        Object.prototype.hasOwnProperty.call(copy, oldName)
                      ) {
                        copy[nextName] = copy[oldName];
                        delete copy[oldName];
                      }
                      return copy;
                    });
                  }}
                  w={220}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  data={VAR_TYPES}
                  value={v.type}
                  onChange={(val) =>
                    setVars((vs) =>
                      vs.map((x, idx) =>
                        idx === i
                          ? {
                              ...x,
                              type: (val as any) || "text",
                              options:
                                (val as any) === "enum"
                                  ? Array.isArray(x.options)
                                    ? x.options
                                    : []
                                  : undefined,
                              optionsSql:
                                (val as any) === "enum" ? x.optionsSql : undefined,
                            }
                          : x
                      )
                    )
                  }
                  w={140}
                />
              </Table.Td>
              {hasEnum && (
                <Table.Td>
                  {v.type === "enum" ? (
                    <Stack gap={6}>
                      <TagsInput
                        value={(v.options as string[] | undefined) || []}
                        onChange={(vals) =>
                          setVars((vs) =>
                            vs.map((x, idx) =>
                              idx === i
                                ? {
                                    ...x,
                                    options: vals,
                                    default:
                                      x.default !== undefined &&
                                      x.default !== null &&
                                      !vals.includes(String(x.default))
                                        ? undefined
                                        : x.default,
                                  }
                                : x
                            )
                          )
                        }
                        placeholder="输入后回车添加选项"
                        w={260}
                      />
                      <CodeEditor
                        value={String(v.optionsSql ?? "")}
                        onChange={(val) =>
                          setVars((vs) =>
                            vs.map((x, idx) =>
                              idx === i ? { ...x, optionsSql: val } : x
                            )
                          )
                        }
                        language="sql"
                        height={140}
                        minHeight={120}
                        options={sqlOptions}
                        ariaLabel={`Enum options SQL ${v.name ?? i}`}
                        modelPath={`file:///variables/options-${i}.sql`}
                        placeholder="-- 可选：输入只读 SQL 拉取变量枚举"
                      />
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconRefresh size={14} />}
                          onClick={async () => {
                            const sqlText = (v.optionsSql || "").trim();
                            if (!sqlText) {
                              notifications.show({
                                color: "gray",
                                title: "缺少 SQL",
                                message: "请先填写用于拉取的 SQL",
                                icon: <IconX size={14} />,
                              });
                              return;
                            }
                            if (!userConnId) {
                              notifications.show({
                                color: "gray",
                                title: "未选择连接",
                                message: "请先选择当前连接后再拉取",
                                icon: <IconX size={14} />,
                              });
                              return;
                            }
                            try {
                              const payloadVars = vars.filter((item) =>
                                VAR_NAME_RE.test(item.name || "")
                              );
                              const { options: opts } = await fetchEnumOptions({
                                userConnId,
                                sql: sqlText,
                                variables: payloadVars,
                                values: runValues,
                              });
                              setVars((vs) =>
                                vs.map((x, idx) =>
                                  idx === i
                                    ? {
                                        ...x,
                                        options: opts,
                                        default:
                                          x.default !== undefined &&
                                          x.default !== null &&
                                          !opts.includes(String(x.default))
                                            ? undefined
                                            : x.default,
                                      }
                                    : x
                                )
                              );
                              notifications.show({
                                color: "teal",
                                title: "拉取成功",
                                message: `获得 ${opts.length} 项`,
                                icon: <IconCheck size={14} />,
                              });
                            } catch (e: any) {
                              notifications.show({
                                color: "red",
                                title: "拉取失败",
                                message: String(e?.message || e),
                                icon: <IconX size={14} />,
                              });
                            }
                          }}
                        >
                          拉取
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    <Text c="dimmed">—</Text>
                  )}
                </Table.Td>
              )}
              <Table.Td>
                <Switch
                  checked={!!v.required}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setVars((vs) =>
                      vs.map((x, idx) =>
                        idx === i ? { ...x, required: checked } : x
                      )
                    );
                  }}
                />
              </Table.Td>
              <Table.Td>
                {v.type === "number" ? (
                  <NumberInput
                    value={(v.default as any) ?? undefined}
                    onChange={(val) =>
                      setVars((vs) =>
                        vs.map((x, idx) =>
                          idx === i ? { ...x, default: (val as any) } : x
                        )
                      )
                    }
                    w={180}
                  />
                ) : v.type === "boolean" ? (
                  <Switch
                    checked={!!v.default}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setVars((vs) =>
                        vs.map((x, idx) =>
                          idx === i ? { ...x, default: checked } : x
                        )
                      );
                    }}
                  />
                ) : v.type === "enum" ? (
                  <Select
                    data={(v.options || []).map((o) => ({ value: o, label: o }))}
                    value={
                      typeof v.default === "string"
                        ? (v.default as string)
                        : undefined
                    }
                    onChange={(val) =>
                      setVars((vs) =>
                        vs.map((x, idx) =>
                          idx === i
                            ? { ...x, default: (val as any) ?? undefined }
                            : x
                        )
                      )
                    }
                    w={220}
                    placeholder={
                      (v.options || []).length > 0 ? "选择默认值" : "先填写枚举选项"
                    }
                  />
                ) : (
                  <TextInput
                    value={String(v.default ?? "")}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setVars((vs) =>
                        vs.map((x, idx) =>
                          idx === i ? { ...x, default: val } : x
                        )
                      );
                    }}
                    w={240}
                  />
                )}
              </Table.Td>
              <Table.Td>
                <ActionIcon color="red" variant="light" onClick={() => onRemoveVar(v.name)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
