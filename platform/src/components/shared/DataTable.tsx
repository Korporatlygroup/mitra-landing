import type { ReactNode } from 'react';

export interface Column {
  key: string;
  label: string;
  /** Right-align numbers. */
  num?: boolean;
}

/**
 * A responsive table. On wide screens it is a normal table; on phones each row becomes a stacked card whose cells show their column label
 * (data-label), so nothing scrolls sideways. Pass already-translated labels and rendered cells.
 */
export default function DataTable({ caption, columns, rows }: { caption: string; columns: Column[]; rows: { id: string; cells: Record<string, ReactNode>; highlight?: boolean }[] }) {
  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <caption className="sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.num ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.highlight ? 'hl' : undefined}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.num ? 'num' : undefined}>
                  {r.cells[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
