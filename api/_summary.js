// Key figures for the daily image and post, derived from getData(). $CARDS on its market cap.
// Files starting with "_" in /api are helpers, not endpoints.

function summarize(D) {
  const basis = (D.cards_basis && D.cards_basis.mc) || { ratios: D.ratios };
  const R = Object.fromEntries(basis.ratios.map(r => [r.key, r]));
  const b = R.break_7d, d1 = R.break_1d, c = R.cards_30d;
  const T = D.totals || {}, A = D.arpu || {};
  const lastFull = (D.daily || []).filter(d => !d.partial).slice(-1)[0] || null;

  let arpuRatio = null, arpuBreak = null, arpuCards = null;
  if (A.cards_reference && A.buyers && A.live_days) {
    const C = A.cards_reference;
    arpuBreak = T.revenue / A.buyers / A.live_days * 365;
    arpuCards = C.gross_profit / C.buyers / C.days * 365;
    arpuRatio = arpuBreak / arpuCards;
  }

  return {
    asOf: D.updated,
    day: lastFull ? lastFull.day : null,
    marketCap: D.breakCap,
    price: D.breakPrice,
    net7: b.net_day,
    vol7: b.gross_day,
    net1: lastFull ? lastFull.revenue : d1 && d1.net_day,
    vol1: lastFull ? lastFull.volume : d1 && d1.gross_day,
    netDays: 1 / b.net_to_cap,                       // days of net revenue to equal market cap
    cardsNetDays: 1 / c.net_to_cap,
    netPerCapRatio: b.net_to_cap / c.net_to_cap,     // net revenue per $ of market cap, BREAK vs CARDS
    volPerCapRatio: b.gross_to_cap / c.gross_to_cap, // volume per $ of market cap, BREAK vs CARDS
    arpuRatio, arpuBreak, arpuCards,
    users: T.users, buyers: T.buyers,
    burnedShare: T.burned_share, buybackUsd: T.buyback_usd,
    totalVolume: T.volume, totalRevenue: T.revenue
  };
}

const usd = v => {
  if (v == null || !isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v).toLocaleString('en-US');
};
const times = v => (v == null || !isFinite(v)) ? '–' : (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + 'x';
const pct = v => (v == null || !isFinite(v)) ? '–' : (v * 100).toFixed(2) + '%';
const days = v => (v == null || !isFinite(v)) ? '–' : (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' days';
const dayLabel = iso => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

// Post text. No links: a URL in the post multiplies the X API price per post. Kept under 280 characters.
function vsCards(r) {
  if (r == null || !isFinite(r)) return '–';
  return r >= 1 ? `${times(r)} higher than $CARDS` : `${times(1 / r)} lower than $CARDS`;
}
function postText(S) {
  const lines = [
    `Grail Break daily metrics${S.day ? ` · ${dayLabel(S.day)}` : ''}`,
    '',
    `Market cap: ${usd(S.marketCap)}`,
    `Net revenue: ${usd(S.net7)}/day (7d)`,
    `Volume: ${usd(S.vol7)}/day (7d)`,
    `Net revenue per $ of market cap: ${vsCards(S.netPerCapRatio)}`,
  ];
  if (S.arpuRatio) lines.push(`Net revenue per buyer: ${vsCards(S.arpuRatio)}`);
  lines.push(`Supply burned: ${pct(S.burnedShare)}`, '', '$BREAK $CARDS · Not financial advice');
  let text = lines.join('\n');
  if (text.length > 280) text = text.replace(' · Not financial advice', ' · NFA');
  return text.slice(0, 280);
}

module.exports = { summarize, postText, fmt: { usd, times, pct, days, dayLabel } };
