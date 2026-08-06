import IconButton from './ui/IconButton.jsx';

/**
 * Nested rule conditions — "(A ou B) e não C", the way Outlook's own rule
 * builder reads.
 *
 * The flat shape the rest of the page still uses (`conditions.text` OR'd
 * together, everything else AND'd) cannot say that. It is still what every
 * learned rule is written in — one pattern, one category, no need for more —
 * and `ruleMatches` in rules.js keeps evaluating it exactly as before. This is
 * only reached when a rule opts into `conditions.tree`, a fully recursive
 * group: `{ op: 'all'|'any'|'not', children: [...] }`, where a child is either
 * another group or a leaf `{ field, op, value }`.
 *
 * The tree is edited in place, the same philosophy as everywhere else on the
 * site: no separate builder screen, just nested rows that grow and shrink as
 * you add and remove pieces.
 */
export const FIELD_OPTIONS = [
  { value: 'any', label: 'texto (descrição ou comerciante)' },
  { value: 'description', label: 'descrição' },
  { value: 'merchant', label: 'comerciante' },
  { value: 'amount', label: 'montante' },
  { value: 'date', label: 'data' },
  { value: 'direction', label: 'débito / crédito' },
  { value: 'source', label: 'origem' },
];

const OPS_BY_FIELD = {
  any: [{ value: 'contains', label: 'contém' }, { value: 'equals', label: 'é exactamente' }, { value: 'regex', label: 'expressão regular' }],
  description: [{ value: 'contains', label: 'contém' }, { value: 'equals', label: 'é exactamente' }, { value: 'regex', label: 'expressão regular' }],
  merchant: [{ value: 'contains', label: 'contém' }, { value: 'equals', label: 'é exactamente' }, { value: 'regex', label: 'expressão regular' }],
  amount: [{ value: 'gt', label: 'maior que' }, { value: 'lt', label: 'menor que' }, { value: 'between', label: 'entre' }],
  date: [{ value: 'after', label: 'depois de' }, { value: 'before', label: 'antes de' }, { value: 'between', label: 'entre' }],
  direction: [{ value: 'equals', label: 'é' }],
  source: [{ value: 'equals', label: 'é' }],
};

export function emptyLeaf() {
  return { field: 'any', op: 'contains', value: '' };
}

export function emptyGroup(op = 'all') {
  return { op, children: [emptyLeaf()] };
}

const GROUP_LABEL = { all: 'E', any: 'OU', not: 'NÃO' };

/** True for a group node, false for a leaf — a group is the only one with `children`. */
function isGroup(node) {
  return node && Array.isArray(node.children);
}

