// User growth: new registered users and new buyers per day.
// Files starting with "_" in /api are helpers, not endpoints.
//
// Grail Break only publishes running totals of users and buyers, with no history. So every time
// the dashboard fetches fresh data it records the totals in a small private Vercel Blob file, one
// entry per US Eastern day (Grail Break's days are Eastern) holding the day's first and latest
// reading. New users on a day = that day's latest total minus the previous day's latest total.
//
// Needs BLOB_READ_WRITE_TOKEN (set automatically by the connected "grailtracker-history" Blob
// store). Without it, or if Blob fails, the page still works: growth falls back to the
// since-launch average and says why.

const { get, head, put } = require('@vercel/blob');

const PATH = 'history/users.json';
const DAY_MS = 864e5;
const etDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY_MS);

async function load() {
  const r = await get(PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { history: { v: 1, days: {} }, etag: null };
  const history = await new Response(r.stream).json();
  // Reads can return a weak ETag (W/"abc") but writes only match the strong form ("abc").
  const etag = r.blob.etag.replace(/^W\//, '');
  if (!history || typeof history.days !== 'object') return { history: { v: 1, days: {} }, etag };
  return { history, etag };
}

// Adds a reading to the history. Returns true if the file needs saving (a new day, or the totals changed).
function addReading(history, obs) {
  const d = etDay(obs.t), e = history.days[d];
  if (!e) { history.days[d] = { open: obs, close: obs }; return true; }
  if (e.close.users === obs.users && e.close.buyers === obs.buyers) return false;
  // Totals only grow; ignore a reading that goes backwards (a stale cached response).
  if (obs.users < e.close.users || obs.buyers < e.close.buyers) return false;
  e.close = obs;
  return true;
}

async function save(history, etag) {
  const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 };
  if (etag) opts.ifMatch = etag;
  await put(PATH, JSON.stringify(history), opts);
}

const isConflict = e => /precondition|etag|412/i.test(String(e && e.message));
const SAVE_ATTEMPTS = 3;

// Loads the latest history, adds the reading and saves it. If another request saved first the
// write is rejected, so start again from what that request saved. A reading is never dropped
// quietly: after repeated rejections it overwrites the file, and the conflict is logged.
async function record(obs) {
  let last;
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    last = await load();
    if (!addReading(last.history, obs)) return last.history;
    try { await save(last.history, last.etag); return last.history; }
    catch (e) {
      if (!isConflict(e)) throw e;
      const current = await head(PATH).then(b => b.etag, () => 'unknown');
      console.warn('growth history save conflict', { attempt, read_etag: last.etag, current_etag: current });
      if (attempt < SAVE_ATTEMPTS) await new Promise(r => setTimeout(r, 150 * attempt));
    }
  }
  console.error('growth history: overwriting after repeated save conflicts');
  await save(last.history, null);
  return last.history;
}

// Turns the history into per-day rows from the first tracked day to today.
//   basis 'full'   - the day has a reading and so does the day before: an exact daily count.
//   basis 'start'  - first tracked day: counted from the first reading, so it understates that day.
//   basis 'spread' - days with no readings in between: the change across the gap, shared evenly.
function dailyRows(history, today) {
  const keys = Object.keys(history.days).sort();
  if (!keys.length) return [];
  const rows = [];
  let prevKey = null;
  for (const k of keys) {
    const e = history.days[k];
    if (!prevKey) {
      rows.push({ day: k, new_users: e.close.users - e.open.users, new_buyers: e.close.buyers - e.open.buyers, basis: 'start', from: e.open.t });
    } else {
      const gap = daysBetween(prevKey, k), p = history.days[prevKey].close;
      const nu = e.close.users - p.users, nb = e.close.buyers - p.buyers;
      if (gap === 1) rows.push({ day: k, new_users: nu, new_buyers: nb, basis: 'full' });
      else for (let i = 1; i <= gap; i++) rows.push({ day: addDays(prevKey, i), new_users: nu / gap, new_buyers: nb / gap, basis: 'spread', span: gap });
    }
    prevKey = k;
  }
  // Days after the last reading up to today (no visits yet today): nothing recorded.
  for (let d = addDays(prevKey, 1); d <= today; d = addDays(d, 1)) rows.push({ day: d, new_users: null, new_buyers: null, basis: 'none' });
  rows.forEach(r => { r.partial = r.day >= today; const e = history.days[r.day]; if (e) { r.users = e.close.users; r.buyers = e.close.buyers; r.as_of = e.close.t; } });
  return rows;
}

function summarize(history, { users, buyers, live_days, today }) {
  const rows = history ? dailyRows(history, today) : [];
  const full = rows.filter(r => !r.partial && r.new_users !== null);
  const measured = full.filter(r => r.basis !== 'spread');
  const exact = full.filter(r => r.basis === 'full');
  const last7 = full.slice(-7);
  const avg = (a, f) => a.length ? a.reduce((t, r) => t + r[f], 0) / a.length : null;
  const todayRow = rows.find(r => r.day === today) || null;
  const keys = history ? Object.keys(history.days).sort() : [];
  return {
    users, buyers,
    tracking_since: keys.length ? history.days[keys[0]].open.t : null,
    days_tracked: keys.length,
    // Since-launch averages need no history: today's total spread over the days $BREAK has been live.
    launch_avg_users: users / live_days,
    launch_avg_buyers: buyers / live_days,
    today: todayRow,
    last_full: measured.length ? measured[measured.length - 1] : null,
    avg7_users: avg(last7, 'new_users'),
    avg7_buyers: avg(last7, 'new_buyers'),
    avg7_days: last7.length,
    avg7_exact: last7.length > 0 && last7.every(r => r.basis === 'full'),
    exact_days: exact.length,
    rows
  };
}

// Records the current totals and returns the growth summary. Never throws.
async function trackGrowth({ users, buyers, live_days, today }) {
  const base = { users, buyers, live_days, today };
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { ...summarize(null, base), error: 'History storage is not configured.' };
  if (!(users > 0)) return { ...summarize(null, base), error: 'No user count in the source data.' };
  try {
    const history = await record({ t: new Date().toISOString(), users, buyers });
    return summarize(history, base);
  } catch (e) {
    console.error('growth history failed:', e);
    return { ...summarize(null, base), error: 'History storage is unavailable right now.' };
  }
}

module.exports = { trackGrowth, dailyRows, summarize, addReading, etDay };
