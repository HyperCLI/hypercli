"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface PanelFilesSearchBarProps {
  value: string;
  onChange: (query: string) => void;
  resultCount?: number;
  totalCount?: number;
}

export function PanelFilesSearchBar({ value, onChange, resultCount, totalCount }: PanelFilesSearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLocalValue(value); }, [value]);

  const handleChange = (v: string) => {
    setLocalValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(v), 200);
  };

  const handleClear = () => { setLocalValue(""); onChange(""); inputRef.current?.focus(); };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const hasQuery = localValue.trim().length > 0;

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search files..."
        className="w-full bg-surface-low border border-border rounded-lg pl-8 pr-8 py-1.5 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-[#38D39F]/40 transition-colors"
        onKeyDown={(e) => { if (e.key === "Escape" && hasQuery) { e.preventDefault(); handleClear(); } }}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <AnimatePresence>
          {hasQuery && resultCount !== undefined && totalCount !== undefined && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[9px] text-text-muted tabular-nums">
              {resultCount}/{totalCount}
            </motion.span>
          )}
          {hasQuery && (
            <motion.button initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} onClick={handleClear} className="w-4 h-4 rounded flex items-center justify-center text-text-muted hover:text-foreground transition-colors">
              <X className="w-3 h-3" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return <>{parts.map((part, i) => regex.test(part) ? <span key={i} className="bg-[#38D39F]/20 text-[#38D39F] rounded-sm px-0.5">{part}</span> : <span key={i}>{part}</span>)}</>;
}
