// node --import ./test/register.mjs test/shop.test.mjs
import assert from 'node:assert/strict';
import { shekels, parseShekels, installmentsText, linkState, siteBase, buySectionHtml } from '../lib/shop.js';
import { parseResult } from '../lib/cardcom.js';

assert.equal(shekels(180000), '1,800');
assert.equal(shekels(35050), '350.50');
assert.equal(parseShekels('1,800'), 180000);
assert.equal(parseShekels('350.5'), 35050);
assert.equal(parseShekels('₪ 99'), 9900);
for (const bad of ['', 'abc', '-5', '1.234', '1e3']) assert.equal(parseShekels(bad), null, bad);
assert.equal(installmentsText(180000, 3), 'אפשר לחלק עד 3 תשלומים של 600 ₪');
assert.equal(installmentsText(35000, 1), 'תשלום אחד');

// Payment links: usable, switched off, expired, used up
const link = { active: true, expires_at: null, max_uses: 1 };
assert.equal(linkState(link, 0).ok, true);
assert.equal(linkState(link, 1).reason, 'used');
assert.equal(linkState({ ...link, active: false }).reason, 'inactive');
assert.equal(linkState({ ...link, expires_at: '2020-01-01T00:00:00Z' }).reason, 'expired');
assert.equal(linkState(null).reason, 'not_found');

// Cardcom's result: approved only when both the call and the transaction say 0
const ok = parseResult({ ResponseCode: 0, ReturnValue: 'o1', TranzactionInfo: { ResponseCode: 0, Amount: 1800, ApprovalNumber: '0123', Last4CardDigits: '4580', NumOfPayments: 3, CardOwnerName: 'דנה' }, DocumentInfo: { DocumentNumber: 1001 } });
assert.deepEqual([ok.approved, ok.returnValue, ok.amount, ok.approvalNumber, ok.last4, ok.numPayments, ok.cardOwnerName, ok.documentNumber], [true, 'o1', 1800, '0123', '4580', 3, 'דנה', 1001]);
assert.equal(parseResult({ ResponseCode: 0, TranzactionInfo: { ResponseCode: 33 } }).approved, false);
assert.equal(parseResult({ ResponseCode: 700 }).approved, false);
assert.equal(parseResult({ responseCode: 0, tranzactionInfo: { responseCode: 0, amount: 5 } }).amount, 5, 'lowercase variant');

// Where Cardcom returns and posts: this site's own addresses only
const req = (url, h = {}) => ({ url, headers: new Headers(h) });
assert.equal(siteBase(req('http://localhost:3000/api/checkout/', { host: 'localhost:3000' })), 'http://localhost:3000');
assert.equal(siteBase(req('http://127.0.0.1:46001/api/checkout/', { host: 'yarden.to-web.co.il' })), 'https://yarden.to-web.co.il');
assert.equal(siteBase(req('http://127.0.0.1:46001/api/checkout/', { host: 'www.yardenkerem.co.il' })), 'https://www.yardenkerem.co.il');
assert.equal(siteBase(req('http://127.0.0.1:46001/api/checkout/', { host: 'evil.example' })), 'https://www.yardenkerem.co.il');

// No buy button while Cardcom isn't connected
assert.equal(buySectionHtml([{ slug: 'p-1', title: 'x', price_agorot: 100, max_payments: 1 }]), '');
process.env.CARDCOM_TERMINAL_NUMBER = '1000';
process.env.CARDCOM_API_NAME = 'test';
assert.match(buySectionHtml([{ slug: 'p-1', title: 'קורס <b>', description: '', price_agorot: 180000, max_payments: 3 }]), /id="buy"[\s\S]*קורס &lt;b&gt;[\s\S]*1,800 ₪[\s\S]*data-checkout="p-1"/);
console.log('shop ok');
