import React, { useState } from 'react'

export interface Column<T> {
  key: keyof T & string
  header: string
  width?: string
  /** Optional render function for custom cell content */
  render?: (value: T[keyof T], row: T, rowIndex: number) => React.ReactNode
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  data: T[]
  onRowClick?: (row: T, index: number) => void
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
}: DataTableProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const handleRowClick = (row: T, index: number) => {
    setSelectedIndex(index === selectedIndex ? null : index)
    onRowClick?.(row, index)
  }

  const handleRowKeyDown = (e: React.KeyboardEvent, row: T, index: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleRowClick(row, index)
    }
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-primaryDark">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className="px-4 py-3 text-left text-white font-semibold text-xs uppercase tracking-wider first:rounded-tl-xl last:rounded-tr-xl"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-textMuted text-sm bg-surface"
              >
                No data to display
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => {
              const isSelected = selectedIndex === rowIndex
              const isEven = rowIndex % 2 === 0

              return (
                <tr
                  key={rowIndex}
                  onClick={() => handleRowClick(row, rowIndex)}
                  onKeyDown={(e) => handleRowKeyDown(e, row, rowIndex)}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'row' : undefined}
                  aria-selected={onRowClick ? isSelected : undefined}
                  className={[
                    'transition-colors duration-100 outline-none',
                    isSelected
                      ? 'bg-primary/15 border-l-2 border-l-primary'
                      : isEven
                      ? 'bg-surface'
                      : 'bg-card',
                    onRowClick
                      ? 'hover:bg-hover cursor-pointer focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-4 py-3 text-textSecondary border-b border-border/40"
                    >
                      {col.render
                        ? col.render(row[col.key], row, rowIndex)
                        : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
