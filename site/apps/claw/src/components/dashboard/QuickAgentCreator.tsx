"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Brain, Cat, Crown, Dog, Eye, Flame, Globe, Heart, Leaf,
  Moon, Rocket, Shield, Sparkles, Star, Zap,
  X, Cpu, MemoryStick,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@hypercli/shared-ui";

// ── Types ──

export interface QuickAgentCreatorProps {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, iconIndex: number, size: string) => void;
}

// ── Constants ──

const ICONS: { icon: LucideIcon; name: string }[] = [
  { icon: Bot, name: "Bot" },
  { icon: Brain, name: "Brain" },
  { icon: Cat, name: "Cat" },
  { icon: Crown, name: "Crown" },
  { icon: Dog, name: "Dog" },
  { icon: Eye, name: "Eye" },
  { icon: Flame, name: "Flame" },
  { icon: Globe, name: "Globe" },
  { icon: Heart, name: "Heart" },
  { icon: Leaf, name: "Leaf" },
  { icon: Moon, name: "Moon" },
  { icon: Rocket, name: "Rocket" },
  { icon: Shield, name: "Shield" },
  { icon: Sparkles, name: "Sparkles" },
  { icon: Star, name: "Star" },
  { icon: Zap, name: "Zap" },
];

const HUES = [157, 180, 210, 240, 260, 280, 310, 340, 10, 30, 50, 70, 90, 120, 140, 200];

const SIZES: { id: string; label: string; cpu: number; memory: number }[] = [
  { id: "small", label: "S", cpu: 1, memory: 1 },
  { id: "medium", label: "M", cpu: 2, memory: 2 },
  { id: "large", label: "L", cpu: 4, memory: 4 },
];

// ── Component ──

export function QuickAgentCreator({ open, onClose, onCreated }: QuickAgentCreatorProps) {
  const [name, setName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState(0);
  const [selectedSize, setSelectedSize] = useState("large");

  const hue = HUES[selectedIcon];
  const SelectedIcon = ICONS[selectedIcon].icon;

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreated(name.trim(), selectedIcon, selectedSize);
    setName("");
    setSelectedIcon(0);
    setSelectedSize("large");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden border-b border-border"
        >
          <div className="px-3 py-3 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
                New Agent
              </span>
              <button
                onClick={onClose}
                className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Avatar preview + name input */}
            <div className="flex items-center gap-2.5">
              <motion.div
                key={selectedIcon}
                initial={{ scale: 0.8, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `hsl(${hue} 60% 20%)` }}
              >
                <SelectedIcon
                  className="w-[18px] h-[18px]"
                  style={{ color: `hsl(${hue} 70% 70%)` }}
                />
              </motion.div>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name..."
                className="flex-1 min-w-0 bg-surface-low border border-border rounded-lg px-2.5 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-[#38D39F]/40"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") onClose();
                }}
              />
            </div>

            {/* Icon picker */}
            <div>
              <p className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Icon</p>
              <div className="flex flex-wrap gap-1">
                {ICONS.map((item, idx) => {
                  const IconComp = item.icon;
                  const h = HUES[idx];
                  const active = idx === selectedIcon;
                  return (
                    <Tooltip key={item.name} delayDuration={400}>
                      <TooltipTrigger asChild>
                        <motion.button
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => setSelectedIcon(idx)}
                          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
                            active
                              ? "ring-1 ring-offset-1 ring-offset-background"
                              : "hover:bg-surface-low"
                          }`}
                          style={
                            active
                              ? {
                                  backgroundColor: `hsl(${h} 60% 20%)`,
                                  // @ts-expect-error -- CSS custom property for ring
                                  "--tw-ring-color": `hsl(${h} 70% 70%)`,
                                }
                              : undefined
                          }
                        >
                          <IconComp
                            className="w-3 h-3"
                            style={active ? { color: `hsl(${h} 70% 70%)` } : undefined}
                          />
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px]">
                        {item.name}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* Size selector */}
            <div>
              <p className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Size</p>
              <div className="flex gap-1.5">
                {SIZES.map((size) => {
                  const active = size.id === selectedSize;
                  return (
                    <motion.button
                      key={size.id}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => setSelectedSize(size.id)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border text-[10px] font-medium transition-all capitalize ${
                        active
                          ? "bg-[#38D39F]/10 border-[#38D39F]/30 text-[#38D39F]"
                          : "border-border text-text-muted hover:text-foreground hover:border-border-strong"
                      }`}
                    >
                      <span className="text-[11px] font-semibold">{size.id}</span>
                      <div className="flex items-center gap-2 text-[8px] opacity-70">
                        <span className="flex items-center gap-0.5"><Cpu className="w-2.5 h-2.5" />{size.cpu}</span>
                        <span className="flex items-center gap-0.5"><MemoryStick className="w-2.5 h-2.5" />{size.memory}G</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Create button */}
            <motion.button
              whileHover={name.trim() ? { scale: 1.02 } : undefined}
              whileTap={name.trim() ? { scale: 0.97 } : undefined}
              disabled={!name.trim()}
              onClick={handleCreate}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#38D39F]/15 text-[#38D39F] border border-[#38D39F]/20 hover:border-[#38D39F]/40"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Create & Start</span>
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
