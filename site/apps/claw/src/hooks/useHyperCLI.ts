import { useContext } from "react";
import { HyperCLIContext, type HyperCLIContextValue } from "@/providers/HyperCLIContext";

export function useHyperCLI(): HyperCLIContextValue {
  const ctx = useContext(HyperCLIContext);
  if (!ctx) {
    throw new Error("useHyperCLI must be used within a HyperCLIProvider");
  }
  return ctx;
}
