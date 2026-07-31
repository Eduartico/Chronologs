export default function TagChips({ tagIds = [], tags = [], onRemove = null, size = 'sm' }) {
  const byId = new Map(tags.map((t) => [t.id, t]));
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {tagIds.map((id) => {
        const tag = byId.get(id);
        if (!tag) return null;
        return (
          <span
            key={id}
            style={{
              background: tag.color,
              color: '#0d1117',
              borderRadius: 10,
              padding: size === 'sm' ? '1px 8px' : '3px 10px',
              fontSize: size === 'sm' ? 11 : 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {tag.name}
            {onRemove && (
              <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => onRemove(id)}>
                ×
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
