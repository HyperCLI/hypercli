import React from 'react';

interface AmountDisplayProps {
  amountUsd: string;
  className?: string;
  showSign?: boolean;
}

export default function AmountDisplay({ amountUsd, className = '' }: AmountDisplayProps) {
  const amount = parseFloat(amountUsd);
  const isPositive = amount >= 0;
  // Dark theme colors: green for credits, white for charges
  const colorClass = isPositive ? 'text-[#38D39F]' : 'text-white';
  const absAmount = amountUsd.replace('-', '');

  return (
    <span className={`${colorClass} ${className}`}>
      {isPositive ? '+' : '-'}${absAmount}
    </span>
  );
}
