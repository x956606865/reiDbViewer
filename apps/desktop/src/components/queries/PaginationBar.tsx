"use client";

import React from "react";
import { Button, Group, Text } from "@mantine/core";

export function PaginationBar({
  visible,
  page,
  totalPages,
  totalRows,
  onFirst,
  onPrev,
  onNext,
  onLast,
}: {
  visible: boolean;
  page: number;
  totalPages: number | null;
  totalRows: number | null;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
}) {
  if (!visible) return null;
  return (
    <Group mt="sm" justify="space-between" align="center">
      <Group gap="xs">
        <Button size="xs" variant="default" disabled={page <= 1} onClick={onFirst}>
          首页
        </Button>
        <Button size="xs" variant="default" disabled={page <= 1} onClick={onPrev}>
          上一页
        </Button>
        <Button
          size="xs"
          variant="default"
          disabled={totalPages ? page >= totalPages : false}
          onClick={onNext}
        >
          下一页
        </Button>
        <Button
          size="xs"
          variant="default"
          disabled={!totalPages || page >= (totalPages || 1)}
          onClick={onLast}
        >
          末页
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        第 <b>{page}</b>
        {totalPages ? (
          <>
            {" "}/ <b>{totalPages}</b>
          </>
        ) : null}
        页
        {totalRows !== null ? (
          <>
            ，共 <b>{totalRows}</b> 条
          </>
        ) : null}
      </Text>
    </Group>
  );
}

