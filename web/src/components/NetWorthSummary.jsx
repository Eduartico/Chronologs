import { useEffect, useMemo, useState } from 'react';

import Icon from './Icon.jsx';
import Switch from './ui/Switch.jsx';
import { api, errText } from '../lib/api.js';
import { componentLabel, readNetWorth } from '../lib/netWorth.js';
import { money, nativeOf, baseCurrency } from '../lib/money.js';
import { useT } from '../i18n/index.js';

/**
 * One figure for "how much do I have", and the parts it is made of.
 *
 * The parts are not decoration. A single number that silently includes a Steam
 * inventory is a number the reader cannot check, and one that silently excludes
 * an index fund is the number they complained about. Each component states what
 * it is, what it is worth, and whether it is being counted — and the switch that
 * decides is here, next to the figure it changes, rather than three screens away
 * in Settings.
 *
 * Vaults are deliberately absent: a vault is a subdivision of an account, so the
 * account's own printed balance already contains it. Listing it beside the
 * account would count the same euro twice.
 */
export default function NetWorthSummary() {
  const { t } = useT();
  const [payload, setPayload] = useState(null);
  const [saving, setSaving] = useState(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState(null);

  const load = () =>
    api
      .getNetWorth()
      .then(setPayload)
      .catch(() => setFailed(true));

  useEffect(() => {
    load();
  }, []);

  const { components, total, unconvertible } = useMemo(() => readNetWorth(payload), [payload]);

  async function toggle(id, included) {
    setSaving(id);
    try {
      const settings = await api.getSettings();
      await api.saveSettings({
        netWorth: { ...settings.netWorth, include: { ...settings.netWorth?.include, [id]: included } },
      });
      await load();
    } catch (err) {
      // A switch that silently does nothing is worse than one that says it
      // failed, and an uncaught rejection here would do exactly that.
      setError(errText(err));
    } finally {
      setSaving(null);
    }
  }

  if (failed || !components.length) return null;

  return (
    <div className="card networth">
      <div className="section-title">
        <Icon name="wallet" size={17} />
        {t('networth.title')}
      </div>
      <div className="stat">
        <div className="stat-value">{money(total, { from: baseCurrency() })}</div>
        <div className="stat-label">{t('networth.desc')}</div>
        {/* A total that is missing a holding says which one and why, rather than
            quietly being smaller than the truth. */}
        {unconvertible.length > 0 && (
          <div className="networth-note">
            {t('networth.unconverted', {
              names: unconvertible.map((c) => componentLabel(c.id, t)).join(', '),
            })}
          </div>
        )}
      </div>
      {error && <div className="networth-note is-bad">{error}</div>}
      <div className="networth-parts">
        {components.map((component) => (
          <div key={component.id} className={`networth-part${component.included ? '' : ' is-out'}`}>
            <div>
              <div className="networth-part-name">{componentLabel(component.id, t)}</div>
              <div className="networth-part-meta">
                {/* "Count: 3" rather than a sentence with a plural in it — one
                    string, fourteen languages, and no plural rule to get wrong
                    for a number that is usually one. */}
                {`${t('common.count')}: ${component.count}`}

              </div>
            </div>
            {/* The rate used, on hover, where the holding is not already in the
                display currency — `nativeOf` is how every other converted amount
                in the app says so, and it is the only thing that knows the rate.
                `money(value, {from})` would have converted a second time and
                printed the same figure twice. */}
            {/* No rate, no conversion: the amount is shown in the currency it is
                actually held in rather than in a euro figure it is not. */}
            <div className="networth-part-value" title={nativeOf(component.value, component.currency)}>
              {component.convertible
                ? money(component.converted, { from: baseCurrency() })
                : money(component.value, { from: component.currency })}
            </div>
            <Switch
              checked={component.included}
              disabled={saving === component.id}
              onChange={(included) => toggle(component.id, included)}
              label={t('networth.counted')}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
