"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sparkles,
  Globe,
  MessageSquare,
  Wrench,
  Palette,
  ArrowLeft,
} from "lucide-react";
import {
  type DirectoryCategory,
  DIRECTORY_CATEGORIES,
  getPluginsForCategory,
} from "./directory/directory-utils";
import { DirectoryGrid } from "./directory/DirectoryGrid";
import { DirectoryDetail } from "./directory/DirectoryDetail";
import { IntelligencePanel } from "./directory/IntelligencePanel";

// ── Category icon map ──

const CATEGORY_ICONS: Record<DirectoryCategory, React.ElementType> = {
  intelligence: Sparkles,
  web: Globe,
  channels: MessageSquare,
  tools: Wrench,
  media: Palette,
};

// ── Props ──

export interface DirectoryModalProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: DirectoryCategory;
  initialItemId?: string;
  config: Record<string, unknown> | null;
  channelsStatus: Record<string, unknown> | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, unknown>>;
  onOpenShell: () => void;
}

// ── Component ──

export function DirectoryModal({
  open,
  onClose,
  initialCategory,
  initialItemId,
  config,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
}: DirectoryModalProps) {
  const [activeCategory, setActiveCategory] = useState<DirectoryCategory>(initialCategory ?? "web");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);

  useEffect(() => {
    if (open) {
      if (initialCategory) setActiveCategory(initialCategory);
      setSelectedItemId(initialItemId ?? null);
    }
  }, [open, initialCategory, initialItemId]);

  const plugins = useMemo(() => getPluginsForCategory(activeCategory), [activeCategory]);

  const handleCategoryChange = useCallback((cat: DirectoryCategory) => {
    setActiveCategory(cat);
    setSelectedItemId(null);
  }, []);

  const handleBackToGrid = useCallback(() => {
    setSelectedItemId(null);
  }, []);

  const handleCloseModal = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleCloseModal]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60"
            onClick={handleCloseModal}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-4 sm:inset-8 lg:inset-12 z-50 flex rounded-2xl border border-border bg-[#111113] shadow-2xl overflow-hidden"
          >
            {/* Left Nav */}
            <nav className="w-[200px] shrink-0 border-r border-border bg-[#0c0c0e] flex flex-col">
              <div className="px-4 py-4 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">Directory</h2>
              </div>
              <div className="flex-1 py-2 px-2 space-y-0.5">
                {DIRECTORY_CATEGORIES.map((cat) => {
                  const Icon = CATEGORY_ICONS[cat.id];
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => handleCategoryChange(cat.id)}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-[#38D39F]/10 text-foreground font-medium border-l-2 border-[#38D39F] -ml-0.5 pl-[10px]"
                          : "text-text-muted hover:text-foreground hover:bg-surface-low/40"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  {selectedItemId && (
                    <button
                      onClick={handleBackToGrid}
                      className="text-text-muted hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {DIRECTORY_CATEGORIES.find((c) => c.id === activeCategory)?.label}
                    </h3>
                    <p className="text-xs text-text-muted">
                      {DIRECTORY_CATEGORIES.find((c) => c.id === activeCategory)?.description}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseModal}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeCategory === "intelligence" ? (
                  <IntelligencePanel
                    config={config}
                    onSaveConfig={onSaveConfig}
                  />
                ) : selectedItemId ? (
                  <DirectoryDetail
                    pluginId={selectedItemId}
                    config={config}
                    connected={connected}
                    onSaveConfig={onSaveConfig}
                    onChannelProbe={onChannelProbe}
                    onOpenShell={onOpenShell}
                    onBack={handleBackToGrid}
                    onCloseModal={handleCloseModal}
                  />
                ) : (
                  <DirectoryGrid
                    plugins={plugins}
                    config={config}
                    onSelectPlugin={setSelectedItemId}
                  />
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
