// Records the current user and buyer totals for the user growth history (see _growth.js).
// Visits to the page record readings too; this daily cron (vercel.json) makes sure every Eastern
// day gets a reading near its end even when nobody visits. Runs on Vercel at /api/snapshot.
const data = require('./data.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const D = await data.getData();
    const G = D.growth || {};
    res.status(200).json({ ok: !G.error, users: G.users, buyers: G.buyers, days_tracked: G.days_tracked, error: G.error || null });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
};
