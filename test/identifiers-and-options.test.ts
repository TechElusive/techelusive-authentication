import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertValidAuthOptions } from '@/auth-options.validation';
import {
  isEmailDomainAllowed,
  isPhoneCountryAllowed,
  maskEmail,
  maskPhoneNumber,
  normalizeEmail,
  normalizePhoneNumber,
} from '@/common/identifiers';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => assert.equal(normalizeEmail('  Asha@Mail.COM '), 'asha@mail.com'));
  for (const bad of ['', 'no-at-sign', 'a@b', 'a b@c.com', 42, null]) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.throws(() => normalizeEmail(bad), { code: 'INVALID_EMAIL' }));
  }
});

describe('normalizePhoneNumber', () => {
  it('removes spaces, dashes and brackets', () => assert.equal(normalizePhoneNumber('+91 (98765) 432-10'), '+919876543210'));
  for (const bad of ['9876543210', '+0123456789', '+91abc', '+1234']) {
    it(`rejects ${bad}`, () => assert.throws(() => normalizePhoneNumber(bad), { code: 'INVALID_PHONE' }));
  }
});

describe('allow lists', () => {
  it('any domain when the list is empty', () => assert.equal(isEmailDomainAllowed('a@x.com', []), true));
  it('matches the exact domain only', () => {
    assert.equal(isEmailDomainAllowed('a@myapp.com', ['myapp.com']), true);
    assert.equal(isEmailDomainAllowed('a@evilmyapp.com', ['myapp.com']), false);
  });
  it('phone country codes', () => {
    assert.equal(isPhoneCountryAllowed('+919876543210', ['+91']), true);
    assert.equal(isPhoneCountryAllowed('+14155550100', ['+91']), false);
    assert.equal(isPhoneCountryAllowed('+14155550100', []), true);
  });
});

describe('masking', () => {
  it('masks emails', () => assert.equal(maskEmail('asha@mail.com'), 'a***@mail.com'));
  it('masks phone numbers', () => assert.equal(maskPhoneNumber('+919876543210'), '+91******3210'));
});

describe('assertValidAuthOptions', () => {
  const validOptions = () => ({
    dataSource: {} as any,
    issuer: 'https://api.myapp.com',
    encryption: { localKey: Buffer.alloc(32, 1).toString('base64') },
    emailSender: { send: async () => undefined },
  });

  it('accepts a valid development setup', () => assert.doesNotThrow(() => assertValidAuthOptions(validOptions())));

  it('lists every problem at once', () => {
    assert.throws(
      () => assertValidAuthOptions({ ...validOptions(), issuer: 'not a url', encryption: { localKey: 'short' }, emailSender: undefined as any }),
      (error: Error) =>
        error.message.includes('issuer') && error.message.includes('localKey') && error.message.includes('emailSender'),
    );
  });

  it('refuses a local key in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(() => assertValidAuthOptions(validOptions()), /development only/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('requires Redis in production unless singleServer is set', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const productionOptions = { ...validOptions(), encryption: { awsKmsKeyId: 'alias/auth', awsRegion: 'ap-south-1' } };
    try {
      assert.throws(() => assertValidAuthOptions(productionOptions), /redisUrl is required/);
      assert.doesNotThrow(() => assertValidAuthOptions({ ...productionOptions, redisUrl: 'redis://cache:6379' }));
      assert.doesNotThrow(() => assertValidAuthOptions({ ...productionOptions, singleServer: true }));
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('checks passkey settings', () => {
    assert.throws(
      () => assertValidAuthOptions({ ...validOptions(), passkeys: { relyingPartyId: 'https://myapp.com', relyingPartyName: 'MyApp', allowedOrigins: [] } }),
      /relyingPartyId[\s\S]*allowedOrigins/,
    );
  });
});
