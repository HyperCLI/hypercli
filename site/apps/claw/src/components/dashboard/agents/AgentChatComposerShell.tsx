"use client";

import type { ComponentProps, ReactNode, Ref } from "react";

interface AgentChatComposerShellProps extends Omit<ComponentProps<"textarea">, "className"> {
  inputRef?: Ref<HTMLTextAreaElement>;
  inputClassName?: string;
  children?: ReactNode;
}

export function AgentChatComposerShell({
  inputRef,
  inputClassName = "",
  children,
  rows = 1,
  ...inputProps
}: AgentChatComposerShellProps) {
  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={inputRef}
        rows={rows}
        {...inputProps}
        className={`w-full resize-none overflow-hidden rounded-3xl border border-border bg-surface-low py-3 pl-5 text-sm text-foreground placeholder-text-muted focus:border-border-strong focus:outline-none ${inputClassName}`}
      />
      {children}
    </div>
  );
}
