export function formatUsdAmount(value: string | number | null | undefined): string {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return "$0.00";
  }

  return `$${numeric.toFixed(2)}`;
}
