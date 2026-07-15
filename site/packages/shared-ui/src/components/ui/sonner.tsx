"use client";

import { useSyncExternalStore } from "react";
import { toast, Toaster as Sonner, ToasterProps } from "sonner";
import { subscribeToThemeChanges } from "../../utils/theme";

function subscribeToProductTheme(onStoreChange: () => void) {
  const unsubscribe = subscribeToThemeChanges(() => onStoreChange());
  const observer = typeof MutationObserver === "undefined"
    ? null
    : new MutationObserver(onStoreChange);
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    observer?.disconnect();
    unsubscribe();
  };
}

function getProductThemeSnapshot() {
  if (typeof document === "undefined") return "default";
  return document.documentElement.getAttribute("data-theme") ?? "default";
}

const Toaster = ({ theme: themeOverride, ...props }: ToasterProps) => {
  const productTheme = useSyncExternalStore(subscribeToProductTheme, getProductThemeSnapshot, () => "default");
  const theme = themeOverride ?? (productTheme === "light" ? "light" : "dark");

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
