// node --import ./test/register.mjs test/security.test.mjs
import assert from 'node:assert/strict';
import { codeAt, stepAt, matchCode, newSecret, newRecoveryCodes, matchRecoveryCode, otpauthUrl, qrSvg } from '../lib/admin/totp.js';
import { passwordProblem, deviceName } from '../lib/admin/auth.js';
import { clientIp, ipHint } from '../lib/security.js';

// TOTP: RFC 6238 appendix B vectors (SHA-1, secret "12345678901234567890"), last six digits
const S = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
for (const [t, want] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
  assert.equal(codeAt(S, stepAt(t * 1000)), want, `t=${t}`);
}
const now = 1234567890 * 1000;
assert.equal(matchCode(S, '005924', 0, now), stepAt(now));
assert.equal(matchCode(S, '005 924', 0, now), stepAt(now), 'spaces ignored');
assert.equal(matchCode(S, '005924', stepAt(now), now), null, 'a used code is refused');
assert.equal(matchCode(S, codeAt(S, stepAt(now) - 1), 0, now), stepAt(now) - 1, 'one step of drift');
assert.equal(matchCode(S, codeAt(S, stepAt(now) + 2), 0, now), null, 'two steps ahead refused');
assert.equal(matchCode(S, '12345', 0, now), null);
assert.match(newSecret(), /^[A-Z2-7]{32}$/);
const { codes, hashes } = newRecoveryCodes();
assert.equal(new Set(codes).size, 8);
assert.equal(matchRecoveryCode(hashes, codes[3].toUpperCase()), 3);
assert.equal(matchRecoveryCode(hashes, codes[3].replace('-', '')), 3);
assert.equal(matchRecoveryCode(hashes, 'aaaaa-bbbbb'), -1);
assert.match(otpauthUrl('ABC', 'yarden'), /^otpauth:\/\/totp\/Yarden%20Kerem%3Ayarden\?secret=ABC&issuer=Yarden%20Kerem/);
assert.match(qrSvg(otpauthUrl(newSecret(), 'yarden')), /^<svg[\s\S]*<\/svg>$/);

// Passwords
assert.match(passwordProblem('short'), /10/);
for (const pw of ['1234567890', 'aaaaaaaaaaaa', 'password123!', 'Qwertyuiop1', 'YardenKerem2026', 'ירדןכרם12345']) assert.ok(passwordProblem(pw), pw);
assert.match(passwordProblem('my-yarden99-site', { username: 'yarden99' }), /שם המשתמש/);
assert.equal(passwordProblem('גשם של אחר הצהריים 7'), null);
assert.equal(passwordProblem('correct-horse-9'), null);

// Addresses: the proxy's hop, never the client's claim
const req = (h) => ({ headers: new Headers(h) });
assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 84.229.10.20' })), '84.229.10.20');
assert.equal(clientIp(req({ 'x-real-ip': '84.229.10.20', 'x-forwarded-for': '6.6.6.6' })), '84.229.10.20');
assert.equal(ipHint(req({ 'x-real-ip': '84.229.10.20' })), '84.229.x.x');
assert.equal(ipHint(req({ 'x-real-ip': '2a02:6680:1101:aaaa::1' })), '2a02:6680:1101:…');
assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari ב־iPhone');
assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36'), 'Chrome ב־Windows');
console.log('security ok');
