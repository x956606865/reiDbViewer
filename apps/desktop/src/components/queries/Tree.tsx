"use client";

import React from "react";
import { ActionIcon, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFileText,
  IconFolder,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import type { SavedItem, TreeNode } from "./types";

export const Tree = React.memo(function Tree({
  nodes,
  expanded,
  onToggle,
  onOpenItem,
  onEditItem,
  onDeleteItem,
}: {
  nodes: TreeNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenItem: (it: SavedItem) => void;
  onEditItem: (it: SavedItem) => void;
  onDeleteItem: (it: SavedItem) => void;
}) {
  return (
    <div>
      {nodes.map((n) => (
        <TreeRow
          key={n.type + ":" + n.path}
          node={n}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          onOpenItem={onOpenItem}
          onEditItem={onEditItem}
          onDeleteItem={onDeleteItem}
        />
      ))}
    </div>
  );
});

const TreeRow = React.memo(function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpenItem,
  onEditItem,
  onDeleteItem,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenItem: (it: SavedItem) => void;
  onEditItem: (it: SavedItem) => void;
  onDeleteItem: (it: SavedItem) => void;
}) {
  const pad = 8 + depth * 14;
  if (node.type === "folder") {
    const isOpen = expanded.has(node.path);
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 4px",
            cursor: "pointer",
          }}
          onClick={() => onToggle(node.path)}
        >
          <span style={{ width: pad }} />
          {isOpen ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
          <IconFolder size={14} />
          <Text>{node.name}</Text>
        </div>
        {isOpen &&
          node.children &&
          node.children.map((c) => (
            <TreeRow
              key={c.type + ":" + c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenItem={onOpenItem}
              onEditItem={onEditItem}
              onDeleteItem={onDeleteItem}
            />
          ))}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 4px",
      }}
    >
      <span style={{ width: pad }} />
      <IconFileText size={14} />
      <a
        onClick={() => node.item && onOpenItem(node.item)}
        style={{ cursor: "pointer", flex: 1 }}
      >
        {node.name}
      </a>
      {node.item && (
        <>
          <ActionIcon
            variant="light"
            onClick={(e) => {
              e.stopPropagation();
              onEditItem?.(node.item!);
            }}
            title="编辑"
          >
            <IconPencil size={14} />
          </ActionIcon>
          <ActionIcon
            color="red"
            variant="light"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteItem(node.item!);
            }}
            title="删除"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </>
      )}
    </div>
  );
});

