"use client";

import type { SavedItem, TreeNode } from "./types";

export function buildSavedTree(list: SavedItem[], extraFolders: Set<string>): TreeNode {
  const root: TreeNode = { type: "folder", name: "", path: "/", children: [] };
  const ensureFolder = (segments: string[]): TreeNode => {
    let node = root;
    let p = "";
    for (const seg of segments) {
      p = p ? `${p}/${seg}` : seg;
      let child = node.children!.find((c) => c.type === "folder" && c.name === seg);
      if (!child) {
        child = { type: "folder", name: seg, path: p, children: [] };
        node.children!.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const it of list) {
    const parts = it.name.split("/").filter(Boolean);
    if (parts.length <= 1) {
      root.children!.push({ type: "item", name: it.name, path: it.name, item: it });
    } else {
      const leaf = parts[parts.length - 1]!;
      const folder = ensureFolder(parts.slice(0, -1));
      folder.children!.push({ type: "item", name: leaf, path: it.name, item: it });
    }
  }
  // inject extra (virtual) folders so they appear even when empty
  for (const f of Array.from(extraFolders)) {
    const segs = f.split("/").filter(Boolean);
    if (segs.length > 0) ensureFolder(segs);
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children) sortNodes(n.children);
  };
  sortNodes(root.children!);
  return root;
}

