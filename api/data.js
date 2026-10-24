// Serverless function: fetches live data, computes the ratios, returns JSON.
// Runs on Vercel at /api/data. Results are cached at the edge for 5 minutes.

const BREAK = 'BREAKLm9nsBW8M5ZTk52EUpwSC5cdCepdjUMSPnCxTgd';
const CARDS = 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp';

const SOURCES = {
  grail: 'https://grailbreak.cards/api/gh/revenue',
  breakToken: `https://api.dexscreener.com/latest/dex/tokens/${BREAK}`,
  cardsToken: `https://api.dexscreener.com/latest/dex/tokens/${CARDS}`,
  cardsRevenue: 'https://api.llama.fi/summary/fees/collector-crypt?dataType=dailyRevenue',
  cardsVolume: 'https://api.llama.fi/summary/dexs/collector-crypt?dataType=dailyVolume'
};

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'grail-break-tracker/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// The most liquid Solana pair for a token on DexScreener.
function bestPair(j) {
  const pairs = (j && j.pairs) || [];
  return pairs
    .filter(p => p.chainId === 'solana')
    .sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
}

// Today's date in US Eastern time (Grail Break's days are Eastern), as YYYY-MM-DD.
const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function computeAll(raw) {
  const gb = raw.grail;
  const bp = bestPair(raw.breakToken);
  const cp = bestPair(raw.cardsToken);
  if (!gb || !gb.daily) throw new Error('Grail Break data missing');
  if (!bp) throw new Error('BREAK price missing');
  if (!cp) throw new Error('CARDS price missing');
  if (!raw.cardsRevenue || !raw.cardsVolume) throw new Error('Collector Crypt data missing');

  const breakPrice = Number(bp.priceUsd);
  const breakCap = Number(bp.marketCap || bp.fdv);
  const cardsCap = Number(cp.marketCap || cp.fdv);

  const today = easternToday();
  const daily = gb.daily.map(d => ({ day: d.day, volume: Number(d.volume), revenue: Number(d.revenue), partial: d.day >= today }));
  const full = daily.filter(d => !d.partial);
  const avg = (ds, f) => ds.reduce((t, d) => t + d[f], 0) / ds.length;

  const row = (key, label, cap, g, n) => ({
    key, label, market_cap: cap, gross_day: g, net_day: n,
    gross_to_cap: g / cap, net_to_cap: n / cap, margin: n / g, cap_to_revenue: cap / (n * 365)
  });

  const ratios = [
    row('cards_30d', 'Collector Crypt, 30 days', cardsCap, Number(raw.cardsVolume.total30d) / 30, Number(raw.cardsRevenue.total30d) / 30),
    row('break_launch', 'Grail Break, since launch', breakCap, avg(full, 'volume'), avg(full, 'revenue')),
    row('break_5d', 'Grail Break, last 5 days', breakCap, avg(full.slice(-5), 'volume'), avg(full.slice(-5), 'revenue')),
    row('break_1d', 'Grail Break, last full day', breakCap, avg(full.slice(-1), 'volume'), avg(full.slice(-1), 'revenue'))
  ];
  const cardsMult = ratios[0].cap_to_revenue;
  ratios.forEach(r => { r.discount_vs_cards = cardsMult / r.cap_to_revenue; });

  const implied = ratios.slice(1).map(r => {
    const cap = r.net_day * 365 * cardsMult;
    return { key: r.key, label: r.label, net_day: r.net_day, implied_cap: cap, upside: cap / r.market_cap, implied_price: breakPrice * cap / r.market_cap };
  });

  const trailing = full.slice(4).map((d, i) => {
    const n = avg(full.slice(i, i + 5), 'revenue');
    return { day: d.day, net_5d: n, cap_to_revenue: breakCap / (n * 365) };
  });

  // Buybacks and burns, oldest first, with a running total of BREAK burned.
  const SOURCE_NAME = { 'Pump graduation boost': 'Pump.fun graduation boost', 'Buy & burn': 'Buy & burn (trading fees)' };
  let runBurned = 0, runUsd = 0;
  const burns = (gb.burns || [])
    .map(b => ({ time: b.time, source: SOURCE_NAME[b.source] || b.source, kind: b.source === 'Buy & burn' ? 'fees' : 'boost', burned: Number(b.burned), usd: Number(b.usd), tx: b.tx }))
    .filter(b => b.time && isFinite(b.burned))
    .sort((a, z) => new Date(a.time) - new Date(z.time))
    .map(b => { runBurned += b.burned; runUsd += b.usd; return { ...b, total_burned: runBurned, total_usd: runUsd }; });
  // Total supply from DexScreener (market cap / price); pump.fun tokens launch with 1B.
  const supply = breakPrice > 0 && isFinite(breakCap / breakPrice) ? breakCap / breakPrice : 1e9;
  const bySource = {};
  burns.forEach(b => { const s = bySource[b.source] || (bySource[b.source] = { source: b.source, kind: b.kind, count: 0, usd: 0, burned: 0 }); s.count++; s.usd += b.usd; s.burned += b.burned; });
  // Buyback USD by Eastern day, to line up with the daily revenue bars.
  const etDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
  const burnDays = {};
  burns.forEach(b => { const d = etDay(b.time); const r = burnDays[d] || (burnDays[d] = { day: d, usd: 0, burned: 0, count: 0 }); r.usd += b.usd; r.burned += b.burned; r.count++; });

  let cv = 0, cr = 0;
  const cumulative = daily.map(d => { cv += d.volume; cr += d.revenue; return { day: d.day, volume: cv, revenue: cr, partial: d.partial }; });

  const hall = gb.hall || {};
  return {
    updated: new Date().toISOString(),
    grailUpdated: gb.updated || null,
    breakPrice, breakCap, cardsCap, supply,
    liquidity: bp.liquidity ? Number(bp.liquidity.usd) : null,
    totals: {
      volume: Number(gb.volume), revenue: Number(gb.revenue),
      sales: gb.sales, sellbacks: gb.sellbacks, users: gb.users, buyers: gb.buyers, breaks_done: gb.breaksDone,
      packs_ripped: hall.count, card_value_pulled: Number(hall.usd),
      buyback_usd: runUsd, buyback_count: burns.length, burned: runBurned, burned_share: runBurned / supply
    },
    ratios, implied, trailing, daily, cumulative,
    products: (gb.products || []).map(p => ({ product: p.k, volume: Number(p.usd), count: p.n })),
    burns, burn_sources: Object.values(bySource), burn_days: Object.values(burnDays).sort((a, z) => a.day < z.day ? -1 : 1)
  };
}

async function handler(req, res) {
  const keys = Object.keys(SOURCES);
  const results = await Promise.allSettled(keys.map(k => getJson(SOURCES[k])));
  const raw = {}, errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') raw[keys[i]] = r.value;
    else errors.push(`${keys[i]}: ${r.reason && r.reason.message}`);
  });
  try {
    const out = computeAll(raw);
    out.errors = errors;
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: e.message, errors });
  }
}

module.exports = handler;
module.exports.computeAll = computeAll;
