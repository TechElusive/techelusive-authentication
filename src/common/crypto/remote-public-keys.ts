import { KeyObject } from 'node:crypto';
import {
  JWK_KEY_TYPE,
  SECOND_IN_MILLISECONDS,
  SOCIAL_PROVIDER_TIMEOUT_MS,
  SOCIAL_PUBLIC_KEYS_CACHE_SECONDS,
  UNKNOWN_KEY_REFETCH_WAIT_SECONDS,
} from '@/constants';
import { JsonWebKey, publicKeyFromJwk } from './jwt';

/**
 * Downloads and caches a provider's public signing keys (a JWKS URL such as Google's).
 *
 * - Keys are cached for hours, because providers change them rarely.
 * - If a token names a key we don't have, the keys are re-downloaded (providers rotate keys),
 *   but at most once per UNKNOWN_KEY_REFETCH_WAIT_SECONDS so junk tokens can't make us spam the provider.
 */
export class RemotePublicKeys {
  private keysById = new Map<string, KeyObject>();
  private loadedAt = 0;
  private lastForcedReloadAt = 0;
  private loading?: Promise<void>;

  constructor(private readonly keysUrl: string) {}

  /**
   * Finds a provider public key by id, downloading the key list first if needed.
   * Never throws: a download failure just means "unknown key".
   *
   * @param keyId - The "kid" from the token header.
   * @returns The public key, or undefined if the provider doesn't have one with this id.
   */
  async findKey(keyId: string): Promise<KeyObject | undefined> {
    const cacheIsStale = Date.now() - this.loadedAt > SOCIAL_PUBLIC_KEYS_CACHE_SECONDS * SECOND_IN_MILLISECONDS;
    if (cacheIsStale) await this.reload();

    if (!this.keysById.has(keyId)) {
      const mayForceReload = Date.now() - this.lastForcedReloadAt > UNKNOWN_KEY_REFETCH_WAIT_SECONDS * SECOND_IN_MILLISECONDS;
      if (mayForceReload) {
        this.lastForcedReloadAt = Date.now();
        await this.reload();
      }
    }
    return this.keysById.get(keyId);
  }

  /**
   * Makes sure the key named by `keyId` has been downloaded (if it exists), so it can then be read
   * synchronously with `findLoadedKey`, e.g. from inside `verifyJwt`'s key lookup.
   *
   * @param keyId - The "kid" from the token header, or undefined (then nothing happens).
   */
  async ensureLoaded(keyId: string | undefined): Promise<void> {
    if (keyId) await this.findKey(keyId);
  }

  /**
   * Reads a key from the cache without downloading anything. Call `ensureLoaded` first.
   *
   * @param keyId - The "kid" from the token header.
   * @returns The cached public key, or undefined.
   */
  findLoadedKey(keyId: string): KeyObject | undefined {
    return this.keysById.get(keyId);
  }

  /**
   * Downloads the keys again. If a download is already running, waits for that one instead.
   *
   * @returns Resolves when the download has finished (successfully or not).
   */
  private reload(): Promise<void> {
    // If a download is already running, wait for that one instead of starting another.
    this.loading ??= this.download().finally(() => (this.loading = undefined));
    return this.loading;
  }

  /**
   * Fetches the JWKS URL and replaces the cache with the RSA keys it contains.
   * On any failure the old keys are kept.
   */
  private async download(): Promise<void> {
    try {
      const response = await fetch(this.keysUrl, { signal: AbortSignal.timeout(SOCIAL_PROVIDER_TIMEOUT_MS) });
      if (!response.ok) return;
      const { keys } = (await response.json()) as { keys?: JsonWebKey[] };
      if (!Array.isArray(keys)) return;

      const freshKeys = new Map<string, KeyObject>();
      for (const jsonWebKey of keys) {
        if (!jsonWebKey.kid || jsonWebKey.kty !== JWK_KEY_TYPE.rsa) continue;
        try {
          freshKeys.set(jsonWebKey.kid, publicKeyFromJwk(jsonWebKey));
        } catch {
          // Skip a malformed key rather than losing all of them.
        }
      }
      if (freshKeys.size > 0) {
        this.keysById = freshKeys;
        this.loadedAt = Date.now();
      }
    } catch {
      // Network problem: keep the keys we had. Tokens signed by unknown keys will fail.
    }
  }
}
