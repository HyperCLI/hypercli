import { cn } from "../ui/utils";

export interface FAQItem {
  q: string;
  a: string;
}

export interface FAQBlockProps {
  items: FAQItem[];
  className?: string;
}

export function FAQBlock({ items, className }: FAQBlockProps) {
  return (
    <dl className={cn("divide-y divide-border-medium/30", className)}>
      {items.map((item, index) => (
        <div key={index} className="py-7 first:pt-0 last:pb-0">
          <dt className="mb-2.5 text-xl font-semibold text-foreground">{item.q}</dt>
          <dd className="text-lg leading-relaxed text-text-secondary">{item.a}</dd>
        </div>
      ))}
    </dl>
  );
}
