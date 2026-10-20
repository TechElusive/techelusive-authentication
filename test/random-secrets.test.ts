import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  constantTimeEquals,
  createBackupCode,
  createNumericCode,
  createRandomToken,
  hasRandomTokenFormat,
  hashShortCode,
  normalizeBackupCode,
  sha256Hex,
} from '@/common/crypto/random-secrets';

describe('random secrets', () => {
  it('creates prefixed tokens and stores only their hash', () => {
    const { plainToken, tokenHash } = createRandomToken('rt');
    assert.match(plainToken, /^rt_[A-Za-z0-9_-]{43}$/);
    assert.equal(tokenHash, sha256Hex(plainToken));
    assert.ok(hasRandomTokenFormat(plainToken, 'rt'));
    assert.ok(!hasRandomTokenFormat(plainToken, 'ev'));
    for (const bad of ['rt_short', 42, null, undefined, `rt_${'a'.repeat(44)}`]) assert.ok(!hasRandomTokenFormat(bad, 'rt'));
  });

  it('never repeats tokens', () => {
    assert.equal(new Set(Array.from({ length: 2000 }, () => createRandomToken('rt').plainToken)).size, 2000);
  });

  it('creates numeric codes of the right length with every digit possible', () => {
    const codes = Array.from({ length: 2000 }, () => createNumericCode(6));
    assert.ok(codes.every((code) => /^\d{6}$/.test(code)));
    assert.equal(new Set(codes.join('')).size, 10);
  });

  it('salts short-code hashes', () => {
    assert.notEqual(hashShortCode('123456', 'salt-a'), hashShortCode('123456', 'salt-b'));
    assert.equal(hashShortCode('123456', 'salt-a'), hashShortCode('123456', 'salt-a'));
  });

  it('creates readable backup codes and accepts them typed in any style', () => {
    const code = createBackupCode();
    assert.match(code, /^[a-hj-km-np-z2-9]{8}$/);
    assert.equal(normalizeBackupCode(`${code.slice(0, 4).toUpperCase()}-${code.slice(4)}`), code);
  });

  it('compares in constant time correctly', () => {
    assert.ok(constantTimeEquals('abc', 'abc'));
    assert.ok(!constantTimeEquals('abc', 'abd'));
    assert.ok(!constantTimeEquals('abc', 'abcd'));
  });
});
