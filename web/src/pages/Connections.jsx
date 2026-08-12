/**
 * Every configured connection, one card each.
 *
 * This page used to be two hand-written components, one per provider, which is
 * why adding a bank meant editing it. It is now a loop: the server says which
 * instances exist, a module that ships `ui.jsx` draws its own card, and anything
 * else is rendered from its description by `ModuleCard`.
 *
 * ActivoBank and Pricempire ship their cards, moved here unchanged, so the page
 * looks exactly as it did.
 */
import { useState, useEffect } from 'react';
import { useT } from '../i18n/index.js';
import { fetchModules, cardFor, manifestFor } from '../modules/registry.js';
import ModuleCard from '../components/ModuleCard.jsx';

export default function Connections() {
  const { t } = useT();
  const [registry, setRegistry] = useState(null);

  useEffect(() => {
    fetchModules().then(setRegistry);
  }, []);

  if (!registry) {
    return (
      <div>
        <div className="page-header">
          <h2>{t('nav.connections')}</h2>
        </div>
        <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      </div>
    );
  }

  // Only sources appear here. The engines — the rules pass, correlations, quote
  // refreshes — have nothing to connect to; they are scheduled from Settings.
  const sources = registry.instances.filter((i) => i.kind === 'source' || i.missing);

  return (
    <div>
      <div className="page-header">
        <h2>{t('nav.connections')}</h2>
      </div>

      {registry.problems.length > 0 && (
        // A module that failed to load is invisible everywhere else, and its
        // data is still in the ledger. Silence here is the worst possible
        // answer to "where did my bank go".
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--bad)' }}>
          <h3>{t('modules.problemsTitle')}</h3>
          <ul style={{ margin: '8px 0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
            {registry.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
        {sources.map((instance) => {
          const Custom = cardFor(instance.module);
          return Custom ? (
            <Custom key={instance.id} instance={instance} />
          ) : (
            <ModuleCard
              key={instance.id}
              instance={instance}
              manifest={manifestFor(instance, registry.modules)}
            />
          );
        })}

        {sources.length === 0 && (
          <div className="card">
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('modules.none')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
