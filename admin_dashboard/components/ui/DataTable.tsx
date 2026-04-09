'use client';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  className?: string;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  searchPlaceholder?: string;
  onRowClick?: (row: any) => void;
}

export default function DataTable({ columns, data, searchPlaceholder, onRowClick }: DataTableProps) {
  return (
    <div className="table-wrap">
      {searchPlaceholder && (
        <div className="table-toolbar">
          <div className="tbl-search">
            <span style={{ color: 'var(--muted)', fontSize: '12px' }}>&#128269;</span>
            <input type="text" placeholder={searchPlaceholder} />
          </div>
        </div>
      )}
      <table>
        <thead>
          <tr>
            {columns.map(col => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} onClick={() => onRowClick?.(row)}>
              {columns.map(col => (
                <td key={col.key} className={col.className || ''}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
