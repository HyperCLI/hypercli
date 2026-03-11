"use client"

import { motion } from "framer-motion"
import { Check, X } from "lucide-react"

type ComparisonTableProps = {
  headline: string
  columns: string[]
  rows: Array<{
    capability: string
    values: string[]
  }>
}

function CellValue({ value, isLastColumn }: { value: string; isLastColumn: boolean }) {
  if (value.toLowerCase() === "yes") {
    return (
      <span role="img" aria-label="Yes" className="inline-flex items-center">
        <Check aria-hidden="true" className="w-5 h-5 text-primary" />
      </span>
    )
  }
  if (value.toLowerCase() === "no") {
    return (
      <span role="img" aria-label="No" className="inline-flex items-center">
        <X aria-hidden="true" className="w-5 h-5 text-red-400" />
      </span>
    )
  }
  return (
    <span className={isLastColumn ? "text-white" : "text-muted-foreground"}>
      {value}
    </span>
  )
}

function ColumnValue({
  label,
  value,
  isFeatured,
}: {
  label: string
  value: string
  isFeatured: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        isFeatured
          ? "border-primary/30 bg-primary/5"
          : "border-border-medium/30 bg-surface-low"
      }`}
    >
      <p
        className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${
          isFeatured ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {label}
      </p>
      <div className="text-sm leading-relaxed">
        <CellValue value={value} isLastColumn={isFeatured} />
      </div>
    </div>
  )
}

export function ComparisonTable({
  headline,
  columns,
  rows,
}: ComparisonTableProps) {
  const comparisonColumns = columns.slice(1)

  return (
    <section className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 border-t border-border-medium/30">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-4xl sm:text-5xl text-white font-bold tracking-tight mb-12">
            {headline}
          </h2>
        </motion.div>

        <div className="space-y-4 md:hidden">
          {rows.map((row, rowIndex) => (
            <motion.section
              key={row.capability}
              className="rounded-2xl border border-border-medium/30 bg-black/20 p-5"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: rowIndex * 0.04 }}
            >
              <h3 className="mb-4 text-base font-semibold text-white">
                {row.capability}
              </h3>
              <div className="space-y-3">
                {comparisonColumns.map((column, colIndex) => (
                  <ColumnValue
                    key={`${row.capability}-${column}`}
                    label={column}
                    value={row.values[colIndex]}
                    isFeatured={colIndex === comparisonColumns.length - 1}
                  />
                ))}
              </div>
            </motion.section>
          ))}
        </div>

        <motion.div
          className="overflow-x-auto max-md:hidden"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-medium/30">
                {columns.map((col, i) => (
                  <th
                    key={col}
                    scope="col"
                    className={`pb-4 pr-6 text-sm font-semibold uppercase tracking-wider ${
                      i === columns.length - 1
                        ? "text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <motion.tr
                  key={row.capability}
                  className="border-b border-border-medium/20"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: rowIndex * 0.05 }}
                >
                  <th scope="row" className="py-4 pr-6 text-white font-medium">
                    {row.capability}
                  </th>
                  {row.values.map((value, colIndex) => (
                    <td key={colIndex} className="py-4 pr-6">
                      <CellValue
                        value={value}
                        isLastColumn={colIndex === row.values.length - 1}
                      />
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  )
}
