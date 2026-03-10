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
    return <Check className="w-5 h-5 text-primary" />
  }
  if (value.toLowerCase() === "no") {
    return <X className="w-5 h-5 text-red-400" />
  }
  return (
    <span className={isLastColumn ? "text-white" : "text-muted-foreground"}>
      {value}
    </span>
  )
}

export function ComparisonTable({
  headline,
  columns,
  rows,
}: ComparisonTableProps) {
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

        <motion.div
          className="overflow-x-auto"
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
                  <td className="py-4 pr-6 text-white font-medium">
                    {row.capability}
                  </td>
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
