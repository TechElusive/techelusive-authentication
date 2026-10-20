import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findUrlSafetyProblem, isPrivateIpAddress } from '@/common/network-safety';
import { createWebhookSignature, verifyWebhookSignature } from '@/features/webhooks/webhook-signature';

describe('isPrivateIpAddress (SSRF guard)', () => {
  const privateAddresses = [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1',
    'not-an-ip',
  ];
  const publicAddresses = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'];

  for (const address of privateAddresses) it(`blocks ${address}`, () => assert.equal(isPrivateIpAddress(address), true));
  for (const address of publicAddresses) it(`allows ${address}`, () => assert.equal(isPrivateIpAddress(address), false));
});

describe('findUrlSafetyProblem', () => {
  it('refuses plain http to a public host', async () => assert.match((await findUrlSafetyProblem('http://8.8.8.8/hook'))!, /https/));
  it('refuses the cloud metadata address', async () =>
    assert.match((await findUrlSafetyProblem('https://169.254.169.254/latest'))!, /private/));
  it('refuses credentials in the URL', async () =>
    assert.match((await findUrlSafetyProblem('https://user:pass@8.8.8.8/'))!, /username/));
  it('refuses junk', async () => assert.equal(await findUrlSafetyProblem('not a url'), 'not a valid URL'));
  it('accepts https to a public IP', async () => assert.equal(await findUrlSafetyProblem('https://8.8.8.8/hook'), null));
});

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"name":"user.created"}';
  const now = 1_800_000_000;

  it('verifies its own signature', () => {
    assert.equal(verifyWebhookSignature(secret, body, createWebhookSignature(secret, body, now), now), true);
  });
  it('rejects a changed body', () => {
    assert.equal(verifyWebhookSignature(secret, `${body} `, createWebhookSignature(secret, body, now), now), false);
  });
  it('rejects the wrong secret', () => {
    assert.equal(verifyWebhookSignature('whsec_other', body, createWebhookSignature(secret, body, now), now), false);
  });
  it('rejects an old delivery (replay)', () => {
    assert.equal(verifyWebhookSignature(secret, body, createWebhookSignature(secret, body, now), now + 3600), false);
  });
  it('rejects a missing or malformed header', () => {
    assert.equal(verifyWebhookSignature(secret, body, undefined, now), false);
    assert.equal(verifyWebhookSignature(secret, body, 'nonsense', now), false);
  });
});
