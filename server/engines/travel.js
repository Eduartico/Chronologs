/**
 * Travel detection and travel-aware transaction grouping.
 *
 * ActivoBank prints where a card was used at the end of the descriptor:
 * "COMPRA 0412 BOLT.EU O 2605250811 Tallinn EE". That country code is the only
 * travel signal the data carries, and it is enough — a run of foreign-country
 * purchases inside a short window is a trip.
 *
 * The hard part is not finding foreign transactions, it is ignoring the ones
 * that are foreign every month: Spotify bills from SE, Supercell from FI,
 * GitHub from US. Those are subscriptions, not travel, so a merchant that
 * appears in many different months is excluded before clustering.
 *
 * Trips are proposed, never assumed. A detected trip stays `suggested` until
 * the user confirms it.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { statePath } from '../lib/paths.js';
import { stripAccents, cleanDescription } from '../lib/merchant.js';
import { loadTags, createTag, updateTag, deleteTag } from '../lib/tags.js';
import { emitTagAssignment, emitTagRemoval } from './rules.js';

const TRAVELS_FILE = 'travels.json';

// Where the user lives. Purchases here are never travel.
const HOME_COUNTRY = 'PT';

/* What a trip's spending reads as while the overlay is on. The name of a
   category in the registry, not an id — `rebuild.js` folds names. */
export const TRAVEL_CATEGORY = 'travel';

// Days either side of a trip that still count as travel spending: the flight
// booked the day before, the airport parking paid on return.
export const DEFAULT_FORGIVING_DAYS = 2;

/**
 * Days after a trip in which a charge is still offered as possibly belonging
 * to it.
 *
 * Longer than the margin, and only on the far side, because the bank does not
 * book a foreign card payment the day it is made: a hotel charged at checkout,
 * a car rental's final bill, the taxi from the airport and a restaurant
 * abroad all arrive days later, and the trip screen used to stop listing
 * candidates two days after the trip ended — so they were found weeks on, by
 * accident. Seven days catches them; the late rows are *offered*, flagged as
 * after the trip, and never claimed or counted on their own.
 */
export const DEFAULT_TRAILING_DAYS = 7;

// How far ahead a trip can be paid for and still be the likely owner of an old
// "travel" movement: flights and rooms are booked weeks before leaving.
const BOOKING_LEAD_DAYS = 90;

const DISMISSED_FILE = 'travel-dismissed.json';

/**
 * Two purchases in one country this far apart belong to the same trip.
 *
 * Ten days chained a weekend in Valencia (21–22 April) to a day out in Vigo on
 * 5 May into one fortnight-long trip. Six keeps those apart while still holding
 * a Christmas week in Dublin together across the quiet days in the middle —
 * five splits Dublin in two, seven lets Valencia run away again.
 */
const CLUSTER_GAP_DAYS = 6;

// A merchant billing from abroad in this many distinct months is a
// subscription, not a trip.
const RECURRING_MONTH_THRESHOLD = 3;

/**
 * Country names, in English only — and only for the initial write.
 *
 * These used to be Portuguese, and they are baked into trip names that are
 * already saved: a trip detected in Spain is called "Espanha" in the ledger.
 * Renaming those on a language switch would rewrite the user's own data, which is
 * not something a display setting is allowed to do.
 *
 * It does not have to. Every trip stores its ISO `country` code beside the name,
 * so the *column* is translated from the code (`country.ES` in the catalogue) with
 * no migration at all, while the name stays exactly as it was written. This map
 * survives to fill in `name` and `countryName` when a trip is first detected — a
 * default the user is expected to overwrite anyway.
 */
const COUNTRY_NAMES = {
  ES: 'Spain', FR: 'France', IT: 'Italy', DE: 'Germany', GB: 'United Kingdom',
  NL: 'Netherlands', BE: 'Belgium', LU: 'Luxembourg', IE: 'Ireland',
  DK: 'Denmark', SE: 'Sweden', NO: 'Norway', FI: 'Finland', EE: 'Estonia',
  LV: 'Latvia', LT: 'Lithuania', PL: 'Poland', CZ: 'Czechia', AT: 'Austria',
  CH: 'Switzerland', GR: 'Greece', HR: 'Croatia', HU: 'Hungary', RO: 'Romania',
  BG: 'Bulgaria', SI: 'Slovenia', SK: 'Slovakia', MT: 'Malta', CY: 'Cyprus',
  US: 'United States', CA: 'Canada', BR: 'Brazil', MA: 'Morocco',
  TR: 'Türkiye', JP: 'Japan', TH: 'Thailand', AE: 'United Arab Emirates',
};

const KNOWN_COUNTRIES = new Set(Object.keys(COUNTRY_NAMES).concat([HOME_COUNTRY]));

