// Serverless function: renders the dashboard's report layout in headless Chrome and returns it as
// an A4 landscape PDF. Runs on Vercel at /api/report.
//
// The page builds the report itself (see preparePrint() and the print styles in index.html), so
// this file only loads the live page, switches it into report mode and prints it. Doing it here
// rather than in the visitor's browser means every device gets the same landscape file: Safari and
// iOS ignore a page's requested orientation when printing.
//
// Query: basis=mc|fdv (how $CARDS is valued, matching the page's switch), tz=<IANA zone> (for the
// "generated" timestamp in the masthead).
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// The report is laid out at 1660px and printed onto A4 landscape with 6mm margins:
// (297mm - 12mm) at 96px/in = 1077px, so 1077 / 1660 = 0.649.
const LAYOUT_WIDTH = 1660;
const MARGIN_MM = 6;
const SCALE = ((297 - 2 * MARGIN_MM) / 25.4 * 96) / LAYOUT_WIDTH;

const validZone = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export default async function handler(req, res) {
  const q = req.query || {};
  const basis = q.basis === 'fdv' ? 'fdv' : 'mc';
  const tz = typeof q.tz === 'string' && validZone(q.tz) ? q.tz : 'UTC';
  // Render the public site. Deployment URLs (*.vercel.app) sit behind Vercel's login, so always
  // use a custom domain, preferring the one the request came in on.
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const origin = process.env.REPORT_ORIGIN
    || (/(^|\.)(gbdash\.app|graildash\.com)$/.test(host) ? `https://${host}` : 'https://gbdash.app');

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: LAYOUT_WIDTH + 70, height: 1223 }
    });
    const page = await browser.newPage();
    await page.emulateTimezone(tz);
    await page.goto(origin + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    // The PDF button is enabled once live data has loaded and the charts have been drawn.
    await page.waitForFunction(() => { const b = document.getElementById('pdfbtn'); return b && !b.disabled; }, { timeout: 25000 });
    const date = await page.evaluate(b => {
      if (b !== CARDS_BASIS) { CARDS_BASIS = b; render(); }
      preparePrint();
      return document.title.replace('Grail Dash report ', '');
    }, basis);
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4', landscape: true, scale: SCALE, printBackground: true, preferCSSPageSize: false,
      margin: { top: MARGIN_MM + 'mm', bottom: MARGIN_MM + 'mm', left: MARGIN_MM + 'mm', right: MARGIN_MM + 'mm' }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Grail Dash report ${date}.pdf"`);
    // Same freshness as the data feed: one rendering serves everyone for 5 minutes.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    console.error('report failed', e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'Could not generate the report: ' + e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
