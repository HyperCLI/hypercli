"use client";

import { Box } from "lucide-react";

interface ThreeDPanelProps {
  onClose: () => void;
}

export function ThreeDPanel({ onClose }: ThreeDPanelProps) {
  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
        <Box className="w-6 h-6 text-[var(--primary)]" />
      </div>

      <p className="text-sm text-text-secondary">
        Your agent can generate 3D models from images using Hunyuan3D via ComfyUI templates.
        Available via SDK &mdash; nothing to set up.
      </p>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">What it can do</h4>
        <ul className="space-y-1.5 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Generate 3D models from a single image (Hunyuan3D 2.1)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Multi-view to 3D model generation
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Turbo mode for faster generation
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Available templates</h4>
        <div className="flex flex-wrap gap-1.5">
          {["3d_hunyuan3d-v2.1", "3d_hunyuan3d_multiview_to_model", "3d_hunyuan3d_multiview_to_model_turbo"].map((tpl) => (
            <span
              key={tpl}
              className="px-2 py-1 bg-[var(--surface-low)] text-text-secondary rounded text-xs font-mono"
            >
              {tpl}
            </span>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 text-xs text-text-tertiary">
        <p>
          Try it: use the SDK&apos;s{" "}
          <span className="text-text-secondary font-mono">renders.create()</span>{" "}
          with a template ID, or ask your agent to generate a 3D model from an image
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Got it
        </button>
      </div>
    </div>
  );
}
