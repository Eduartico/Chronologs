import Icon from '../Icon.jsx';

/**
 * A column header that sorts.
 *
 * One click sorts ascending, a second reverses it. The arrow only shows on the
 * column actually in charge; on the others it appears faintly on hover, which
 * is how the table says "these are clickable too" without printing arrows all
 * the way across the top.
 */
export default function SortHeader({ column, sort, onToggle, children, style }) {
  const sortable = typeof column.get === 'function' && column.sortable !== false;
  const active = sortable && sort?.key === column.key;
  const label = children ?? column.label;
  // With `table-layout: fixed` the header cell is where a column's width is
  // declared, which is what keeps a cell's contents from resizing it.
  const sized = column.width ? { width: column.width, ...style } : style;

  if (!sortable) {
    return (
      <th className={column.align === 'right' ? 'num' : undefined} style={sized}>
        {label}
      </th>
    );
  }

  return (
    <th
      className={`sortable ${column.align === 'right' ? 'num' : ''} ${active ? 'is-sorted' : ''}`.trim()}
      style={sized}
      onClick={() => onToggle(column.key)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Ordenar por ${typeof label === 'string' ? label.toLowerCase() : column.key}`}
    >
      <span className="th-inner">
        {label}
        <Icon
          className="sort-arrow"
          name={active && sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'}
          size={12}
        />
      </span>
    </th>
  );
}
