// Daily X post: renders the metrics card and posts it with a short summary.
// Triggered by the Vercel cron in vercel.json. Needs these environment variables in Vercel:
//   CRON_SECRET                         any long random string (Vercel sends it with cron calls)
//   X_API_KEY, X_API_SECRET             the X app's consumer key and secret
//   X_ACCESS_TOKEN, X_ACCESS_SECRET     access token and secret for the posting account (read and write)
// GET /api/post-daily?dry=1 returns the post text without posting (no secret needed).
import crypto from 'crypto';
import data from './data.js';
import summary from './_summary.js';
import { cardPng } from './card.mjs';

const { summarize, postText } = summary;
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// OAuth 1.0a header (HMAC-SHA1). JSON and multipart bodies are not part of the signature.
export function oauthHeader(method, url, keys, bodyParams = {}, fixed = {}) {
  const o = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: fixed.nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed.timestamp || Math.floor(Date.now() / 1000).toString(),
    oauth_token: keys.accessToken,
    oauth_version: '1.0'
  };
  const u = new URL(url);
  const params = { ...o, ...bodyParams };
  u.searchParams.forEach((v, k) => { params[k] = v; });
  const base = [method.toUpperCase(), enc(u.origin + u.pathname),
    enc(Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join('&'))].join('&');
  o.oauth_signature = crypto.createHmac('sha1', `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(o).sort().map(k => `${enc(k)}="${enc(o[k])}"`).join(', ');
}

async function xFetch(method, url, keys, init = {}) {
  const r = await fetch(url, { method, ...init, headers: { ...(init.headers || {}), Authorization: oauthHeader(method, url, keys) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`X API ${r.status} on ${new URL(url).pathname}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function uploadImage(png, keys) {
  const form = new FormData();
  form.append('media', new Blob([png], { type: 'image/png' }), 'gbdash.png');
  form.append('media_category', 'tweet_image');
  const res = await xFetch('POST', 'https://api.x.com/2/media/upload', keys, { body: form });
  const id = res && res.data && (res.data.id || res.data.media_id_string) || res.media_id_string;
  if (!id) throw new Error('X media upload returned no id: ' + JSON.stringify(res).slice(0, 300));
  return String(id);
}

async function createPost(text, mediaId, keys) {
  return xFetch('POST', 'https://api.x.com/2/tweets', keys, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } })
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const dry = req.query && (req.query.dry === '1' || req.query.dry === 'true');
  try {
    if (!dry) {
      const secret = process.env.CRON_SECRET;
      if (!secret) return res.status(500).json({ posted: false, error: 'CRON_SECRET is not set in Vercel.' });
      if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ posted: false, error: 'Unauthorized' });
    }
    const D = await data.getData();
    const S = summarize(D);
    const text = postText(S);
    if (dry) return res.status(200).json({ posted: false, dry: true, text, length: text.length, sourceErrors: D.errors || [] });

    const keys = { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET };
    const missing = Object.entries({ X_API_KEY: keys.apiKey, X_API_SECRET: keys.apiSecret, X_ACCESS_TOKEN: keys.accessToken, X_ACCESS_SECRET: keys.accessSecret }).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) return res.status(200).json({ posted: false, skipped: `Missing in Vercel: ${missing.join(', ')}`, text });
    if (D.errors && D.errors.length) return res.status(200).json({ posted: false, skipped: 'A data source failed; not posting partial figures.', sourceErrors: D.errors });

    const png = await cardPng(S);
    const mediaId = await uploadImage(png, keys);
    const post = await createPost(text, mediaId, keys);
    return res.status(200).json({ posted: true, id: post && post.data && post.data.id, text });
  } catch (e) {
    console.error('post-daily failed:', e);
    return res.status(502).json({ posted: false, error: e.message });
  }
}
