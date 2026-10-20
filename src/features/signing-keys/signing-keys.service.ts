import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, generateKeyPairSync, KeyObject } from 'node:crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { EncryptionService } from '@/common/encryption.service';
import { JsonWebKey, privateKeyFromJwk, publicKeyFromJwk } from '@/common/crypto/jwt';
import {
  AUTH_OPTIONS_TOKEN,
  ENCRYPTION_PURPOSE,
  HASH_ALGORITHM,
  JWK_EXPORT_FORMAT,
  JWK_USE_SIGNATURE,
  LOG_CONTEXT,
  RETIRED_SIGNING_KEY_PUBLISH_SECONDS,
  SECOND_IN_MILLISECONDS,
  SIGNING_ALGORITHM,
  SIGNING_KEYS_CACHE_SECONDS,
  SIGNING_KEY_CURVE,
  SIGNING_KEY_PAIR_TYPE,
  TEXT_ENCODING,
} from '@/constants';
import { SigningKeyEntity } from '@/database/entities';

export interface LoadedSigningKeys {
  /** The key that signs every new token. */
  currentKey: { keyId: string; privateKey: KeyObject };
  /** Public keys that can verify tokens: the current one plus recently retired ones. */
  publicKeysById: Map<string, KeyObject>;
  /** The same public keys in JWK form, served at /.well-known/jwks.json. */
  publicJwks: JsonWebKey[];
}

/**
 * Manages the ES256 keys that sign access tokens.
 *
 * - The first key is created automatically the first time it is needed.
 * - Private keys are encrypted before being saved (EncryptionService).
 * - rotateSigningKey() replaces the key; tokens signed by the old key keep working until they expire.
 */
@Injectable()
export class SigningKeysService {
  private readonly logger = new Logger(LOG_CONTEXT.signingKeys);
  private readonly database: DataSource;
  private cachedKeys?: { keys: Promise<LoadedSigningKeys>; loadedAt: number };

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly encryption: EncryptionService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Returns the keys, re-reading them from the database at most once a minute.
   * A failed load is not cached, so the next call tries again.
   *
   * @returns The current private key and every public key that may still verify tokens.
   */
  getSigningKeys(): Promise<LoadedSigningKeys> {
    const cacheIsFresh =
      this.cachedKeys && Date.now() - this.cachedKeys.loadedAt < SIGNING_KEYS_CACHE_SECONDS * SECOND_IN_MILLISECONDS;
    if (!cacheIsFresh) {
      const keys = this.loadSigningKeys();
      keys.catch(() => (this.cachedKeys = undefined));
      this.cachedKeys = { keys, loadedAt: Date.now() };
    }
    return this.cachedKeys!.keys;
  }

  /**
   * Retires the current key and starts signing with a new one. Run it every few months, or at
   * once if you think a key leaked. Other servers pick up the new key within a minute, and tokens
   * signed with the old key keep working until they expire.
   */
  async rotateSigningKey(): Promise<void> {
    const newKey = await this.generateSigningKey();
    await this.database.transaction(async (transaction) => {
      await transaction.update(SigningKeyEntity, { retiredAt: IsNull() }, { retiredAt: new Date() });
      await transaction.insert(SigningKeyEntity, newKey);
    });
    this.cachedKeys = undefined;
    this.logger.log(`Signing key rotated. New key id: ${newKey.keyId}`);
  }

  /**
   * Reads the current key and recently retired ones from the database, creating the first key if needed.
   *
   * @returns The loaded keys.
   * @throws If there is no current key or it can't be decrypted.
   */
  private async loadSigningKeys(): Promise<LoadedSigningKeys> {
    await this.createFirstKeyIfMissing();

    const oldestRetirementStillPublished = new Date(Date.now() - RETIRED_SIGNING_KEY_PUBLISH_SECONDS * SECOND_IN_MILLISECONDS);
    const keyRows = await this.database.getRepository(SigningKeyEntity).find({
      where: [{ retiredAt: IsNull() }, { retiredAt: MoreThan(oldestRetirementStillPublished) }],
    });
    const currentKeyRow = keyRows.find((row) => row.retiredAt === null);
    if (!currentKeyRow) throw new Error('No current signing key found');

    const privateJwk = JSON.parse(await this.encryption.decrypt(currentKeyRow.encryptedPrivateKey, this.encryptionContext(currentKeyRow.keyId)));

    return {
      currentKey: { keyId: currentKeyRow.keyId, privateKey: privateKeyFromJwk(privateJwk) },
      publicKeysById: new Map(keyRows.map((row) => [row.keyId, publicKeyFromJwk(row.publicKey)])),
      publicJwks: keyRows.map((row) => row.publicKey),
    };
  }

  /**
   * Creates the very first signing key. Safe when several servers start at once: the database
   * allows only one current key, so the losers simply use the winner's.
   */
  private async createFirstKeyIfMissing(): Promise<void> {
    const keys = this.database.getRepository(SigningKeyEntity);
    if (await keys.exists({ where: { retiredAt: IsNull() } })) return;
    try {
      await keys.insert(await this.generateSigningKey());
      this.logger.log('Created the first signing key');
    } catch (error) {
      // Two servers started at the same moment. The database allows only one current key, so the other server won.
      if (!(await keys.exists({ where: { retiredAt: IsNull() } }))) throw error;
    }
  }

  /**
   * Binds the encrypted private key to its key id, so it can't be swapped with another row.
   *
   * @param keyId - The key's id.
   * @returns The context for `EncryptionService`.
   */
  private encryptionContext(keyId: string) {
    return { purpose: ENCRYPTION_PURPOSE.signingKey, keyId };
  }

  /**
   * Creates a new ES256 key pair. The key id is the key's RFC 7638 thumbprint.
   *
   * @returns The row to insert: key id, public JWK, and the encrypted private key.
   */
  private async generateSigningKey(): Promise<Partial<SigningKeyEntity> & { keyId: string }> {
    const { privateKey, publicKey } = generateKeyPairSync(SIGNING_KEY_PAIR_TYPE, { namedCurve: SIGNING_KEY_CURVE });
    const publicJwk = publicKey.export({ format: JWK_EXPORT_FORMAT }) as JsonWebKey;

    // The key id is the key's RFC 7638 thumbprint: a hash of its public parts.
    const keyId = createHash(HASH_ALGORITHM.sha256)
      .update(JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y }))
      .digest(TEXT_ENCODING.base64Url);

    return {
      keyId,
      publicKey: { kty: publicJwk.kty!, crv: publicJwk.crv!, x: publicJwk.x!, y: publicJwk.y!, kid: keyId, alg: SIGNING_ALGORITHM, use: JWK_USE_SIGNATURE },
      encryptedPrivateKey: await this.encryption.encrypt(JSON.stringify(privateKey.export({ format: JWK_EXPORT_FORMAT })), this.encryptionContext(keyId)),
    };
  }
}
