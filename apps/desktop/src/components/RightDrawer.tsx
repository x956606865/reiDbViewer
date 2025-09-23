"use client";

import React from "react";
import { ActionIcon, Group, ScrollArea, Text } from "@mantine/core";
import { IconPin, IconChevronLeft } from "@tabler/icons-react";

type RightDrawerProps = {
  title?: string;
  children: React.ReactNode;
  widthExpanded?: number;
  widthCollapsed?: number;
  storageKey?: string;
};

export function RightDrawer({
  title = "Details",
  children,
  widthExpanded = 320,
  widthCollapsed = 16,
  storageKey = "rdv.rightDrawer.pin",
}: RightDrawerProps) {
  const [pinned, setPinned] = React.useState<boolean>(true);
  const [handleHover, setHandleHover] = React.useState<boolean>(false);
  const [contentHover, setContentHover] = React.useState<boolean>(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setPinned(JSON.parse(raw));
    } catch {}
  }, [storageKey]);

  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pinned));
    } catch {}
  }, [pinned, storageKey]);

  const isOpen = pinned || handleHover || contentHover;
  const width = isOpen ? widthExpanded : widthCollapsed;

  return (
    <div
      style={{
        width,
        transition: "width 150ms ease",
        height: "100vh",
        position: "sticky",
        top: 0,
        borderLeft: isOpen ? "1px solid var(--mantine-color-default-border)" : "none",
        background: "var(--mantine-color-body)",
        display: "flex",
        flexDirection: "column",
      }}
      onMouseLeave={() => {
        if (!pinned) {
          setHandleHover(false);
          setContentHover(false);
        }
      }}
    >
      {isOpen ? (
        <div
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
          onMouseEnter={() => setContentHover(true)}
          onMouseLeave={() => setContentHover(false)}
        >
          <Group
            justify="space-between"
            align="center"
            gap="xs"
            style={{
              padding: 8,
              borderBottom: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <Text
              size="sm"
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </Text>
            <ActionIcon
              aria-pressed={pinned}
              variant="transparent"
              onClick={() => setPinned((prev) => !prev)}
              title={pinned ? "取消固定" : "固定抽屉"}
            >
              <IconPin
                size={16}
                color={
                  pinned
                    ? "var(--mantine-color-blue-6)"
                    : "var(--mantine-color-dimmed)"
                }
              />
            </ActionIcon>
          </Group>
          <ScrollArea style={{ flex: 1 }}>
            <div style={{ padding: 8 }}>{children}</div>
          </ScrollArea>
        </div>
      ) : (
        <div
          style={{
            width: widthCollapsed,
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "default",
          }}
          aria-label="展开抽屉"
          onMouseEnter={() => setHandleHover(true)}
          onMouseLeave={() => setHandleHover(false)}
        >
          <IconChevronLeft size={16} />
        </div>
      )}
    </div>
  );
}
