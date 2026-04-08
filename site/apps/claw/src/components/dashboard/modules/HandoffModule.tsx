"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Play, AlertTriangle, ArrowRightLeft, Trash2 } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { HANDOFF_IP_PRESETS, HANDOFF_NA_PRESETS } from "../agentViewMockData";
import { formatUptime } from "../agentViewUtils";

// ── HandoffAddableSection ──

function HandoffAddableSection({
  icon: SIcon,
  label,
  color,
  items,
  presets,
  onAdd,
  onRemove,
}: {
  icon: typeof Play;
  label: string;
  color: string;
  items: { id: string; task: string; subtitle: string; ts: number }[];
  presets: { task: string; subtitle: string }[];
  onAdd: (p: { task: string; subtitle: string }) => void;
  onRemove: (id: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const available = presets.filter((p) => !items.some((i) => i.task === p.task));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <SIcon className="w-3 h-3" style={{ color }} />
          <span className="text-[10px] font-medium text-text-muted">{label}</span>
          {items.length > 0 && <span className="text-[9px] text-text-muted/50">({items.length})</span>}
        </div>
        {!picking && available.length > 0 && (
          <button onClick={() => setPicking(true)} className="flex items-center gap-0.5 text-[10px] text-[#38D39F] hover:text-[#38D39F]/80 transition-colors">
            <Plus className="w-2.5 h-2.5" /><span>Add</span>
          </button>
        )}
      </div>

      {picking && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-md border border-border bg-surface-low p-1 space-y-0.5">
          {available.map((p) => (
            <button key={p.task} onClick={() => { onAdd(p); if (available.length <= 1) setPicking(false); }}
              className="w-full text-left px-2 py-1 rounded hover:bg-surface-low/80 transition-colors flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <div className="min-w-0 flex-1">
                <span className="text-[10px] text-foreground">{p.task}</span>
                <p className="text-[9px] text-text-muted truncate">{p.subtitle}</p>
              </div>
            </button>
          ))}
          <button onClick={() => setPicking(false)} className="w-full text-center text-[10px] text-text-muted hover:text-foreground py-0.5 transition-colors">Cancel</button>
        </motion.div>
      )}

      {items.length === 0 && !picking ? (
        <p className="text-[10px] text-text-muted/40 text-center py-1">No items</p>
      ) : items.map((item) => (
        <motion.div key={item.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="group/hi flex items-start justify-between p-1.5 rounded-md cursor-pointer transition-colors"
          style={{ border: `1px solid ${color}25`, backgroundColor: `${color}06` }}
          whileHover={{ backgroundColor: `${color}12` }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-foreground truncate">{item.task}</span>
              <span className="text-[8px] text-text-muted/40 flex-shrink-0">{formatUptime(Math.floor((Date.now() - item.ts) / 1000))}</span>
            </div>
            <p className="text-[9px] text-text-muted">{item.subtitle}</p>
          </div>
          <button onClick={() => onRemove(item.id)} className="flex-shrink-0 w-3.5 h-3.5 rounded flex items-center justify-center text-text-muted hover:text-[#d05f5f] opacity-0 group-hover/hi:opacity-100 transition-all mt-0.5">
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

// ── HandoffModule ──

export function HandoffModule({ variant }: { variant: StyleVariant }) {
  const [inProgress, setInProgress] = useState<{ id: string; task: string; subtitle: string; ts: number }[]>([]);
  const [needsAttention, setNeedsAttention] = useState<{ id: string; task: string; subtitle: string; ts: number }[]>([]);

  if (variant === "v3") {
    const ipCount = inProgress.length;
    const naCount = needsAttention.length;
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.26 }}
        className="relative rounded-lg border border-border p-3">
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>
        <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-2"><ArrowRightLeft className="w-3.5 h-3.5" /> Handoff</div>
        <div className="text-[10px] text-text-muted">
          {ipCount} in progress · {naCount} need attention
        </div>
      </motion.div>
    );
  }

  const isCompact = variant === "v2";

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.26 }}
      className="relative rounded-lg border border-border p-3 space-y-2">
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5"><ArrowRightLeft className="w-3.5 h-3.5" /> Handoff</div>
      {isCompact ? (
        <div className="space-y-1.5">
          <HandoffAddableSection icon={Play} label="In Progress" color="#38D39F" items={inProgress} presets={HANDOFF_IP_PRESETS}
            onAdd={(p) => setInProgress((prev) => [...prev, { ...p, id: `ip-${Date.now()}`, ts: Date.now() }])}
            onRemove={(id) => setInProgress((prev) => prev.filter((i) => i.id !== id))} />
          <HandoffAddableSection icon={AlertTriangle} label="Needs Attention" color="#f0c56c" items={needsAttention} presets={HANDOFF_NA_PRESETS}
            onAdd={(p) => setNeedsAttention((prev) => [...prev, { ...p, id: `na-${Date.now()}`, ts: Date.now() }])}
            onRemove={(id) => setNeedsAttention((prev) => prev.filter((i) => i.id !== id))} />
        </div>
      ) : (
        <div className="space-y-2">
          <HandoffAddableSection icon={Play} label="In Progress" color="#38D39F" items={inProgress} presets={HANDOFF_IP_PRESETS}
            onAdd={(p) => setInProgress((prev) => [...prev, { ...p, id: `ip-${Date.now()}`, ts: Date.now() }])}
            onRemove={(id) => setInProgress((prev) => prev.filter((i) => i.id !== id))} />
          <HandoffAddableSection icon={AlertTriangle} label="Needs Attention" color="#f0c56c" items={needsAttention} presets={HANDOFF_NA_PRESETS}
            onAdd={(p) => setNeedsAttention((prev) => [...prev, { ...p, id: `na-${Date.now()}`, ts: Date.now() }])}
            onRemove={(id) => setNeedsAttention((prev) => prev.filter((i) => i.id !== id))} />
        </div>
      )}
    </motion.div>
  );
}
