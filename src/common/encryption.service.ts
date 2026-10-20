import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AuthOptions } from '@/auth-options';
import {
  AES_GCM_AUTH_TAG_BYTES,
  AES_GCM_INITIALIZATION_VECTOR_BYTES,
  AUTH_OPTIONS_TOKEN,
  ENCRYPTED_VALUE_METHOD,
  ENCRYPTED_VALUE_SEPARATOR,
  LOCAL_ENCRYPTION_CIPHER,
  TEXT_ENCODING,
} from '@/constants';

/**
 * Encrypts secrets we must be able to read back later: the token-signing private key,
 * authenticator-app secrets and webhook signing secrets. (Passwords and tokens are hashed instead.)
 *
 * Stored format: "<method>:<base64 data>", where method is "kms" or "local". Keeping the method
 * with the data means you can move from the local key to KMS later and old values still decrypt.
 *
 * `context` (e.g. { purpose: 'two-factor', userId }) is bound to the ciphertext: a value copied
 * onto another user's row will not decrypt.
 */
@Injectable()
export class EncryptionService {
  private readonly kmsClient?: KMSClient;
  private readonly kmsKeyId?: string;
  private readonly localKey?: Buffer;

  constructor(@Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions) {
    if ('awsKmsKeyId' in options.encryption) {
      this.kmsClient = new KMSClient({ region: options.encryption.awsRegion });
      this.kmsKeyId = options.encryption.awsKmsKeyId;
      // Only for reading values written before the move to KMS.
      if (options.encryption.legacyLocalKey) this.localKey = Buffer.from(options.encryption.legacyLocalKey, TEXT_ENCODING.base64);
    } else {
      this.localKey = Buffer.from(options.encryption.localKey, TEXT_ENCODING.base64);
    }
  }

  /**
   * Encrypts a secret with AWS KMS when configured, otherwise with the local AES-256-GCM key.
   *
   * @param plainText - The secret to protect.
   * @param context - Binds the value to its owner, e.g. { purpose: 'two-factor', userId }.
   *   The same context must be passed to `decrypt`.
   * @returns The stored form, "<method>:<base64 data>".
   */
  async encrypt(plainText: string, context: Record<string, string>): Promise<string> {
    if (this.kmsClient) {
      const result = await this.kmsClient.send(
        new EncryptCommand({ KeyId: this.kmsKeyId, Plaintext: Buffer.from(plainText, TEXT_ENCODING.utf8), EncryptionContext: context }),
      );
      return `${ENCRYPTED_VALUE_METHOD.kms}${ENCRYPTED_VALUE_SEPARATOR}${Buffer.from(result.CiphertextBlob!).toString(TEXT_ENCODING.base64)}`;
    }

    const initializationVector = randomBytes(AES_GCM_INITIALIZATION_VECTOR_BYTES);
    const cipher = createCipheriv(LOCAL_ENCRYPTION_CIPHER, this.localKey!, initializationVector);
    cipher.setAAD(Buffer.from(describeContext(context)));
    const encrypted = Buffer.concat([cipher.update(plainText, TEXT_ENCODING.utf8), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    return `${ENCRYPTED_VALUE_METHOD.local}${ENCRYPTED_VALUE_SEPARATOR}${Buffer.concat([initializationVector, authenticationTag, encrypted]).toString(TEXT_ENCODING.base64)}`;
  }

  /**
   * Decrypts a value written by `encrypt`. Works for both "kms" and "local" values,
   * whichever method is configured now.
   *
   * @param storedValue - The "<method>:<base64 data>" text from the database.
   * @param context - The same context that was used to encrypt it.
   * @returns The original secret.
   * @throws If the context doesn't match, the data was tampered with, or the needed key is not configured.
   */
  async decrypt(storedValue: string, context: Record<string, string>): Promise<string> {
    const separatorIndex = storedValue.indexOf(ENCRYPTED_VALUE_SEPARATOR);
    const method = storedValue.slice(0, separatorIndex);
    const data = Buffer.from(storedValue.slice(separatorIndex + 1), TEXT_ENCODING.base64);

    if (method === ENCRYPTED_VALUE_METHOD.kms) {
      // KMS knows which key encrypted the data, so no key id is needed here.
      const client = this.kmsClient ?? new KMSClient({});
      const result = await client.send(new DecryptCommand({ CiphertextBlob: data, EncryptionContext: context }));
      return Buffer.from(result.Plaintext!).toString(TEXT_ENCODING.utf8);
    }

    if (method === ENCRYPTED_VALUE_METHOD.local) {
      if (!this.localKey) throw new Error('This value was encrypted with a local key, but no localKey is configured');
      const decipher = createDecipheriv(LOCAL_ENCRYPTION_CIPHER, this.localKey, data.subarray(0, AES_GCM_INITIALIZATION_VECTOR_BYTES));
      decipher.setAAD(Buffer.from(describeContext(context)));
      decipher.setAuthTag(data.subarray(AES_GCM_INITIALIZATION_VECTOR_BYTES, AES_GCM_INITIALIZATION_VECTOR_BYTES + AES_GCM_AUTH_TAG_BYTES));
      return Buffer.concat([decipher.update(data.subarray(AES_GCM_INITIALIZATION_VECTOR_BYTES + AES_GCM_AUTH_TAG_BYTES)), decipher.final()]).toString(TEXT_ENCODING.utf8);
    }

    throw new Error(`Unknown encryption method "${method}"`);
  }
}

/**
 * Turns the context into one stable string (keys sorted) for AES-GCM's "additional authenticated data".
 *
 * @param context - The encryption context.
 * @returns A JSON string that is the same for the same keys and values in any order.
 */
function describeContext(context: Record<string, string>): string {
  return JSON.stringify(Object.keys(context).sort().map((key) => [key, context[key]]));
}
