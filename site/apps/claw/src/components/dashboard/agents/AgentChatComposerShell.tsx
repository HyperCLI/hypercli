"use client";

import type { ComponentProps, ReactNode, Ref } from "react";

interface AgentChatComposerShellProps extends Omit<ComponentProps<"textarea">, "className"> {
  inputRef?: Ref<HTMLTextAreaElement>;
  inputClassName?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

export function AgentChatComposerShell({
  inputRef,
  inputClassName = "",
  children,
  footer,
  rows = 1,
  ...inputProps
}: AgentChatComposerShellProps) {
  return (
    <div className={`relative min-w-0 flex-1 ${footer ? "agent-chat-composer-with-footer rounded-3xl border border-border bg-surface-low" : ""}`}>
      <div className="relative">
        <textarea
          ref={inputRef}
          rows={rows}
          {...inputProps}
          data-focus-ring={footer ? "container" : undefined}
          className={`w-full resize-none overflow-hidden py-3 pl-5 text-sm text-foreground placeholder-text-muted focus:outline-none ${footer ? "rounded-t-3xl border-0 bg-transparent" : "rounded-3xl border border-border bg-surface-low focus:border-border-strong"} ${inputClassName}`}
        />
        {children}
      </div>
      {footer}
    </div>
  );
}
