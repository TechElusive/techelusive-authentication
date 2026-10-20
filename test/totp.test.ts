import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAuthenticatorAppUrl,
  createTotpSecret,
  decodeBase32,
  encodeBase32,
  timeStepAt,
  totpCodeForTimeStep,
  verifyTotpCode,
} from '@/common/crypto/totp';

// The RFC 6238 test secret is the ASCII text "12345678901234567890".
const rfcSecret = encodeBase32(Buffer.from('12345678901234567890'));

describe('TOTP (authenticator app codes)', () => {
  it('matches the official RFC 6238 test vectors (last 6 digits)', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [unixTime, expectedCode] of vectors) {
      assert.equal(totpCodeForTimeStep(rfcSecret, timeStepAt(unixTime)), expectedCode, `time ${unixTime}`);
    }
  });

  it('round-trips Base32', () => {
    const bytes = Buffer.from('any bytes \x00\xff here');
    assert.deepEqual(decodeBase32(encodeBase32(bytes)), bytes);
    assert.equal(encodeBase32(Buffer.from('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('accepts the current code and one step of clock drift either way', () => {
    const now = 1_800_000_000;
    const step = timeStepAt(now);
    assert.equal(verifyTotpCode(rfcSecret, totpCodeForTimeStep(rfcSecret, step), null, now), step);
    assert.equal(verifyTotpCode(rfcSecret, totpCodeForTimeStep(rfcSecret, step - 1), null, now), step - 1);
    assert.equal(verifyTotpCode(rfcSecret, totpCodeForTimeStep(rfcSecret, step + 1), null, now), step + 1);
    assert.equal(verifyTotpCode(rfcSecret, totpCodeForTimeStep(rfcSecret, step - 2), null, now), null);
  });

  it('refuses a code that was already used (replay)', () => {
    const now = 1_800_000_000;
    const step = timeStepAt(now);
    const code = totpCodeForTimeStep(rfcSecret, step);
    assert.equal(verifyTotpCode(rfcSecret, code, step, now), null);
    assert.equal(verifyTotpCode(rfcSecret, totpCodeForTimeStep(rfcSecret, step - 1), step, now), null);
  });

  it('rejects malformed codes and accepts spaces', () => {
    const now = 1_800_000_000;
    const code = totpCodeForTimeStep(rfcSecret, timeStepAt(now));
    assert.ok(verifyTotpCode(rfcSecret, `${code.slice(0, 3)} ${code.slice(3)}`, null, now));
    for (const bad of ['', '12345', '1234567', 'abcdef']) assert.equal(verifyTotpCode(rfcSecret, bad, null, now), null);
  });

  it('creates 160-bit secrets and a scannable link', () => {
    const secret = createTotpSecret();
    assert.equal(decodeBase32(secret).length, 20);
    const url = buildAuthenticatorAppUrl(secret, 'riya@example.com', 'RideMate');
    assert.match(url, /^otpauth:\/\/totp\/RideMate%3Ariya%40example\.com\?secret=[A-Z2-7]+&issuer=RideMate/);
  });
});