function LeafRow({ leaf, onChange, onRemove }) {
  const ops = OPS_BY_FIELD[leaf.field] || OPS_BY_FIELD.any;
  const isBetween = leaf.op === 'between';

  return (
    <div className="cond-row">
      <select
        value={leaf.field}
        onChange={(e) => {
          const field = e.target.value;
          const validOps = (OPS_BY_FIELD[field] || OPS_BY_FIELD.any).map((o) => o.value);
          onChange({
            ...leaf,
            field,
            op: validOps.includes(leaf.op) ? leaf.op : validOps[0],
            value: field === 'direction' ? 'debit' : field === 'source' ? 'activobank' : '',
          });
        }}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <select value={leaf.op} onChange={(e) => onChange({ ...leaf, op: e.target.value })}>
        {ops.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {leaf.field === 'direction' ? (
        <select value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
          <option value="debit">débito</option>
          <option value="credit">crédito</option>
        </select>
      ) : leaf.field === 'source' ? (
        <select value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
          <option value="activobank">activobank</option>
          <option value="pricempire">pricempire</option>
          <option value="manual">manual</option>
        </select>
      ) : isBetween ? (
        <span className="cond-between">
          <input
            type={leaf.field === 'date' ? 'date' : 'number'}
            value={leaf.value?.min ?? leaf.value?.from ?? ''}
            onChange={(e) =>
              onChange({
                ...leaf,
                value:
                  leaf.field === 'date'
                    ? { ...leaf.value, from: e.target.value }
                    : { ...leaf.value, min: e.target.value },
              })
            }
            style={{ width: leaf.field === 'date' ? 130 : 80 }}
          />
          <span className="muted">e</span>
          <input
            type={leaf.field === 'date' ? 'date' : 'number'}
            value={leaf.value?.max ?? leaf.value?.to ?? ''}
            onChange={(e) =>
              onChange({
                ...leaf,
                value:
                  leaf.field === 'date'
                    ? { ...leaf.value, to: e.target.value }
                    : { ...leaf.value, max: e.target.value },
              })
            }
            style={{ width: leaf.field === 'date' ? 130 : 80 }}
          />
        </span>
      ) : (
        <input
          type={leaf.field === 'amount' ? 'number' : leaf.field === 'date' ? 'date' : 'text'}
          value={leaf.value ?? ''}
          placeholder={leaf.field === 'any' || leaf.field === 'description' || leaf.field === 'merchant' ? 'texto…' : ''}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          style={{ minWidth: 100 }}
        />
      )}
      <IconButton icon="close" label="Remover condição" onClick={onRemove} />
    </div>
  );
}

function Group({ node, onChange, onRemove, depth }) {
  const setOp = (op) => onChange({ ...node, op });

  const updateChild = (i, next) => {
    const children = [...node.children];
    children[i] = next;
    onChange({ ...node, children });
  };
  const removeChild = (i) => {
    const children = node.children.filter((_, idx) => idx !== i);
    onChange({ ...node, children: children.length ? children : [emptyLeaf()] });
  };
  const addLeaf = () => onChange({ ...node, children: [...node.children, emptyLeaf()] });
  const addGroup = () => onChange({ ...node, children: [...node.children, emptyGroup('all')] });

  return (
    <div className={`cond-group ${depth === 0 ? 'cond-group-root' : ''}`}>
      <div className="cond-group-head">
        <div className="seg-toggle" role="group" aria-label="Operador do grupo">
          {['all', 'any', 'not'].map((op) => (
            <button
              key={op}
              type="button"
              className={`seg-btn ${node.op === op ? 'is-on' : ''}`}
              onClick={() => setOp(op)}
              title={op === 'all' ? 'Todas as condições (E)' : op === 'any' ? 'Alguma condição (OU)' : 'Nenhuma condição (NÃO)'}
            >
              {GROUP_LABEL[op]}
            </button>
          ))}
        </div>
        {depth > 0 && <IconButton icon="close" label="Remover grupo" onClick={onRemove} />}
      </div>

      <div className="cond-group-children">
        {node.children.map((child, i) =>
          isGroup(child) ? (
            <Group
              key={i}
              node={child}
              depth={depth + 1}
              onChange={(next) => updateChild(i, next)}
              onRemove={() => removeChild(i)}
            />
          ) : (
            <LeafRow
              key={i}
              leaf={child}
              onChange={(next) => updateChild(i, next)}
              onRemove={() => removeChild(i)}
            />
          )
        )}
      </div>

      <div className="cond-group-add">
        <button type="button" className="btn-ghost btn-sm" onClick={addLeaf}>+ condição</button>
        <button type="button" className="btn-ghost btn-sm" onClick={addGroup}>+ grupo</button>
      </div>
    </div>
  );
}

export default function RuleConditionTree({ tree, onChange }) {
  return <Group node={tree} depth={0} onChange={onChange} onRemove={() => {}} />;
}

/**
 * Drops the empty scaffolding — a leaf nobody filled in, a group left with
 * nothing inside it — the same way the flat form already filters out blank
 * `text` entries before a rule is saved. Returns `null` when nothing is left,
 * which tells the caller to omit `tree` from the saved rule entirely rather
 * than save a group that would match everything by accident.
 */
export function pruneTree(node) {
  if (!node) return null;
  if (!isGroup(node)) {
    if (node.field === 'direction' || node.field === 'source') return node; // always has a value
    if (node.value && typeof node.value === 'object') {
      const filled = node.value.min !== '' || node.value.max !== '' || node.value.from || node.value.to;
      return filled ? node : null;
    }
    return String(node.value ?? '').trim() ? node : null;
  }
  const children = node.children.map(pruneTree).filter(Boolean);
  if (children.length === 0) return null;
  return { ...node, children };
}

/** A tree, read back as one line — the same job `describeConditions` does for the flat shape. */
export function describeTree(node) {
  if (!node) return '';
  if (isGroup(node)) {
    const joiner = node.op === 'any' ? ' OU ' : ' E ';
    const inner = node.children.map(describeTree).filter(Boolean).join(joiner);
    if (node.op === 'not') return `NÃO (${inner})`;
    return node.children.length > 1 ? `(${inner})` : inner;
  }
  const fieldLabel = FIELD_OPTIONS.find((f) => f.value === node.field)?.label || node.field;
  const value =
    node.value && typeof node.value === 'object'
      ? `${node.value.min ?? node.value.from ?? ''}–${node.value.max ?? node.value.to ?? ''}`
      : node.value;
  return `${fieldLabel} ${node.op} "${value}"`;
}
