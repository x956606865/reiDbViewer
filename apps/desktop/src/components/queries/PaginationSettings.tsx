"use client";

import React from "react";
import { Group, NumberInput, Paper, Switch, Title } from "@mantine/core";

export function PaginationSettings({
  pgEnabled,
  setPgEnabled,
  pgSize,
  setPgSize,
  pgPage,
  setPgPage,
  resetCounters,
}: {
  pgEnabled: boolean;
  setPgEnabled: (v: boolean) => void;
  pgSize: number;
  setPgSize: (n: number) => void;
  pgPage: number;
  setPgPage: (n: number) => void;
  resetCounters: () => void;
}) {
  return (
    <Paper withBorder p="md">
      <Title order={5} mt="md">
        分页
      </Title>
      <Group mt="xs" gap="md" align="center">
        <Switch
          checked={pgEnabled}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            setPgEnabled(on);
            setPgPage(1);
            resetCounters();
          }}
          label="开启分页"
        />
        <NumberInput
          disabled={!pgEnabled}
          label="每页条数"
          value={pgSize}
          min={1}
          onChange={(v) => setPgSize(Number(v || 1))}
          w={140}
        />
        <NumberInput
          disabled={!pgEnabled}
          label="当前页"
          value={pgPage}
          min={1}
          onChange={(v) => setPgPage(Number(v || 1))}
          w={140}
        />
      </Group>
    </Paper>
  );
}

