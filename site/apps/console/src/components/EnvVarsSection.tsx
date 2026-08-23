"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const MASK = "••••••••";

export interface EnvVarsSectionProps {
  envVars: Record<string, string> | null | undefined;
}

export default function EnvVarsSection({ envVars }: EnvVarsSectionProps) {
  const [revealedKeys, setRevealedKeys] = useState<ReadonlySet<string>>(new Set());

  const entries = Object.entries(envVars ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const toggle = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="bg-surface-low border border-border p-6 rounded-lg mb-6">
      <h2 className="text-xl font-bold text-foreground mb-2">Environment Variables</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Values are masked by default. Click the eye icon to reveal an individual value.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-tertiary-foreground">No environment variables set on this job.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
          {entries.map(([key, value]) => {
            const isRevealed = revealedKeys.has(key);
            return (
              <div key={key} className="flex items-start gap-3 px-4 py-3 bg-background">
                <span className="font-mono text-sm font-semibold text-foreground break-all min-w-0 max-w-1/2">
                  {key}
                </span>
                <span
                  className={`flex-1 min-w-0 font-mono text-sm break-all ${
                    isRevealed ? "text-foreground" : "text-muted-foreground"
                  }`}
                  data-testid={`env-value-${key}`}
                >
                  {isRevealed ? value : MASK}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-label={isRevealed ? `Hide ${key}` : `Show ${key}`}
                  title={isRevealed ? `Hide ${key}` : `Show ${key}`}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
