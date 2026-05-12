"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

interface SlotProvisioningStatusProps {
  status: string;
  detail?: string;
}

export function SlotProvisioningStatus({ status, detail = "Finalizing launch access" }: SlotProvisioningStatusProps) {
  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="relative mt-2 overflow-hidden rounded-[12px] border border-amber-300/18 bg-amber-300/[0.07] px-3 py-3 text-amber-50"
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-100/25 to-transparent"
        animate={{ opacity: [0.25, 0.55, 0.25] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative flex items-center gap-3">
        <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-amber-200/15 bg-black/20 text-amber-100/90">
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-amber-200/10"
            animate={{ opacity: [0.18, 0.34, 0.18] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <Loader2 className="relative h-4 w-4 animate-spin" />
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold leading-tight text-amber-50">{status}</span>
          <span className="mt-1 block text-[11px] font-medium leading-tight text-amber-100/70">{detail}</span>
        </span>
      </div>
      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-black/30">
        <motion.span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-full rounded-full bg-amber-100/25"
          animate={{ opacity: [0.28, 0.58, 0.28] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    </motion.div>
  );
}