/**
 * Merchants with no physical presence, whichever country they bill from.
 *
 * eBay and AliExpress both bill out of Luxembourg, which read as two separate
 * trips there. Booking, Airbnb and the airlines are listed too: they are bought
 * *before* leaving and would otherwise stretch a trip backwards by weeks. They
 * are still counted as travel spending once a trip exists — this list only
 * governs what may *prove* the user was abroad.
 */
const ONLINE_MERCHANTS = [
  'EBAY', 'ALIEXPRESS', 'AMAZON', 'AMZN', 'PAYPAL', 'VINTED', 'TEMU', 'SHEIN',
  'ASOS', 'ZALANDO', 'ETSY', 'WISH', 'BOLT', 'UBER', 'GLOVO', 'UBEREATS',
  'SPOTIFY', 'NETFLIX', 'STEAM', 'STEAMGAMES', 'GOOGLE', 'APPLE', 'ITUNES',
  'MICROSOFT', 'SUPERCELL', 'NINTENDO', 'PLAYSTATION', 'GITHUB', 'ANTHROPIC',
  'CLAUDE', 'OPENAI', 'WISE', 'REVOLUT', 'BINANCE', 'DMARKET', 'CSFLOAT',
  'BOOKING', 'AIRBNB', 'RYANAIR', 'EASYJET', 'VUELING', 'FLIXBUS', 'OMIO',
  'MINISO', 'ALIBABA', 'DISCORD', 'PATREON', 'NAMECHEAP', 'CLOUDFLARE',
];

