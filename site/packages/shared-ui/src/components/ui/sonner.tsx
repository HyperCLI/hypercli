"use client";

import { toast, Toaster as Sonner, ToasterProps } from "sonner";
import { useTheme } from "../ThemeProvider";

const Toaster = ({ theme: themeOverride, ...props }: ToasterProps) => {
  const { theme: productTheme } = useTheme();
  const theme = themeOverride ?? productTheme;

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--popover-foreground)",
          "--success-border": "color-mix(in srgb, var(--success) 30%, transparent)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--popover-foreground)",
          "--error-border": "color-mix(in srgb, var(--error) 30%, transparent)",
          "--warning-bg": "var(--popover)",
          "--warning-text": "var(--popover-foreground)",
          "--warning-border": "color-mix(in srgb, var(--warning) 30%, transparent)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster, toast };
