/**
 * A stand-in for Cardcom's Low Profile API (v11), for testing the whole
 * purchase locally: node test/cardcom-mock.mjs   (port 4010)
 * then run the site with CARDCOM_BASE_URL=http://localhost:4010/api/v11,
 * CARDCOM_TERMINAL_NUMBER=1000 and CARDCOM_API_NAME=test.
 *
 *   POST /api/v11/LowProfile/Create       → a payment page at /pay/<id>
 *   GET  /pay/<id>                        → "pay" / "decline" buttons; either
 *                                           posts the webhook, then redirects
 *   POST /api/v11/LowProfile/GetLpResult  → the stored result
 *   GET  /last                            → the last Create request (for tests)
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const pages = new Map();
let last = null;
let invoice = 1000;

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4010');
  if (req.method === 'POST' && url.pathname === '/api/v11/LowProfile/Create') {
    const p = await readJson(req);
    last = p;
    if (!p.TerminalNumber || !p.ApiName) return json(res, 200, { ResponseCode: 5, Description: 'missing terminal' });
    const id = randomUUID();
    pages.set(id, { payload: p, result: null });
    return json(res, 200, { ResponseCode: 0, Description: 'OK', LowProfileId: id, Url: `http://localhost:4010/pay/${id}` });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/pay/')) {
    const id = url.pathname.split('/')[2];
    const page = pages.get(id);
    if (!page) return json(res, 404, {});
    const choice = url.searchParams.get('do');
    if (!choice) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Cardcom (mock)</title><h1>${page.payload.ProductName}</h1>
<p id="amount">${page.payload.Amount}</p><p id="max">${page.payload.MaxNumOfPayments || 1}</p>
<a id="pay" href="?do=pay">Pay</a> <a id="decline" href="?do=decline">Decline</a>`);
    }
    const ok = choice === 'pay';
    page.result = ok
      ? { ResponseCode: 0, Description: 'OK', ReturnValue: page.payload.ReturnValue, LowProfileId: id,
          TranzactionInfo: { ResponseCode: 0, TranzactionId: 555000 + pages.size, ApprovalNumber: '0123456', Last4CardDigits: '4580',
            NumOfPayments: Math.min(3, page.payload.MaxNumOfPayments || 1), Amount: page.payload.Amount,
            CardOwnerName: 'בעלת הכרטיס', CardOwnerEmail: 'card-owner@example.com', CardOwnerPhone: '050-0000000' },
          DocumentInfo: page.payload.Document ? { DocumentNumber: ++invoice, DocumentType: page.payload.Document.DocumentTypeToCreate } : undefined }
      : { ResponseCode: 700, Description: 'Declined (mock)', ReturnValue: page.payload.ReturnValue, LowProfileId: id };
    // Cardcom notifies the site server to server, then sends the buyer back
    await fetch(page.payload.WebHookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ LowProfileId: id, ResponseCode: page.result.ResponseCode }) })
      .catch((e) => console.error('webhook failed', e.message));
    res.writeHead(302, { Location: ok ? page.payload.SuccessRedirectUrl : page.payload.FailedRedirectUrl });
    return res.end();
  }
  if (req.method === 'POST' && url.pathname === '/api/v11/LowProfile/GetLpResult') {
    const p = await readJson(req);
    const page = pages.get(p.LowProfileId);
    if (!page || !page.result) return json(res, 200, { ResponseCode: 1, Description: 'no result' });
    return json(res, 200, page.result);
  }
  if (url.pathname === '/last') return json(res, 200, last || {});
  json(res, 404, {});
}).listen(4010, () => console.log('cardcom mock on http://localhost:4010'));
