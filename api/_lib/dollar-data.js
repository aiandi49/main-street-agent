// Live "where the dollar stands" snapshot, built only from official or public data sources.
// Used by /api/dollar (the tracker page) and /api/chat (so the chat can quote today's numbers).
// Files in api/_lib are not deployed as routes.
//
// Sources
//   U.S. Treasury Fiscal Data (no key): debt to the penny, average interest rates on the debt
//   FRED, Federal Reserve Bank of St. Louis: yields, inflation, dollar index, GDP, interest outlays, M2
//     - uses the FRED API when FRED_API_KEY is set (recommended, free), otherwise FRED's public CSV download
//   gold-api.com (no key): spot gold price in U.S. dollars
//   U.S. Energy Information Administration (optional, EIA_API_KEY): annual U.S. electricity generation

const CACHE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7000;
const GRAMS_PER_TROY_OUNCE = 31.1035;

// Approximate annual average gold prices (LBMA PM, U.S. dollars per troy ounce), used only as
// fixed reference points for "the dollar measured in gold". Rounded; see gold.org for exact figures.
export const GOLD_REFERENCE = [
  { year: 2000, price: 279 },
  { year: 2014, price: 1266 },
  { year: 2020, price: 1770 },
];

let cache = null;
let inflight = null;

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json, text/csv;q=0.9, */*;q=0.5', 'User-Agent': 'MainStreetAgent/1.0 (dollar tracker)' } });
    if (!r.ok) throw new Error(`status ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------- FRED ----------
// Returns [{date:'YYYY-MM-DD', value:Number}] sorted oldest -> newest.
async function fredSeries(id, start) {
  const key = process.env.FRED_API_KEY;
  if (key) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}`;
    const json = await fetchJson(url);
    return (json.observations || [])
      .map((o) => ({ date: String(o.date), value: num(o.value) }))
      .filter((o) => o.value !== null);
  }
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${start}`);
  const out = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [date, value] = line.split(',');
    const v = num(value);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && v !== null) out.push({ date: date.trim(), value: v });
  }
  return out;
}

function last(series) {
  return series.length ? series[series.length - 1] : null;
}

// The observation closest to (on or before) a target date.
function atOrBefore(series, isoDate) {
  let found = null;
  for (const o of series) {
    if (o.date <= isoDate) found = o;
    else break;
  }
  return found;
}

function yearAgoOf(series, point) {
  if (!point) return null;
  const d = new Date(point.date + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return atOrBefore(series, d.toISOString().slice(0, 10));
}

function yoyPct(series) {
  const p = last(series);
  const prev = yearAgoOf(series, p);
  if (!p || !prev || !prev.value) return null;
  return ((p.value / prev.value) - 1) * 100;
}

// Thin a series to at most n points for a small sparkline.
function spark(series, n = 40) {
  if (!series.length) return [];
  const step = Math.max(1, Math.ceil(series.length / n));
  const pts = [];
  for (let i = 0; i < series.length; i += step) pts.push(Number(series[i].value.toFixed(4)));
  const lastV = Number(series[series.length - 1].value.toFixed(4));
  if (pts[pts.length - 1] !== lastV) pts.push(lastV);
  return pts;
}

function yearAverage(series, year) {
  const vals = series.filter((o) => o.date.startsWith(String(year))).map((o) => o.value);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ---------- formatting ----------
const fmtPct = (v, d = 1) => (v === null || v === undefined ? null : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const fmtRate = (v, d = 2) => (v === null || v === undefined ? null : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
function fmtMoney(v) {
  if (v === null || v === undefined) return null;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)} trillion`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)} billion`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)} million`;
  return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
}
function prettyDate(iso) {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function prettyMonth(iso) {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
}
function prettyQuarter(iso) {
  if (!iso) return null;
  const m = Number(iso.slice(5, 7));
  return `Q${Math.floor((m - 1) / 3) + 1} ${iso.slice(0, 4)}`;
}

const SRC = {
  fred: (id) => ({ label: `FRED · ${id}`, url: `https://fred.stlouisfed.org/series/${id}` }),
  debt: { label: 'U.S. Treasury · Debt to the Penny', url: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/' },
  rates: { label: 'U.S. Treasury · Average Interest Rates', url: 'https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/' },
  gold: { label: 'gold-api.com · spot gold', url: 'https://gold-api.com/' },
  eia: { label: 'U.S. EIA · electricity net generation', url: 'https://www.eia.gov/electricity/data/browser/' },
};

// ---------- sources ----------
async function getGold() {
  const json = await fetchJson('https://api.gold-api.com/price/XAU');
  const price = num(json && json.price);
  if (!price || price < 100 || price > 100000) throw new Error('bad gold price');
  const updated = json.updatedAt ? String(json.updatedAt) : new Date().toISOString();
  return { price, updated };
}

const FISCAL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od';

async function getDebt() {
  const fields = 'record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt';
  const latestUrl = `${FISCAL}/debt_to_penny?fields=${fields}&sort=-record_date&page[size]=1`;
  const yearAgoUrl = `${FISCAL}/debt_to_penny?fields=${fields}&filter=record_date:lte:${isoDaysAgo(365)}&sort=-record_date&page[size]=1`;
  const [a, b] = await Promise.all([fetchJson(latestUrl), fetchJson(yearAgoUrl)]);
  const now = a.data && a.data[0];
  const then = b.data && b.data[0];
  if (!now) throw new Error('no debt data');
  return {
    date: now.record_date,
    total: num(now.tot_pub_debt_out_amt),
    publicHeld: num(now.debt_held_public_amt),
    intragov: num(now.intragov_hold_amt),
    yearAgo: then ? { date: then.record_date, total: num(then.tot_pub_debt_out_amt) } : null,
  };
}

async function getAvgRates() {
  const url = `${FISCAL}/avg_interest_rates?fields=record_date,security_type_desc,security_desc,avg_interest_rate_amt&sort=-record_date&page[size]=40`;
  const json = await fetchJson(url);
  const rows = json.data || [];
  if (!rows.length) throw new Error('no rate data');
  const date = rows[0].record_date;
  const pick = (desc) => {
    const r = rows.find((x) => x.record_date === date && x.security_desc === desc);
    return r ? num(r.avg_interest_rate_amt) : null;
  };
  return { date, totalMarketable: pick('Total Marketable'), bills: pick('Treasury Bills'), bonds: pick('Treasury Bonds'), notes: pick('Treasury Notes') };
}

async function getElectricity() {
  const key = process.env.EIA_API_KEY;
  if (!key) return null;
  const url = `https://api.eia.gov/v2/electricity/electric-power-operational-data/data/?api_key=${encodeURIComponent(key)}&frequency=annual&data[0]=generation&facets[location][]=US&facets[sectorid][]=99&facets[fueltypeid][]=ALL&sort[0][column]=period&sort[0][direction]=desc&length=30`;
  const json = await fetchJson(url);
  const rows = (json.response && json.response.data) || [];
  const series = rows
    .map((r) => ({ year: String(r.period), value: num(r.generation), units: String(r['generation-units'] || '') }))
    .filter((r) => r.value !== null)
    .sort((x, y) => (x.year < y.year ? -1 : 1));
  if (!series.length) throw new Error('no eia data');
  return series;
}

// ---------- build ----------
async function build() {
  const start1y = isoDaysAgo(400);
  const start2000 = '2000-01-01';
  const start5y = isoDaysAgo(365 * 6);

  const jobs = {
    gold: getGold(),
    debt: getDebt(),
    rates: getAvgRates(),
    elec: getElectricity(),
    dgs3mo: fredSeries('DGS3MO', start1y),
    dgs10: fredSeries('DGS10', start1y),
    dgs30: fredSeries('DGS30', start1y),
    dfii10: fredSeries('DFII10', start1y),
    dff: fredSeries('DFF', start1y),
    dollar: fredSeries('DTWEXBGS', start1y),
    cpi: fredSeries('CPIAUCSL', start2000),
    core: fredSeries('CPILFESL', start5y),
    ppower: fredSeries('CUUR0000SA0R', start5y),
    m2: fredSeries('M2SL', start5y),
    gdp: fredSeries('A191RL1Q225SBEA', start5y),
    gdi: fredSeries('A261RL1Q225SBEA', start5y),
    debtgdp: fredSeries('GFDEGDQ188S', start5y),
    interest: fredSeries('A091RC1Q027SBEA', start5y),
    pop: fredSeries('POPTHM', isoDaysAgo(400)),
  };
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const d = {};
  const ok = {};
  names.forEach((n, i) => {
    ok[n] = settled[i].status === 'fulfilled' && settled[i].value !== null;
    d[n] = settled[i].status === 'fulfilled' ? settled[i].value : null;
    if (settled[i].status === 'rejected') console.error(`dollar: source ${n} unavailable`);
  });

  const metrics = [];
  const add = (m) => metrics.push(m);
  const cpiYoY = d.cpi && d.cpi.length ? yoyPct(d.cpi) : null;
  const cpiLast = d.cpi ? last(d.cpi) : null;

  // 1. Dollar vs gold (the headline metric)
  if (d.gold) {
    const grams = (100 / d.gold.price) * GRAMS_PER_TROY_OUNCE;
    const refs = GOLD_REFERENCE.map((r) => ({
      year: r.year,
      price: r.price,
      dollarChange: ((r.price / d.gold.price) - 1) * 100, // value of $1 in gold today vs. then
    }));
    add({
      id: 'gold', group: 'gold', label: 'Gold price', value: d.gold.price,
      display: `$${d.gold.price.toLocaleString('en-US', { maximumFractionDigits: 0 })} / oz`,
      asOf: prettyDate(d.gold.updated),
      sub: `$100 buys about ${grams.toFixed(2)} grams of gold`,
      note: 'Spot price, updates through the day. Gold is volatile, so this yardstick moves a lot.',
      source: SRC.gold,
    });
    add({
      id: 'dollar-in-gold', group: 'gold', label: 'The dollar measured in gold',
      value: refs[0].dollarChange,
      display: fmtPct(refs[0].dollarChange, 0),
      asOf: prettyDate(d.gold.updated),
      sub: `since ${refs[0].year} · ${refs.slice(1).map((r) => `${fmtPct(r.dollarChange, 0)} since ${r.year}`).join(' · ')}`,
      note: `Compared with approximate annual average gold prices (${GOLD_REFERENCE.map((r) => `${r.year}: $${r.price.toLocaleString('en-US')}`).join(', ')}).`,
      refs,
      source: SRC.gold,
    });
  }

  // 2. Inflation and purchasing power
  if (cpiLast) {
    const avg2000 = yearAverage(d.cpi, 2000);
    const buys = avg2000 ? (100 * avg2000) / cpiLast.value : null;
    add({
      id: 'cpi', group: 'inflation', label: 'Inflation (CPI, past 12 months)', value: cpiYoY,
      display: fmtRate(cpiYoY, 1), asOf: prettyMonth(cpiLast.date),
      sub: buys ? `$100 from 2000 buys what about $${buys.toFixed(0)} did then` : null,
      note: 'The official consumer price index, all items. Your own costs can rise faster or slower.',
      spark: spark(d.cpi.slice(-60)), source: SRC.fred('CPIAUCSL'),
    });
  }
  if (d.core && d.core.length) {
    const p = last(d.core);
    add({ id: 'core', group: 'inflation', label: 'Core inflation (no food or energy)', value: yoyPct(d.core), display: fmtRate(yoyPct(d.core), 1), asOf: prettyMonth(p.date), note: 'Strips out the most volatile prices to show the underlying trend.', source: SRC.fred('CPILFESL') });
  }
  if (d.ppower && d.ppower.length) {
    const p = last(d.ppower);
    add({ id: 'ppower', group: 'inflation', label: 'Purchasing power of the dollar', value: p.value, display: `${p.value.toFixed(1)}¢`, asOf: prettyMonth(p.date), sub: 'what a 1982–84 dollar is worth today, in cents', note: 'Published by the Bureau of Labor Statistics from the CPI.', spark: spark(d.ppower), source: SRC.fred('CUUR0000SA0R') });
  }
  if (d.m2 && d.m2.length) {
    const p = last(d.m2);
    add({ id: 'm2', group: 'inflation', label: 'Money supply (M2) growth', value: yoyPct(d.m2), display: fmtPct(yoyPct(d.m2), 1), asOf: prettyMonth(p.date), sub: `total ${fmtMoney(p.value * 1e9)}`, note: 'Cash, checking, savings and money market balances, over 12 months.', spark: spark(d.m2), source: SRC.fred('M2SL') });
  }

  // 3. Rates and the bond market
  const rate = (key, id, label, note) => {
    const s = d[key];
    if (!s || !s.length) return;
    const p = last(s);
    const prev = yearAgoOf(s, p);
    add({ id: key, group: 'rates', label, value: p.value, display: fmtRate(p.value), asOf: prettyDate(p.date), sub: prev ? `${fmtRate(prev.value)} a year ago` : null, note, spark: spark(s), source: SRC.fred(id) });
  };
  rate('dff', 'DFF', 'Fed funds rate (overnight)', 'The short-term rate the Federal Reserve targets.');
  rate('dgs3mo', 'DGS3MO', '3-month Treasury bill', 'Short-term government borrowing. It follows the Fed closely.');
  rate('dgs10', 'DGS10', '10-year Treasury yield', 'Set by the market. Mortgage rates tend to follow it.');
  rate('dgs30', 'DGS30', '30-year Treasury yield', 'The longest U.S. bond. Investors demand more here when they worry about debt and inflation.');
  rate('dfii10', 'DFII10', '10-year real yield (TIPS)', 'What investors earn after expected inflation. Below zero means savers lose buying power.');
  if (d.dgs3mo && d.dgs3mo.length && cpiYoY !== null) {
    const real = last(d.dgs3mo).value - cpiYoY;
    add({ id: 'realbill', group: 'rates', label: 'Real return on a 3-month bill', value: real, display: fmtRate(real), asOf: prettyDate(last(d.dgs3mo).date), sub: 'bill yield minus the last 12 months of CPI', note: real < 0 ? 'Negative: safe short-term savings are losing to inflation right now.' : 'Positive: safe short-term savings are beating inflation right now.', source: SRC.fred('DGS3MO') });
  }

  // 4. Debt and interest
  if (d.debt && d.debt.total) {
    const perDay = d.debt.yearAgo && d.debt.yearAgo.total
      ? (d.debt.total - d.debt.yearAgo.total) / Math.max(1, (new Date(d.debt.date) - new Date(d.debt.yearAgo.date)) / 86400000)
      : null;
    const popK = d.pop && d.pop.length ? last(d.pop).value : null;
    add({
      id: 'debt', group: 'debt', label: 'National debt', value: d.debt.total, display: fmtMoney(d.debt.total), asOf: prettyDate(d.debt.date),
      sub: [perDay ? `about ${fmtMoney(perDay)} added per day over the past year` : null, popK ? `about ${fmtMoney(d.debt.total / (popK * 1000))} per person` : null].filter(Boolean).join(' · ') || null,
      note: `Held by the public ${fmtMoney(d.debt.publicHeld)}; owed to government trust funds ${fmtMoney(d.debt.intragov)}.`,
      source: SRC.debt,
    });
    if (d.debt.yearAgo && d.debt.yearAgo.total) {
      const ch = d.debt.total - d.debt.yearAgo.total;
      add({ id: 'debt-change', group: 'debt', label: 'Debt change, past 12 months', value: ch, display: fmtMoney(ch), asOf: prettyDate(d.debt.date), sub: `from ${fmtMoney(d.debt.yearAgo.total)} on ${prettyDate(d.debt.yearAgo.date)}`, note: 'Straight from the Treasury’s daily count, so anyone can check whether the debt went up or down.', source: SRC.debt });
    }
  }
  if (d.interest && d.interest.length) {
    const p = last(d.interest);
    const prev = yearAgoOf(d.interest, p);
    add({ id: 'interest', group: 'debt', label: 'Federal interest payments (yearly pace)', value: p.value * 1e9, display: fmtMoney(p.value * 1e9), asOf: prettyQuarter(p.date), sub: prev ? `${fmtPct(((p.value / prev.value) - 1) * 100, 0)} vs. a year earlier · about ${fmtMoney((p.value * 1e9) / 365)} a day` : null, note: 'Bureau of Economic Analysis, seasonally adjusted annual rate.', spark: spark(d.interest), source: SRC.fred('A091RC1Q027SBEA') });
  }
  if (d.rates && d.rates.totalMarketable !== null) {
    add({ id: 'avgrate', group: 'debt', label: 'Average interest rate on U.S. debt', value: d.rates.totalMarketable, display: fmtRate(d.rates.totalMarketable, 2), asOf: prettyMonth(d.rates.date), sub: `bills ${fmtRate(d.rates.bills)} · notes ${fmtRate(d.rates.notes)} · bonds ${fmtRate(d.rates.bonds)}`, note: 'All marketable Treasury debt. As old cheap debt matures and is refinanced higher, this rises.', source: SRC.rates });
  }
  if (d.debtgdp && d.debtgdp.length) {
    const p = last(d.debtgdp);
    add({ id: 'debtgdp', group: 'debt', label: 'Debt compared with the economy', value: p.value, display: `${p.value.toFixed(0)}% of GDP`, asOf: prettyQuarter(p.date), note: 'Total public debt divided by the size of the economy (GDP).', spark: spark(d.debtgdp), source: SRC.fred('GFDEGDQ188S') });
  }

  // 5. The dollar abroad
  if (d.dollar && d.dollar.length) {
    const p = last(d.dollar);
    const prev = yearAgoOf(d.dollar, p);
    add({ id: 'dxy', group: 'world', label: 'Dollar vs. other currencies', value: p.value, display: p.value.toFixed(1), asOf: prettyDate(p.date), sub: prev ? `${fmtPct(((p.value / prev.value) - 1) * 100, 1)} over 12 months` : null, note: 'Federal Reserve broad dollar index against major trading partners. Up means a stronger dollar abroad.', spark: spark(d.dollar), source: SRC.fred('DTWEXBGS') });
  }

  // 6. The real economy
  if (d.gdp && d.gdp.length) {
    const p = last(d.gdp);
    const gdi = d.gdi && d.gdi.length ? atOrBefore(d.gdi, p.date) : null;
    add({ id: 'gdp', group: 'economy', label: 'Real GDP growth (latest quarter)', value: p.value, display: fmtPct(p.value, 1), asOf: prettyQuarter(p.date), sub: gdi && gdi.date === p.date ? `the income-side measure (GDI) shows ${fmtPct(gdi.value, 1)}` : null, note: 'Annualized and adjusted for inflation. GDP and GDI measure the same economy two ways; a big gap between them is a reason for caution.', spark: spark(d.gdp), source: SRC.fred('A191RL1Q225SBEA') });
  }
  if (Array.isArray(d.elec) && d.elec.length) {
    const p = d.elec[d.elec.length - 1];
    const base = d.elec.find((r) => r.year === '2004') || d.elec.find((r) => r.year === '2005');
    const unitsTWh = /thousand megawatt/i.test(p.units) ? 1 / 1000 : null;
    const fmt = (v) => (unitsTWh ? `${Math.round(v * unitsTWh).toLocaleString('en-US')} TWh` : `${Math.round(v).toLocaleString('en-US')} ${p.units}`);
    add({ id: 'elec', group: 'economy', label: 'U.S. electricity generated (year)', value: p.value, display: fmt(p.value), asOf: p.year, sub: base ? `${fmtPct(((p.value / base.value) - 1) * 100, 0)} vs. ${base.year} (${fmt(base.value)})` : null, note: 'A rough gauge of how much physical work the economy does.', spark: d.elec.map((r) => r.value), source: SRC.eia });
  }

  return {
    updated: new Date().toISOString(),
    metrics,
    available: {
      gold: ok.gold, treasury: ok.debt || ok.rates, fred: ok.dgs10 || ok.cpi, electricity: Array.isArray(d.elec) && d.elec.length > 0,
    },
  };
}

export async function getDollarSnapshot() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = build()
      .then((data) => {
        if (data.metrics.length) cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// Compact text for the chat's system prompt.
export function snapshotForPrompt(snap) {
  if (!snap || !snap.metrics || !snap.metrics.length) return '';
  return snap.metrics
    .map((m) => `- ${m.label}: ${m.display}${m.sub ? ` (${m.sub})` : ''}; as of ${m.asOf || 'latest'}; source ${m.source.label}`)
    .join('\n');
}
