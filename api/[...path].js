// Vercel function: forwards /api/* to the live PMC API.
// Set API_BASE in Vercel → Settings → Environment Variables (e.g. https://pmcyellowpages.com)
const BASE = (process.env.API_BASE || 'https://pmcyellowpages.com').replace(/\/+$/, '');

module.exports = async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = { 'User-Agent': 'Mozilla/5.0 (PMC website proxy)', Accept: 'application/json' };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    const hasBody = !['GET', 'HEAD'].includes(req.method) && body.length;
    const r = await fetch(BASE + req.url, { method: req.method, headers, body: hasBody ? body : undefined, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = r.status;
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: 'Proxy error: ' + e.message }));
  }
};