function isOnlineMerchant(name) {
  const upper = stripAccents(String(name || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ONLINE_MERCHANTS.some((m) => upper.includes(m));
}

// Cities that identify a country even when the code is missing or mangled.
const CITY_COUNTRY = {
  TALLINN: 'EE', TARTU: 'EE', VIIMSI: 'EE',
  VILNIUS: 'LT', KAUNAS: 'LT', RIGA: 'LV',
  HELSINKI: 'FI', STOCKHOLM: 'SE', OSLO: 'NO', COPENHAGEN: 'DK',
  MADRID: 'ES', BARCELONA: 'ES', SEVILLA: 'ES', VALENCIA: 'ES', MALAGA: 'ES',
  PARIS: 'FR', LYON: 'FR', MARSEILLE: 'FR', NICE: 'FR',
  LONDON: 'GB', MANCHESTER: 'GB', EDINBURGH: 'GB',
  AMSTERDAM: 'NL', ROTTERDAM: 'NL', BRUSSELS: 'BE', BRUXELLES: 'BE',
  BERLIN: 'DE', MUNICH: 'DE', KOLN: 'DE', FRANKFURT: 'DE', HAMBURG: 'DE',
  MILANO: 'IT', ROMA: 'IT', VENEZIA: 'IT', FIRENZE: 'IT', NAPOLI: 'IT',
  WARSZAWA: 'PL', KRAKOW: 'PL', PRAHA: 'CZ', WIEN: 'AT', BUDAPEST: 'HU',
  DUBLIN: 'IE', ZURICH: 'CH', GENEVE: 'CH', ATHENS: 'GR', ISTANBUL: 'TR',
  MARRAKECH: 'MA', CASABLANCA: 'MA', TANGER: 'MA', AGADIR: 'MA', RABAT: 'MA', FES: 'MA',
};

/**
 * Country codes that are also how the bank truncates a Portuguese place name.
 *
 * The statement clips the city field to a fixed width, and "MATOSINHOS" comes
 * out as "MA" — which is also Morocco. That produced a three-day trip to
 * Marrakech built entirely out of a francesinha shop and a billiards club in
 * Matosinhos. These codes are only believed when a city that actually belongs
 * to that country is named too.
 */
const TRUNCATION_COLLISIONS = new Set(['MA']);

const CITIES_BY_COUNTRY = new Map();
for (const [city, code] of Object.entries(CITY_COUNTRY)) {
  if (!CITIES_BY_COUNTRY.has(code)) CITIES_BY_COUNTRY.set(code, new Set());
  CITIES_BY_COUNTRY.get(code).add(city);
}

// ---------- storage ----------

function file() {
  return statePath(TRAVELS_FILE);
}

export function loadTravels() {
  if (!existsSync(file())) return [];
  try {
    return JSON.parse(readFileSync(file(), 'utf-8'));
  } catch {
    return [];
  }
}

function save(travels) {
  writeFileSync(file(), JSON.stringify(travels, null, 2), 'utf-8');
  return travels;
}

/**
 * The confirmed trip that already covers this range, if there is one.
 *
 * Used to keep a trip from being filed inside another one — the same reason
 * detection suppresses contained proposals. A rejection is not a trip, so it
 * never blocks; and a trip cannot contain itself.
 */
export function containingTravel(range, travels = loadTravels(), { ignoreId = null } = {}) {
  const start = String(range.startDate).slice(0, 10);
  const end = String(range.endDate).slice(0, 10);
  return (
    travels.find((t) => {
      if (t.status === 'rejected' || t.id === ignoreId) return false;
      const { from, to } = travelWindow(t);
      return start >= from && end <= to;
    }) || null
  );
}

export function createTravel(input = {}) {
  if (!input.startDate || !input.endDate) throw new Error('startDate e endDate são obrigatórios');
  const travels = loadTravels();
  // A rejection is a record of "this was not a trip" and is allowed to sit
  // inside a real one; a confirmed trip inside another is double-counting.
  if ((input.status || 'confirmed') !== 'rejected') {
    const parent = containingTravel(input, travels);
    if (parent) {
      const err = new Error(`Estas datas já estão dentro da viagem "${parent.name}".`);
      err.status = 409;
      err.containedBy = parent;
      throw err;
    }
  }
  const travel = {
    id: uuidv4(),
    name: input.name || defaultName(input.country, input.startDate),
    country: (input.country || '').toUpperCase() || null,
    startDate: String(input.startDate).slice(0, 10),
    endDate: String(input.endDate).slice(0, 10),
    forgivingDays: input.forgivingDays ?? DEFAULT_FORGIVING_DAYS,
    status: input.status || 'confirmed',
    tagId: input.tagId || null,
    /* No `category`. A trip used to carry the category it would stamp onto
       everything it claimed, and nothing reads that any more — a trip is when
       and where money was spent, not what it bought. Trips written before this
       keep the field; it is inert, and rewriting twelve files to delete a dead
       key is a worse trade than leaving it where it sits. */
    createdFrom: input.createdFrom || 'manual',
    created: new Date().toISOString(),
  };
  travels.push(travel);
  save(travels);
  return travel;
}

export function updateTravel(id, patch = {}) {
  const travels = loadTravels();
  const travel = travels.find((t) => t.id === id);
  if (!travel) return null;
  const { id: _ignore, created, ...rest } = patch;
  Object.assign(travel, rest, { updated: new Date().toISOString() });
  save(travels);
  return travel;
}

export function deleteTravel(id) {
  const travels = loadTravels();
  const filtered = travels.filter((t) => t.id !== id);
  if (filtered.length === travels.length) return false;
  save(filtered);
  return true;
}

// ---------- trip tags ----------

/**
 * A trip's subcategory exists as soon as the trip does, and is applied by hand.
 *
 * This used to label everything that fell between the two dates, which is not
 * what a trip is. A week in Dublin also contains the rent, the gym direct debit
 * and the Spotify bill — none of which became travel spending because the owner
 * happened to be abroad when they were charged. The calendar cannot tell those
 * apart from a restaurant in Temple Bar, and guessing produced a subcategory on
 * the Spotify charge that nobody asked for.
 *
 * So the window proposes and the person disposes: opening a trip lists what
 * falls inside the dates, and marking a row is what attaches both the `travel`
 * category and the trip's subcategory. Moving the dates afterwards changes the
 * proposal, never a decision that has already been made — `travelAnomalies()`
 * is what reports the drift.
 */
export function syncTravelTag(travel) {
  if (!travel || travel.status === 'rejected') return { tagId: null };
  return { tagId: ensureTravelTag(travel) };
}

/**
 * Attaches or detaches a trip on one transaction — the trip, and nothing else.
 *
 * This used to move the category too, to `travel` on the way in and to
 * `uncategorized` on the way out, on the grounds that they were one decision. It
 * cost more than it was worth. A fortnight in Madrid came back as one number:
 * you could see that the trip cost €2,000 and never that €1,000 of it was
 * hotels, €600 food and €400 transport, because the categories those lines would
 * have carried were overwritten by the word "travel" the moment they were
 * claimed. Worse, un-marking destroyed what was there — the rent that happened
 * to fall inside a trip window went to `uncategorized` and stayed there.
 *
 * A trip is not a kind of spending. It is *when* and *where* the spending
 * happened, which is orthogonal to what it bought: a restaurant bill is food in
 * Lisbon and food in Madrid, and only one of those is also a trip. The tag axis
 * already existed and already accumulated — a transaction has always been able
 * to carry several — so the trip lives there and the category stays the
 * category.
 *
 * What made the old behaviour attractive is real and is kept: a holiday
 * genuinely does distort a food line, and a reader looking at a year does not
 * want August's restaurants to read as a change in habit. That is what
 * `travelOverlay` below is for — a presentation choice at the point of reading,
 * not a fact written into the ledger.
 */
export function markTransactionAsTravel(travel, tx, on) {
  const tagId = ensureTravelTag(travel);
  if (!tagId) return { tagId: null, changed: false };

  const has = (tx.tags || []).includes(tagId);
  if (on && !has) emitTagAssignment(tx.id, tagId, 'travel');
  else if (!on && has) emitTagRemoval(tx.id, tagId, 'travel');

  return { tagId, changed: on !== has };
}

/** The trip's tag, created on first use and renamed with the trip thereafter. */
export function ensureTravelTag(travel) {
  const tags = loadTags();
  const existing = travel.tagId ? tags.find((t) => t.id === travel.tagId) : null;

  if (existing) {
    if (existing.name !== travel.name) updateTag(existing.id, { name: travel.name });
    return existing.id;
  }

  // `createTag` refuses a name already in use, which is the right answer: the
  // user may have made this tag by hand before the trip existed. Adopt it.
  const byName = tags.find((t) => t.name.toLowerCase() === travel.name.toLowerCase());
  const tag = byName || createTag(travel.name);
  if (!tag) return null;

  updateTravel(travel.id, { tagId: tag.id });
  travel.tagId = tag.id;
  return tag.id;
}

/** Retires a trip's tag along with the trip, leaving no orphan behind. */
export function removeTravelTag(travel, transactions) {
  if (!travel?.tagId) return { untagged: 0 };
  let untagged = 0;
  for (const tx of transactions) {
    if (!(tx.tags || []).includes(travel.tagId)) continue;
    emitTagRemoval(tx.id, travel.tagId, 'travel');
    untagged++;
  }
  deleteTag(travel.tagId);
  return { untagged };
}

function defaultName(country, startDate) {
  const place = COUNTRY_NAMES[String(country || '').toUpperCase()] || country || 'Viagem';
  return `${place} · ${String(startDate).slice(0, 7)}`;
}

// ---------- location extraction ----------

// Only card purchases carry a place. Transfers, direct debits and fees never
// do — and "TRF. P/O REEMBOLSOS IRS AT - REEM" ends in a token that is also a
// country code, which is precisely the trap this guard exists for.
const CARD_PURCHASE = /^(COMPRA|LEV(?:ANTAMENTO)?\.?\s+ATM)\b/i;

/**
 * The country a transaction was made in, or null when it reads as domestic.
 *
 * The country code is only accepted as the *final* token of a card purchase.
 * Anywhere else it is far more likely to be Portuguese: "DE" is both Germany
 * and the preposition in "TRF DE PoupeUp", and reading those as trips produced
 * a fictional weekend in Germany worth €1257 of incoming salary.
 */
export function countryOf(transaction) {
  const description = String(transaction.description || transaction.merchant || '');
  if (!CARD_PURCHASE.test(description)) return null;

  const raw = stripAccents(description).toUpperCase();
  const tokens = raw.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

  // The terminal is appended after the location and is often truncated
  // mid-word ("CONTACTLE", "CONTACTLES"), which would otherwise hide the
  // country code behind it.
  while (tokens.length && /^CONTACT/.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return null;

  const last = tokens[tokens.length - 1];
  if (last.length === 2 && KNOWN_COUNTRIES.has(last)) {
    if (last === HOME_COUNTRY) return null;
    // A code that doubles as a clipped Portuguese city needs a city of its own
    // country in the descriptor before it is believed.
    if (TRUNCATION_COLLISIONS.has(last)) {
      const cities = CITIES_BY_COUNTRY.get(last);
      const corroborated = tokens.some((token) => cities?.has(token));
      if (!corroborated) return null;
    }
    return last;
  }

  for (const token of tokens) {
    const country = CITY_COUNTRY[token];
    if (country) return country === HOME_COUNTRY ? null : country;
  }

  return null;
}

export function countryName(code) {
  return COUNTRY_NAMES[String(code || '').toUpperCase()] || code || '';
}

function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

function dayNumber(dateStr) {
  const t = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
}

function shiftDate(dateStr, days) {
  const day = dayNumber(dateStr);
  if (day == null) return String(dateStr).slice(0, 10);
  return new Date((day + days) * 86400000).toISOString().slice(0, 10);
}

/**
 * The merchant name, with the rotating card prefix and trailing location
 * stripped, so the same shop reads the same way every month.
 */
function merchantKey(tx) {
  return cleanDescription(tx.description || tx.merchant || '') || 'OUTROS';
}

/**
 * Merchants that bill from abroad month after month.
 *
 * This is what separates a trip from a habit. Bolt bills every ride from
 * Estonia, Glovo from Spain, Microsoft from Ireland, Spotify from Sweden —
 * none of which means the user left Porto. A merchant seen in several
 * different months is a subscription or an online shop, not a destination.
 */
function recurringForeignMerchants(transactions) {
  const monthsByMerchant = new Map();
  for (const tx of transactions) {
    if (!countryOf(tx)) continue;
    const key = merchantKey(tx);
    if (!monthsByMerchant.has(key)) monthsByMerchant.set(key, new Set());
    monthsByMerchant.get(key).add(monthOf(tx.date));
  }
  const recurring = new Set();
  for (const [key, months] of monthsByMerchant) {
    if (months.size >= RECURRING_MONTH_THRESHOLD) recurring.add(key);
  }
  return recurring;
}

// ---------- detection ----------

/**
 * Proposes trips from the transaction history.
 *
 * Already-known trips (confirmed or rejected) are not proposed again, so
 * running detection repeatedly only ever surfaces something new.
 */
export function detectTravels(transactions, { existing = loadTravels(), minTransactions = 2 } = {}) {
  const recurring = recurringForeignMerchants(transactions);

  const foreign = transactions
    .filter(
      (tx) =>
        countryOf(tx) && !recurring.has(merchantKey(tx)) && !isOnlineMerchant(tx.description)
    )
    .map((tx) => ({ tx, country: countryOf(tx), day: dayNumber(tx.date) }))
    .filter((e) => e.day != null)
    .sort((a, b) => a.day - b.day);

  const byCountry = new Map();
  for (const entry of foreign) {
    if (!byCountry.has(entry.country)) byCountry.set(entry.country, []);
    byCountry.get(entry.country).push(entry);
  }

  const proposals = [];

  for (const [country, entries] of byCountry) {
    let run = [];
    const flush = () => {
      if (run.length < minTransactions) return;
      // Two purchases at the same shop is one shop, not a trip. Being somewhere
      // means spending at more than one place.
      if (new Set(run.map((e) => merchantKey(e.tx))).size < 2) return;
      // The exact span the card was used abroad, with no padding. A day trip to
      // Tui is one day; padding it by a day either side turned it into three.
      // The forgiving margin already covers the flight booked the night before.
      const startDate = String(run[0].tx.date).slice(0, 10);
      const endDate = String(run[run.length - 1].tx.date).slice(0, 10);
      proposals.push({
        id: `detected-${country}-${startDate}`,
        name: defaultName(country, startDate),
        country,
        countryName: countryName(country),
        startDate,
        endDate,
        forgivingDays: DEFAULT_FORGIVING_DAYS,
        status: 'suggested',
        createdFrom: 'detected',
        transactionCount: run.length,
        total: run.reduce((sum, e) => sum + (Number(e.tx.amount) || 0), 0),
        sample: run.slice(0, 4).map((e) => ({
          id: e.tx.id,
          date: String(e.tx.date).slice(0, 10),
          description: e.tx.description,
          amount: e.tx.amount,
        })),
      });
    };

    for (const entry of entries) {
      if (run.length === 0 || entry.day - run[run.length - 1].day <= CLUSTER_GAP_DAYS) {
        run.push(entry);
      } else {
        flush();
        run = [entry];
      }
    }
    flush();
  }

  // Anything already covered by a trip on file is not news — and a trip the
  // user has *rejected* is the most settled answer of all. Excluding rejected
  // trips from this check is why "não foi viagem" never stuck: the proposal
  // came straight back on the next detection run.
  //
  // Two different tests, because they answer two different questions:
  //
  //   containment — a proposal sitting entirely inside an existing trip is part
  //   of that trip, whatever country it is in. One holiday through Hungary,
  //   Austria and Czechia is one trip; proposing each country separately inside
  //   it is proposing the same holiday three more times. The existing trip's
  //   forgiving margin counts here, since that is the range it really claims.
  //
  //   same-country overlap — a proposal that merely straddles the edge of a trip
  //   to the same country is that trip drifting, not a new one.
  const fresh = proposals.filter(
    (p) =>
      !existing.some((t) => {
        const { from, to } = travelWindow(t);
        if (p.startDate >= from && p.endDate <= to) return true;
        return t.country === p.country && p.startDate <= t.endDate && p.endDate >= t.startDate;
      })
  );

  return fresh.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

// ---------- windows & anomalies ----------

/** The date range a trip covers, including its forgiving margin. */
export function travelWindow(travel) {
  const margin = travel.forgivingDays ?? DEFAULT_FORGIVING_DAYS;
  return { from: shiftDate(travel.startDate, -margin), to: shiftDate(travel.endDate, margin) };
}

/**
 * The range the trip screen lists candidates from: the trip, its margin, and the
 * late tail after it (`DEFAULT_TRAILING_DAYS`). A trip may carry its own
 * `trailingDays`; it is never shorter than the margin.
 *
 * Only the trip screen reads this. What a trip *is* — which date belongs to
 * which trip, what "claim everything in the window" claims, what counts as a
 * missed claim — stays `travelWindow`, so a week of groceries at home after a
 * holiday is offered for review and never reported as an error.
 */
export function reviewWindow(travel) {
  const margin = travel.forgivingDays ?? DEFAULT_FORGIVING_DAYS;
  const trailing = Math.max(margin, Number(travel.trailingDays ?? DEFAULT_TRAILING_DAYS) || 0);
  return { from: shiftDate(travel.startDate, -margin), to: shiftDate(travel.endDate, trailing) };
}

export function transactionsInTravel(travel, transactions, { includeLate = false } = {}) {
  const { from, to } = includeLate ? reviewWindow(travel) : travelWindow(travel);
  return transactions
    .filter((t) => {
      const d = String(t.date).slice(0, 10);
      return d >= from && d <= to;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * The late rows that look like they came from the trip, and why.
 *
 * Two signals, both cheap and both visible to the reader:
 *
 *   foreign       the card was used abroad (`countryOf`) — nobody buys a
 *                 sandwich in Tallinn from their sofa in Porto.
 *   sameMerchant  the merchant was already paid during the trip itself: the
 *                 second Bolt ride, the hotel's minibar charged on its own.
 *
 * A merchant that bills from abroad every month is a subscription, not a trip,
 * and the shops that only exist online prove nothing about where anyone was —
 * the same exclusions detection uses.
 */
export function lateSignals(travel, transactions) {
  const core = travelWindow(travel);
  const review = reviewWindow(travel);
  const recurring = recurringForeignMerchants(transactions);
  const usable = (tx) => !recurring.has(merchantKey(tx)) && !isOnlineMerchant(tx.description);

  const during = new Set();
  for (const tx of transactions) {
    const d = String(tx.date).slice(0, 10);
    if (d < travel.startDate || d > travel.endDate) continue;
    const claimed = travel.tagId && (tx.tags || []).includes(travel.tagId);
    if ((claimed || countryOf(tx)) && usable(tx)) during.add(merchantKey(tx));
  }

  const signals = new Map();
  for (const tx of transactions) {
    const d = String(tx.date).slice(0, 10);
    if (d <= core.to || d > review.to) continue;
    if (Number(tx.amount) >= 0 || !usable(tx)) continue;
    if (countryOf(tx)) signals.set(tx.id, 'foreign');
    else if (during.has(merchantKey(tx))) signals.set(tx.id, 'sameMerchant');
  }
  return signals;
}

/** Movements the owner has said are nothing to do with any trip. */
export function loadDismissed() {
  const path = statePath(DISMISSED_FILE);
  if (!existsSync(path)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return new Set();
  }
}

export function dismissFromTravel(ids = []) {
  const dismissed = loadDismissed();
  for (const id of ids) dismissed.add(String(id));
  writeFileSync(statePath(DISMISSED_FILE), JSON.stringify([...dismissed], null, 2), 'utf-8');
  return dismissed.size;
}

/**
 * The trip an old "travel" movement most likely belonged to.
 *
 * Inside a trip's window (late tail included) is the trip. Before one, within
 * a booking lead, is the trip it was booked for — the flight bought in June for
 * August. Otherwise there is no honest guess, and none is offered.
 */
export function suggestTrip(tx, travels = loadTravels()) {
  const d = String(tx.date).slice(0, 10);
  const active = travels.filter((t) => t.status !== 'rejected');
  const inside = active.find((t) => {
    const { from, to } = reviewWindow(t);
    return d >= from && d <= to;
  });
  if (inside) return { travel: inside, reason: 'during' };
  const day = dayNumber(d);
  const ahead = active
    .map((t) => ({ travel: t, lead: dayNumber(t.startDate) - day }))
    .filter((c) => c.lead > 0 && c.lead <= BOOKING_LEAD_DAYS)
    .sort((a, b) => a.lead - b.lead)[0];
  return ahead ? { travel: ahead.travel, reason: 'booking' } : null;
}

/** The trip a date falls inside, if any. Confirmed trips only. */
export function travelForDate(dateStr, travels = loadTravels()) {
  const d = String(dateStr).slice(0, 10);
  return (
    travels.find((t) => {
      if (t.status === 'rejected') return false;
      const { from, to } = travelWindow(t);
      return d >= from && d <= to;
    }) || null
  );
}

/** Maps every transaction id to the trip it falls inside, for cheap lookups. */
export function buildTravelIndex(transactions, travels = loadTravels()) {
  const index = new Map();
  const active = travels.filter((t) => t.status !== 'rejected');
  if (active.length === 0) return index;
  const windows = active.map((t) => ({ travel: t, ...travelWindow(t) }));
  for (const tx of transactions) {
    const d = String(tx.date).slice(0, 10);
    const hit = windows.find((w) => d >= w.from && d <= w.to);
    if (hit) index.set(tx.id, hit.travel);
  }
  return index;
}

/**
 * Where the travel labelling and the calendar disagree.
 *
 * `missing`: spent during a trip but never categorized or tagged as travel —
 * the case the user described as "wrongly not tagged as travel".
 * `stray`: labelled as travel while at home, which is usually a rule firing too
 * broadly.
 */
export function travelAnomalies(transactions, travels = loadTravels()) {
  const index = buildTravelIndex(transactions, travels);
  const tagIds = travelTagIds(travels);

  // The trip tag, and only the trip tag. Reading the category as well was
  // correct while the two moved together; now that a trip transaction keeps its
  // real category, `tx.category === 'travel'` says nothing about whether a trip
  // claims it, and counting it would report every old travel-categorized line as
  // correctly labelled when nothing has been tagged at all.
  const isLabelled = (tx) => (tx.tags || []).some((id) => tagIds.has(id));

  const missing = [];
  const stray = [];
  const legacy = [];
  const late = [];
  const dismissed = loadDismissed();

  for (const tx of transactions) {
    const travel = index.get(tx.id);
    if (travel && !isLabelled(tx)) {
      missing.push({ transaction: tx, travel });
    } else if (!travel && isLabelled(tx)) {
      stray.push({ transaction: tx });
    }
    // Filed under "travel" back when that was a category, and never claimed
    // by a trip since. The category is gone (see lib/derivedCategories.js); this
    // is the one place left that remembers it, so it can be handed to a trip.
    if (tx.legacyTravel && !isLabelled(tx) && !dismissed.has(tx.id) && Number(tx.amount) < 0) {
      legacy.push({ transaction: tx, suggestion: suggestTrip(tx, travels) });
    }
  }

  for (const travel of travels) {
    if (travel.status === 'rejected') continue;
    const signals = lateSignals(travel, transactions);
    if (!signals.size) continue;
    for (const tx of transactions) {
      const reason = signals.get(tx.id);
      if (!reason || isLabelled(tx) || dismissed.has(tx.id)) continue;
      late.push({ transaction: tx, travel, reason });
    }
  }

  return { missing, stray, legacy, late };
}

/**
 * Every tag id that belongs to a trip someone has confirmed.
 *
 * A rejected proposal keeps no claim on anything, and a trip that has never been
 * opened has no tag yet — neither is an error, so both are simply absent.
 */
export function travelTagIds(travels = loadTravels()) {
  return new Set(
    travels.filter((t) => t.status !== 'rejected').map((t) => t.tagId).filter(Boolean),
  );
}

/**
 * A category map in which everything a trip claims reads as travel.
 *
 * This is the whole of the travel overlay, and it is deliberately one line of
 * plumbing rather than a branch in every aggregate. `computeCategoryBreakdown`,
 * `computeCategoryTrend`, `computeCategoryShifts`, `computeFlow` and
 * `computeDailySpend` all resolve a category the same way —
 * `categoryMap[tx.id] || tx.category` — so handing them a map with the trips
 * already folded in gives every one of them the overlay, consistently, with no
 * fifth copy of the rule to drift.
 *
 * The ledger is untouched. Turn the setting off and the same transactions read
 * as hotels and restaurants again, because that is what they have said all
 * along.
 */
export function travelOverlay(transactions, categoryMap = {}, travels = loadTravels()) {
  const tagIds = travelTagIds(travels);
  if (!tagIds.size) return categoryMap;

  const overlaid = { ...categoryMap };
  for (const tx of transactions) {
    if ((tx.tags || []).some((id) => tagIds.has(id))) overlaid[tx.id] = TRAVEL_CATEGORY;
  }
  return overlaid;
}

/**
 * What each trip cost, and what it was spent on.
 *
 * The per-trip breakdown uses the *real* categories — never the overlay. A card
 * that told you a trip cost €2,000 and that 100% of it was "travel" would be the
 * exact loss of information this refactor exists to undo.
 */
export function tripSpending(transactions, categoryMap = {}, travels = loadTravels()) {
  const tagged = new Map();
  for (const travel of travels) {
    if (travel.status === 'rejected' || !travel.tagId) continue;
    tagged.set(travel.tagId, travel);
  }
  if (!tagged.size) return [];

  const totals = new Map();
  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    // Spending only. A refund inside a trip reduces its cost; money arriving for
    // an unrelated reason during the same fortnight is not part of it.
    if (amount >= 0) continue;
    for (const tagId of tx.tags || []) {
      const travel = tagged.get(tagId);
      if (!travel) continue;
      const entry = totals.get(travel.id) || {
        id: travel.id,
        name: travel.name,
        country: travel.country,
        startDate: travel.startDate,
        endDate: travel.endDate,
        total: 0,
        count: 0,
        categories: new Map(),
      };
      const category = categoryMap[tx.id] || tx.category || 'uncategorized';
      entry.total += Math.abs(amount);
      entry.count += 1;
      entry.categories.set(category, (entry.categories.get(category) || 0) + Math.abs(amount));
      totals.set(travel.id, entry);
    }
  }

  return [...totals.values()]
    .map((entry) => ({
      ...entry,
      total: Math.round(entry.total * 100) / 100,
      days: tripDays(entry.startDate, entry.endDate),
      categories: [...entry.categories.entries()]
        .map(([category, value]) => ({ category, value: Math.round(value * 100) / 100 }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.total - a.total);
}

function tripDays(startDate, endDate) {
  const from = Date.parse(startDate);
  const to = Date.parse(endDate);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(1, Math.round((to - from) / 86400000) + 1);
}

/**
 * One trip, in enough detail to answer "how did that trip go".
 *
 * Built from what the trip *claimed*, with the real categories, like
 * `tripSpending` — but for a single trip, and over its own dates rather than
 * the dashboard's range: a trip is its own period, and a card asked about the
 * Dublin trip should not go blank because the filter bar says "this month".
 *
 * Three phases, because a trip's money does not all happen on the trip:
 *
 *   before   booked ahead — the flight in June for August
 *   during   on the ground, the trip's dates
 *   after    charges that posted on the way home and later
 *
 * Two daily figures, because they answer different questions. `perDay` is the
 * whole cost over the trip's days — what the trip cost per day, flights and all,
 * which is the figure that compares one trip with another. `perDayOnTrip` is
 * only what was spent while there — the "how much did a day in Dublin cost"
 * figure, which a €300 flight booked months ahead would otherwise swamp. The
 * travel-budgeting apps keep pre-paid items out of the daily average for the
 * same reason.
 */
export function tripDetail(travel, transactions, categoryMap = {}, travels = loadTravels()) {
  const claimed = travel.tagId
    ? transactions.filter((tx) => (tx.tags || []).includes(travel.tagId))
    : [];
  const days = tripDays(travel.startDate, travel.endDate);
  const phaseOf = (date) => (date < travel.startDate ? 'before' : date > travel.endDate ? 'after' : 'during');

  const phases = { before: 0, during: 0, after: 0 };
  const byCategory = new Map();
  const byDay = new Map();
  let refunds = 0;

  for (const tx of claimed) {
    const amount = Number(tx.amount) || 0;
    const date = String(tx.date).slice(0, 10);
    // A refund inside a trip makes the trip cheaper; it is netted, not hidden.
    if (amount > 0) {
      refunds += amount;
      continue;
    }
    const value = Math.abs(amount);
    const category = categoryMap[tx.id] || tx.category || 'uncategorized';
    phases[phaseOf(date)] += value;
    const entry = byCategory.get(category) || { category, value: 0, count: 0 };
    entry.value += value;
    entry.count += 1;
    byCategory.set(category, entry);
    const day = byDay.get(date) || { date, phase: phaseOf(date), total: 0, count: 0 };
    day.total += value;
    day.count += 1;
    byDay.set(date, day);
  }

  // The trip's own days are always drawn, quiet ones included: a day that cost
  // nothing is information about the trip, not a gap in it.
  for (let d = travel.startDate; d <= travel.endDate; d = shiftDate(d, 1)) {
    if (!byDay.has(d)) byDay.set(d, { date: d, phase: 'during', total: 0, count: 0 });
  }

  const spent = phases.before + phases.during + phases.after;
  const total = round2(spent - refunds);

  // Every other trip's whole-cost-per-day, so this one has something to be
  // measured against.
  const others = tripSpending(transactions, categoryMap, travels)
    .filter((t) => t.id !== travel.id && t.days)
    .map((t) => t.total / t.days);

  return {
    id: travel.id,
    name: travel.name,
    country: travel.country,
    startDate: travel.startDate,
    endDate: travel.endDate,
    days,
    count: claimed.length,
    total,
    refunds: round2(refunds),
    perDay: days ? round2(total / days) : null,
    perDayOnTrip: days ? round2(phases.during / days) : null,
    phases: { before: round2(phases.before), during: round2(phases.during), after: round2(phases.after) },
    otherTripsPerDay: others.length ? round2(others.reduce((a, b) => a + b, 0) / others.length) : null,
    otherTrips: others.length,
    categories: [...byCategory.values()]
      .map((c) => ({ ...c, value: round2(c.value) }))
      .sort((a, b) => b.value - a.value),
    daily: [...byDay.values()]
      .map((d) => ({ ...d, total: round2(d.total) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    largest: claimed
      .filter((tx) => Number(tx.amount) < 0)
      .sort((a, b) => Number(a.amount) - Number(b.amount))
      .slice(0, 5)
      .map((tx) => ({
        id: tx.id,
        date: String(tx.date).slice(0, 10),
        description: tx.description,
        amount: Number(tx.amount),
        category: categoryMap[tx.id] || tx.category || 'uncategorized',
      })),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
