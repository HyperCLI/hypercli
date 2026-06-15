"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import type { PluginMeta } from "../integrations/plugin-registry";
import { isPluginConnected, RECOMMENDED_PLUGIN_IDS } from "./directory-utils";

interface DirectoryGridProps {
  plugins: PluginMeta[];
  config: Record<string, unknown> | null;
  onSelectPlugin: (pluginId: string) => void;
}

export function DirectoryGrid({ plugins, config, onSelectPlugin }: DirectoryGridProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return plugins;
    const q = search.toLowerCase();
    return plugins.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [plugins, search]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search integrations..."
          className="w-full rounded-lg border border-border bg-surface-low py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-text-muted focus:border-primary/50 focus:outline-none"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No integrations match your search.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((plugin) => {
            const pluginConnected = isPluginConnected(plugin.id, config);
            const recommended = !pluginConnected && RECOMMENDED_PLUGIN_IDS.has(plugin.id);
            const Icon = plugin.icon;

            return (
              <motion.button
                key={plugin.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectPlugin(plugin.id)}
                className="relative rounded-xl border border-border bg-surface-low/30 p-4 text-left transition-colors hover:border-primary/30 hover:bg-surface-low/60"
              >
                {pluginConnected && (
                  <div className="absolute top-3 right-3 flex items-center gap-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-success" />
                    <span className="text-[10px] font-medium text-success">Connected</span>
                  </div>
                )}
                {recommended && (
                  <div className="absolute top-3 right-3">
                    <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      Recommended
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-surface-low flex items-center justify-center shrink-0 border border-border">
                    <Icon className="w-4 h-4 text-text-muted" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate pr-16">{plugin.displayName}</div>
                    <div className="text-xs text-text-muted mt-0.5 line-clamp-2">{plugin.description}</div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
