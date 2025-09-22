"use client";

import React from "react";
import {
  Badge,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Button,
} from "@mantine/core";
import type { SavedQueryVariableDef } from "@rei-db-view/types/appdb";

export function RunParamsPanel({
  userConnId,
  currentConn,
  currentQueryName,
  vars,
  runValues,
  setRunValues,
}: {
  userConnId: string | null | undefined;
  currentConn: { alias: string; host?: string | null } | null;
  currentQueryName?: string | null;
  vars: SavedQueryVariableDef[];
  runValues: Record<string, any>;
  setRunValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}) {
  return (
    <Paper withBorder p="md">
      <Title order={4}>运行</Title>
      {currentQueryName ? (
        <Group mt="xs" gap="sm" align="center">
          <Text size="sm" c="dimmed">
            当前查询：
          </Text>
          <Badge color="blue" variant="light">
            {currentQueryName}
          </Badge>
        </Group>
      ) : null}
      <Group mt="xs" gap="sm" align="center">
        <Text size="sm" c="dimmed">
          当前连接：
        </Text>
        {userConnId ? (
          <Badge color="green">
            <Code>
              {currentConn?.alias || userConnId}
              {currentConn?.host ? (
                <>
                  {" "}
                  <span style={{ color: "var(--mantine-color-dimmed)" }}>
                    ({currentConn.host})
                  </span>
                </>
              ) : null}
            </Code>
          </Badge>
        ) : (
          <Badge color="gray">未选择</Badge>
        )}
      </Group>
      <Title order={5} mt="md">
        运行参数
      </Title>
      <Table mt="xs" withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>变量</Table.Th>
            <Table.Th>运行值</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {vars.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={2}>
                <Text c="dimmed">无变量</Text>
              </Table.Td>
            </Table.Tr>
          )}
          {vars.map((v) => (
            <Table.Tr key={`run_${v.name}`}>
              <Table.Td>
                <Code>{v.name}</Code>
              </Table.Td>
              <Table.Td>
                {v.type === "number" ? (
                  <NumberInput
                    value={(runValues[v.name] as any) ?? (v.default as any) ?? undefined}
                    onChange={(val) => setRunValues((rv) => ({ ...rv, [v.name]: val }))}
                    w={260}
                  />
                ) : v.type === "boolean" ? (
                  <Switch
                    checked={!!runValues[v.name]}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setRunValues((rv) => ({ ...rv, [v.name]: checked }));
                    }}
                  />
                ) : v.type === "enum" ? (
                  <Select
                    data={(v.options || []).map((o) => ({ value: o, label: o }))}
                    value={
                      typeof runValues[v.name] === "string" && runValues[v.name] !== ""
                        ? (runValues[v.name] as string)
                        : typeof v.default === "string"
                        ? (v.default as string)
                        : undefined
                    }
                    onChange={(val) => setRunValues((rv) => ({ ...rv, [v.name]: val ?? undefined }))}
                    w={260}
                    placeholder={(v.options || []).length > 0 ? "选择值" : "先填写枚举选项"}
                  />
                ) : (
                  <TextInput
                    value={String(runValues[v.name] ?? v.default ?? "")}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setRunValues((rv) => ({ ...rv, [v.name]: val }));
                    }}
                    w={360}
                  />
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group mt="xs">
        <Button
          size="xs"
          variant="light"
          onClick={() => setRunValues(Object.fromEntries(vars.map((v) => [v.name, v.default ?? ""])))}
        >
          重置为默认值
        </Button>
      </Group>
    </Paper>
  );
}
