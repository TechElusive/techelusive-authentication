import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';
import { publicKeyFromJwk, signJwt, verifyJwt } from '@/common/crypto/jwt';

function createEcKey(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyId, privateKey, publicKey: publicKeyFromJwk(publicKey.export({ format: 'jwk' })) };
}

const ourKey = createEcKey('key-1');
const strangerKey = createEcKey('key-2');
const findOurKey = (keyId: string) => (keyId === 'key-1' ? ourKey.publicKey : undefined);
const now = 1_800_000_000;
const rules = {
  allowedAlgorithm: 'ES256' as const,
  expectedIssuers: ['https://api.test'],
  expectedAudiences: ['https://api.test'],
  expectedTokenType: 'at+jwt',
  currentTimeSeconds: now,
};
const claims = { iss: 'https://api.test', aud: 'https://api.test', sub: 'user-1', iat: now, exp: now + 600 };

describe('JWT (ES256, our tokens)', () => {
  it('accepts a valid token', () => {
    assert.equal(verifyJwt(signJwt(claims, ourKey, 'at+jwt'), findOurKey, rules)?.sub, 'user-1');
  });

  it('rejects a token from an unknown key and a forged signature', () => {
    assert.equal(verifyJwt(signJwt(claims, strangerKey, 'at+jwt'), findOurKey, rules), null);
    const forged = signJwt(claims, { keyId: 'key-1', privateKey: strangerKey.privateKey }, 'at+jwt');
    assert.equal(verifyJwt(forged, findOurKey, rules), null);
  });

  it('rejects a changed payload', () => {
    const [header, , signature] = signJwt(claims, ourKey, 'at+jwt').split('.');
    const changedPayload = Buffer.from(JSON.stringify({ ...claims, sub: 'admin' })).toString('base64url');
    assert.equal(verifyJwt(`${header}.${changedPayload}.${signature}`, findOurKey, rules), null);
  });

  it('rejects "none", HS256 and RS256 when ES256 is expected', () => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    for (const alg of ['none', 'HS256', 'RS256']) {
      const header = Buffer.from(JSON.stringify({ alg, typ: 'at+jwt', kid: 'key-1' })).toString('base64url');
      assert.equal(verifyJwt(`${header}.${payload}.`, findOurKey, rules), null);
    }
  });

  it('rejects a different token type, expired tokens, wrong issuer and wrong audience', () => {
    assert.equal(verifyJwt(signJwt(claims, ourKey, 'JWT'), findOurKey, rules), null);
    assert.equal(verifyJwt(signJwt({ ...claims, exp: now - 60 }, ourKey, 'at+jwt'), findOurKey, rules), null);
    assert.equal(verifyJwt(signJwt({ ...claims, exp: undefined }, ourKey, 'at+jwt'), findOurKey, rules), null);
    assert.equal(verifyJwt(signJwt({ ...claims, iss: 'https://evil' }, ourKey, 'at+jwt'), findOurKey, rules), null);
    assert.equal(verifyJwt(signJwt({ ...claims, aud: 'other' }, ourKey, 'at+jwt'), findOurKey, rules), null);
  });

  it('allows a small clock difference and never throws on garbage', () => {
    assert.ok(verifyJwt(signJwt({ ...claims, exp: now - 10 }, ourKey, 'at+jwt'), findOurKey, rules));
    for (const garbage of ['', 'a.b', 'a.b.c.d', '!!.!!.!!', 'e30.e30.e30']) assert.equal(verifyJwt(garbage, findOurKey, rules), null);
  });
});

describe('JWT (RS256, Google and Apple tokens)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const providerKey = publicKeyFromJwk({ ...publicKey.export({ format: 'jwk' }), kty: 'RSA' });
  const findProviderKey = (keyId: string) => (keyId === 'google-1' ? providerKey : undefined);
  const providerRules = {
    allowedAlgorithm: 'RS256' as const,
    expectedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
    expectedAudiences: ['my-client-id.apps.googleusercontent.com'],
    currentTimeSeconds: now,
  };

  function signRs256(payload: object, keyId = 'google-1') {
    const body = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId, typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return `${body}.${sign('sha256', Buffer.from(body), privateKey).toString('base64url')}`;
  }

  const googleClaims = { iss: 'accounts.google.com', aud: 'my-client-id.apps.googleusercontent.com', sub: '1234', email: 'a@gmail.com', iat: now, exp: now + 3600 };

  it('accepts a valid provider token', () => {
    assert.equal(verifyJwt(signRs256(googleClaims), findProviderKey, providerRules)?.sub, '1234');
  });

  it('rejects a token for another app (wrong audience) and unknown keys', () => {
    assert.equal(verifyJwt(signRs256({ ...googleClaims, aud: 'someone-else' }), findProviderKey, providerRules), null);
    assert.equal(verifyJwt(signRs256(googleClaims, 'unknown'), findProviderKey, providerRules), null);
  });

  it('does not accept an ES256 token where RS256 is required', () => {
    assert.equal(verifyJwt(signJwt(googleClaims, ourKey, 'JWT'), findOurKey, providerRules), null);
  });
});
