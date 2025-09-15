"use client";

import React, { useMemo, useRef } from "react";
import { Button, Group, Text } from "@mantine/core";
import { LeftDrawer } from "../LeftDrawer";
import { Tree } from "./Tree";
import type { SavedItem, TreeNode } from "./types";
import { buildSavedTree } from "./tree-utils";

export function SavedQueriesSidebar({
  items,
  expanded,
  onToggleFolder,
  extraFolders,
  onCreateFolder,
  onNewQuery,
  onExportAll,
  onImportFile,
  busy,
  onOpenItemRun,
  onOpenItemEdit,
  onDeleteItem,
}: {
  items: SavedItem[];
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  extraFolders: Set<string>;
  onCreateFolder: (normPath: string) => void;
  onNewQuery: () => void;
  onExportAll: () => void;
  onImportFile: (file: File) => void;
  busy: string | null;
  onOpenItemRun: (it: SavedItem) => void;
  onOpenItemEdit: (it: SavedItem) => void;
  onDeleteItem: (it: SavedItem) => void;
}) {
  const tree: TreeNode = useMemo(() => buildSavedTree(items, extraFolders), [items, extraFolders]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <LeftDrawer title="我的查询">
      <Group mt="xs" gap="xs">
        <Button
          size="xs"
          variant="light"
          onClick={() => {
            const p = prompt('新建文件夹路径（用/分隔，如 reports/daily）');
            if (!p) return;
            const norm = p.split('/').filter(Boolean).join('/');
            if (!norm) return;
            onCreateFolder(norm);
          }}
        >
          新建文件夹
        </Button>
        <Button size="xs" variant="default" onClick={onNewQuery}>
          新建查询
        </Button>
        <Button size="xs" variant="default" onClick={onExportAll} disabled={!!busy}>
          {busy === '导出中...' ? '导出中...' : '导出全部'}
        </Button>
        <Button
          size="xs"
          variant="light"
          onClick={() => fileInputRef.current?.click()}
          disabled={!!busy}
        >
          导入
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) onImportFile(f);
          }}
        />
      </Group>
      {items.length === 0 ? (
        <Text c="dimmed" mt="xs">
          暂无
        </Text>
      ) : (
        <div style={{ marginTop: 8 }}>
          {tree.children && tree.children.length > 0 ? (
            <Tree
              nodes={tree.children}
              expanded={expanded}
              onToggle={onToggleFolder}
              onOpenItem={onOpenItemRun}
              onEditItem={onOpenItemEdit}
              onDeleteItem={onDeleteItem}
            />
          ) : (
            <Text c="dimmed">（空）</Text>
          )}
        </div>
      )}
    </LeftDrawer>
  );
}

