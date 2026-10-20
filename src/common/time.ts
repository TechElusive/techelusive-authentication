import { SECOND_IN_MILLISECONDS } from '@/constants';

/**
 * The current time in whole seconds since 1970 (the unit JWTs, TOTP and webhook signatures use).
 *
 * @returns The Unix time in seconds.
 */
export function currentUnixTimeSeconds(): number {
  return Math.floor(Date.now() / SECOND_IN_MILLISECONDS);
}

/**
 * Waits for `work`, but gives up if it takes too long (used by health checks).
 *
 * @param work - The promise to wait for.
 * @param timeoutMs - How long to wait, in milliseconds.
 * @returns What `work` resolved to.
 * @throws If `work` rejects, or with "Timed out after N ms" when the time runs out.
 */
export async function withTimeout<Result>(work: Promise<Result>, timeoutMs: number): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
