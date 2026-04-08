"use client";

import { motion } from "framer-motion";
import { Shield, Check } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_GROUP_PERMISSIONS } from "../agentViewMockData";

interface GroupPermissionsModuleProps {
  variant: StyleVariant;
}

export function GroupPermissionsModule({
  variant,
}: GroupPermissionsModuleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.26 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5" /> Group Permissions
      </div>
      {variant === "v1" ? (
        <div className="space-y-1">
          {MOCK_GROUP_PERMISSIONS.map((p, idx) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
            >
              <span className="text-[10px] text-foreground flex-1">
                {p.name}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${p.role === "admin" ? "bg-[#38D39F]/10 text-[#38D39F]" : p.role === "operator" ? "bg-[#4A9EFF]/10 text-[#4A9EFF]" : p.role === "contributor" ? "bg-[#f0c56c]/10 text-[#f0c56c]" : "bg-surface-high text-text-muted"}`}
              >
                {p.role}
              </span>
              <span className="text-[10px]">
                {p.canInstruct ? (
                  <Check className="w-3 h-3 text-[#38D39F] inline" />
                ) : (
                  <span className="text-text-muted">&mdash;</span>
                )}
              </span>
              <span className="text-[10px]">
                {p.canApprove ? (
                  <Check className="w-3 h-3 text-[#38D39F] inline" />
                ) : (
                  <span className="text-text-muted">&mdash;</span>
                )}
              </span>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-2">
          {["admin", "operator", "contributor", "viewer"].map((role) => {
            const members = MOCK_GROUP_PERMISSIONS.filter(
              (p) => p.role === role
            );
            if (members.length === 0) return null;
            return (
              <div key={role}>
                <div className="text-[9px] font-medium text-text-muted/60 uppercase mb-0.5">
                  {role}s
                </div>
                {members.map((p) => (
                  <div
                    key={p.id}
                    className="text-[10px] text-foreground px-1 py-0.5"
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">
          {
            MOCK_GROUP_PERMISSIONS.filter(
              (p) => p.role === "admin" || p.role === "operator"
            ).length
          }{" "}
          admins &middot;{" "}
          {
            MOCK_GROUP_PERMISSIONS.filter((p) => p.role === "contributor")
              .length
          }{" "}
          contributor &middot;{" "}
          {MOCK_GROUP_PERMISSIONS.filter((p) => p.role === "viewer").length}{" "}
          viewer
        </div>
      )}
    </motion.div>
  );
}
