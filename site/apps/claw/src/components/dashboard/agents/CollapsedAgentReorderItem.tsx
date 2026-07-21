"use client";

import { Reorder, useDragControls } from "framer-motion";
import { GripVertical } from "lucide-react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

interface CollapsedAgentReorderItemProps {
  agentId: string;
  agentName: string;
  canReorder: boolean;
  children: ReactNode;
  onMove: (direction: -1 | 1) => void;
}

export function CollapsedAgentReorderItem({
  agentId,
  agentName,
  canReorder,
  children,
  onMove,
}: CollapsedAgentReorderItemProps) {
  const dragControls = useDragControls();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <Reorder.Item
      as="div"
      value={agentId}
      dragListener={false}
      dragControls={dragControls}
      className="group/compact-agent relative flex w-16 shrink-0 list-none justify-center"
      whileDrag={{ scale: 1.04, zIndex: 20 }}
    >
      {canReorder ? (
        <button
          type="button"
          aria-label={`Move ${agentName}`}
          title={`Reorder ${agentName}`}
          className="absolute left-0.5 top-1/2 z-10 flex h-7 w-2.5 -translate-y-1/2 touch-none cursor-grab items-center justify-center rounded text-muted-foreground/45 opacity-70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing group-hover/compact-agent:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            dragControls.start(event);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={handleKeyDown}
        >
          <GripVertical className="h-3 w-2.5" aria-hidden="true" />
        </button>
      ) : null}
      {children}
    </Reorder.Item>
  );
}
