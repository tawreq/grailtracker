# Grail Break Ratio Tracker

A one-page site tracking Grail Break ($BREAK) valuation ratios against Collector Crypt ($CARDS).

- `index.html` - the page. It loads `/api/data` and refreshes every 5 minutes.
- `api/data.js` - a serverless function that fetches Grail Break's platform numbers, DexScreener prices and DefiLlama's Collector Crypt data, then computes the ratios. Responses are cached for 5 minutes.

Deploy on Vercel: import this folder as a project, no build settings needed.
