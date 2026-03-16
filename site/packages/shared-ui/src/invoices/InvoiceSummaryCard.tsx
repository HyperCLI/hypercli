import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

interface InvoiceSummaryCardProps {
  label: string;
  value: string;
  description?: string;
}

export function InvoiceSummaryCard({ label, value, description }: InvoiceSummaryCardProps) {
  return (
    <Card className="border-border bg-surface-low">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl text-foreground">{value}</CardTitle>
      </CardHeader>
      {description ? (
        <CardContent className="pt-0 text-sm text-muted-foreground">{description}</CardContent>
      ) : null}
    </Card>
  );
}
