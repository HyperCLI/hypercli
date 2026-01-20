import React from 'react';

interface AmountDisplayProps {
  amountUsd: string;
  className?: string;
  showSign?: boolean;
}

export default function AmountDisplay({ amountUsd, className = '' }: AmountDisplayProps) {
  const amount = parseFloat(amountUsd);
  const isPositive = amount >= 0;
  // Theme-aware colors: green for credits, foreground for charges
  const colorClass = isPositive ? 'text-primary' : 'text-foreground';
  const absAmount = amountUsd.replace('-', '');

  return (
    <span className={`${colorClass} ${className}`}>
      {isPositive ? '+' : '-'}${absAmount}
    </span>
  );
}
