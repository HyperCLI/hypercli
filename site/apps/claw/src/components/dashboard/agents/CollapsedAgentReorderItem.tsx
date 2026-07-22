"use client";

import { Reorder, useDragControls } from "framer-motion";
import { GripVertical } from "lucide-react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";

interface CollapsedAgentReorderItemProps {
  agentId: string;
  agentName: string;
  canReorder: boolean;
  children: ReactNode;
  onMove: (direction: -1 | 1) => void;
  onReorderingChange?: (reordering: boolean) => void;
}

export function CollapsedAgentReorderItem({
  agentId,
  agentName,
  canReorder,
  children,
  onMove,
  onReorderingChange,
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
      className="group/compact-agent relative flex w-8 shrink-0 list-none justify-center"
      whileDrag={{ scale: 1.04, zIndex: 20 }}
      onDragStart={() => onReorderingChange?.(true)}
      onDragEnd={() => onReorderingChange?.(false)}
    >
      {canReorder ? (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Move ${agentName}`}
              className="absolute -left-2 top-1/2 z-10 flex h-7 w-2 -translate-y-1/2 touch-none cursor-grab items-center justify-center rounded text-muted-foreground/45 opacity-70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing group-hover/compact-agent:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onFocus={() => onReorderingChange?.(true)}
              onBlur={() => onReorderingChange?.(false)}
              onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                onReorderingChange?.(true);
                dragControls.start(event);
              }}
              onPointerUp={() => onReorderingChange?.(false)}
              onPointerCancel={() => onReorderingChange?.(false)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={handleKeyDown}
            >
              <GripVertical className="h-3 w-2" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Reorder {agentName}</TooltipContent>
        </Tooltip>
      ) : null}
      {children}
    </Reorder.Item>
  );
}
