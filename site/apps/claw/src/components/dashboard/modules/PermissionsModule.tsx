"use client";

import { Shield } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { PERMISSION_MAP } from "../agentViewMockData";

interface PermissionsModuleProps {
  variant: StyleVariant;
  permissions?: typeof PERMISSION_MAP | null;
}

export function PermissionsModule({ variant, permissions: permissionsProp }: PermissionsModuleProps) {
  const permissions = permissionsProp ?? PERMISSION_MAP;
  const isMock = !permissionsProp;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.24 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      <div className="flex items-center gap-1.5">
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ repeat: Infinity, duration: 2.5 }}
        >
          <Shield className="w-3.5 h-3.5 text-[#38D39F]" />
        </motion.div>
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Permissions
        </span>
      </div>
      {variant === "v1" ? (
        // v1: Table-style rows
        <div className="space-y-0.5">
          <div className="grid grid-cols-3 gap-1 text-[9px] text-text-muted uppercase px-1.5 pb-1 border-b border-border">
            <span>Scope</span>
            <span>Access</span>
            <span>Level</span>
          </div>
          {permissions.map((perm, idx) => {
            const PermIcon = perm.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 + idx * 0.04 }}
                className="grid grid-cols-3 gap-1 text-[10px] px-1.5 py-1 rounded hover:bg-surface-low transition-colors items-center"
              >
                <span className="flex items-center gap-1 text-foreground">
                  <PermIcon className="w-3 h-3 text-text-muted" />
                  {perm.scope}
                </span>
                <span className="text-text-muted font-mono">{perm.access}</span>
                <span
                  className={`font-mono ${perm.level === "full" ? "text-[#38D39F]" : perm.level === "filtered" ? "text-[#f0c56c]" : "text-text-secondary"}`}
                >
                  {perm.level}
                </span>
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        // v2: Icon badges with level colors
        <div className="flex flex-wrap gap-1.5">
          {permissions.map((perm, idx) => {
            const PermIcon = perm.icon;
            const levelColor =
              perm.level === "full"
                ? "border-[#38D39F]/25 bg-[#38D39F]/5"
                : perm.level === "filtered"
                  ? "border-[#f0c56c]/25 bg-[#f0c56c]/5"
                  : "border-border";
            return (
              <motion.div
                key={idx}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.05, type: "spring" }}
                whileHover={{ scale: 1.05 }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${levelColor}`}
                title={`${perm.scope}: ${perm.access} (${perm.level})`}
              >
                <PermIcon className="w-3 h-3 text-text-muted" />
                <span className="text-[10px] text-foreground">{perm.scope}</span>
                <motion.span
                  className={`w-1.5 h-1.5 rounded-full ${perm.level === "full" ? "bg-[#38D39F]" : perm.level === "filtered" ? "bg-[#f0c56c]" : "bg-text-muted"}`}
                  animate={{
                    scale: [0.8, 1.3, 0.8],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    delay: idx * 0.2,
                  }}
                />
              </motion.div>
            );
          })}
        </div>
      ) : (
        // v3: Compact rows with color dots
        <div className="space-y-0.5">
          {permissions.map((perm, idx) => {
            const PermIcon = perm.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                className="flex items-center gap-2 px-1.5 py-0.5 text-[10px]"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${perm.level === "full" ? "bg-[#38D39F]" : perm.level === "filtered" ? "bg-[#f0c56c]" : "bg-text-muted"}`}
                />
                <PermIcon className="w-3 h-3 text-text-muted" />
                <span className="text-foreground">{perm.scope}</span>
                <span className="text-text-muted ml-auto font-mono">
                  {perm.access}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
