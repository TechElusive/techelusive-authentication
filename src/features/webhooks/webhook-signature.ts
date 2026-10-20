import { createHmac } from 'node:crypto';
import { constantTimeEquals } from '@/common/crypto/random-secrets';
import {
  HASH_ALGORITHM,
  TEXT_ENCODING,
  WEBHOOK_SIGNATURE_FORMAT,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from '@/constants';
import { currentUnixTimeSeconds } from '@/common/time';

/**
 * Webhook signatures, in the same style as Stripe:
 *
 *   X-Techelusive-Signature: t=1792600000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
 *
 * v1 = HMAC-SHA256(signingSecret, `${t}.${rawRequestBody}`) in hex.
 * Including the time stops an attacker from replaying an old delivery later.
 *
 * @param signingSecret - The webhook's signing secret.
 * @param rawBody - The exact JSON body being sent.
 * @param unixTimeSeconds - The signing time; only passed in tests.
 * @returns The value for the signature header.
 */
export function createWebhookSignature(signingSecret: string, rawBody: string, unixTimeSeconds = currentUnixTimeSeconds()) {
  return formatSignatureHeader(unixTimeSeconds, computeSignature(signingSecret, rawBody, unixTimeSeconds));
}

/**
 * For the RECEIVING app: checks a delivery is genuine and recent. Exported from the library so
 * your other services can verify webhooks with one call.
 *
 * @param signingSecret - The secret shown when the webhook was created.
 * @param rawBody - The request body exactly as received (not re-serialized JSON).
 * @param signatureHeader - The X-Techelusive-Signature header.
 * @param unixTimeSeconds - The current time; only passed in tests.
 * @returns True when the signature is valid and the delivery is not too old.
 * @example
 * const isGenuine = verifyWebhookSignature(secret, req.rawBody, req.headers['x-techelusive-signature']);
 * if (!isGenuine) return res.status(400).end();
 */
export function verifyWebhookSignature(
  signingSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
  unixTimeSeconds = currentUnixTimeSeconds(),
): boolean {
  if (!signatureHeader) return false;
  const parts = parseSignatureHeader(signatureHeader);
  const signedAt = Number(parts[WEBHOOK_SIGNATURE_FORMAT.timestampKey]);
  const presentedSignature = parts[WEBHOOK_SIGNATURE_FORMAT.signatureKey];
  if (!Number.isInteger(signedAt) || typeof presentedSignature !== 'string') return false;
  if (Math.abs(unixTimeSeconds - signedAt) > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) return false;

  return constantTimeEquals(computeSignature(signingSecret, rawBody, signedAt), presentedSignature);
}

/**
 * HMAC-SHA256 of "<unix time>.<raw body>", in hex.
 *
 * @param signingSecret - The webhook's signing secret.
 * @param rawBody - The exact JSON body.
 * @param unixTimeSeconds - The signing time.
 * @returns The signature in hex.
 */
function computeSignature(signingSecret: string, rawBody: string, unixTimeSeconds: number): string {
  const signedContent = [String(unixTimeSeconds), rawBody].join(WEBHOOK_SIGNATURE_FORMAT.signedContentSeparator);
  return createHmac(HASH_ALGORITHM.sha256, signingSecret).update(signedContent).digest(TEXT_ENCODING.hex);
}

/**
 * Builds the header value: "t=1792600000,v1=abc..."
 *
 * @param unixTimeSeconds - The signing time.
 * @param signature - The hex signature.
 * @returns The header value.
 */
function formatSignatureHeader(unixTimeSeconds: number, signature: string): string {
  const { timestampKey, signatureKey, keyValueSeparator, partSeparator } = WEBHOOK_SIGNATURE_FORMAT;
  return [timestampKey + keyValueSeparator + unixTimeSeconds, signatureKey + keyValueSeparator + signature].join(partSeparator);
}

/**
 * Splits the header into its parts: "t=1,v1=abc" -> { t: "1", v1: "abc" }
 *
 * @param signatureHeader - The header value.
 * @returns The parts by key.
 */
function parseSignatureHeader(signatureHeader: string): Record<string, string> {
  return Object.fromEntries(
    signatureHeader.split(WEBHOOK_SIGNATURE_FORMAT.partSeparator).map((part) => {
      const separatorIndex = part.indexOf(WEBHOOK_SIGNATURE_FORMAT.keyValueSeparator);
      return [part.slice(0, separatorIndex).trim(), part.slice(separatorIndex + 1).trim()];
    }),
  );
}
