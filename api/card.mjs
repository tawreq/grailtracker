// GET /api/card: a 1200x675 PNG of the day's key GB Dash metrics, from live data.
// Used for the daily X post and as the share preview image for gbdash.app.
import { ImageResponse } from '@vercel/og';
import data from './data.js';
import summary from './_summary.js';

const { summarize, fmt } = summary;
const C = { night: '#131735', vault: '#1b2050', rail: '#2d3470', ink: '#eef0ff', haze: '#9ea5d6', cyan: '#7fe3f0', violet: '#b69cff', gold: '#f2c66d' };

// Minimal element builder (the image renderer takes React-style element objects).
const h = (type, style, ...children) => ({ type, key: null, props: { style: { display: 'flex', ...style }, children: children.flat().filter(c => c !== null && c !== false) } });

function tile(label, value, sub, accent) {
  return h('div', { flexDirection: 'column', flex: 1, background: C.vault, border: `2px solid ${accent ? C.gold : C.rail}`, borderRadius: 20, padding: '18px 22px' },
    h('div', { fontSize: 20, color: C.haze, letterSpacing: 1, textTransform: 'uppercase' }, label),
    h('div', { fontSize: 46, fontWeight: 700, color: accent ? C.gold : C.ink, marginTop: 4, lineHeight: 1.05 }, value),
    sub ? h('div', { fontSize: 20, color: C.haze, marginTop: 6 }, sub) : null);
}

export function cardElement(S) {
  const f = fmt;
  return h('div', { width: 1200, height: 675, flexDirection: 'column', background: C.night, color: C.ink, padding: '40px 48px', fontFamily: 'sans-serif' },
    h('div', { justifyContent: 'space-between', alignItems: 'baseline' },
      h('div', { alignItems: 'baseline' },
        h('div', { fontSize: 34, fontWeight: 700 }, 'GB Dash'),
        h('div', { fontSize: 28, color: C.haze, marginLeft: 16 }, `Grail Break daily metrics${S.day ? ' · ' + f.dayLabel(S.day) : ''}`)),
      h('div', { fontSize: 24, color: C.haze }, '$BREAK vs $CARDS')),
    h('div', { alignItems: 'baseline', marginTop: 26 },
      h('div', { fontSize: 104, fontWeight: 700, color: C.gold, lineHeight: 1 }, f.times(S.netPerCapRatio)),
      h('div', { fontSize: 36, marginLeft: 22, lineHeight: 1.15, maxWidth: 760 }, 'more net revenue per dollar of market cap than $CARDS')),
    h('div', { marginTop: 26, gap: 16 },
      tile('Market cap', f.usd(S.marketCap), `Price $${S.price ? Number(S.price).toPrecision(3) : '–'}`),
      tile('Net revenue / day', f.usd(S.net7), `Last 7 days · last full day ${f.usd(S.net1)}`),
      tile('Volume / day', f.usd(S.vol7), 'Last 7 days')),
    h('div', { marginTop: 16, gap: 16 },
      tile('Net revenue per buyer', S.arpuRatio ? f.times(S.arpuRatio) + ' more' : '–', S.arpuBreak ? `than $CARDS (${f.usd(S.arpuBreak)} vs ${f.usd(S.arpuCards)})` : null, true),
      tile('Days to earn market cap', f.days(S.netDays), `$CARDS: ${f.days(S.cardsNetDays)}`),
      tile('Supply burned', f.pct(S.burnedShare), `${f.usd(S.buybackUsd)} bought back`)),
    h('div', { marginTop: 'auto', justifyContent: 'space-between', fontSize: 20, color: C.haze },
      h('div', {}, 'gbdash.app'),
      h('div', {}, 'Data: Grail Break, DexScreener, DefiLlama · $CARDS on market cap · Not financial advice')));
}

// PNG bytes for a given summary.
export async function cardPng(S) {
  const img = new ImageResponse(cardElement(S), { width: 1200, height: 675 });
  return Buffer.from(await img.arrayBuffer());
}

export async function renderCard() {
  const D = await data.getData();
  return new ImageResponse(cardElement(summarize(D)), { width: 1200, height: 675 });
}

export default async function handler(req, res) {
  try {
    const img = await renderCard();
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).send(buf);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: e.message });
  }
}
