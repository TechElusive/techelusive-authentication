import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  type RemovableSignInMethod,
  REMOVABLE_SIGN_IN_METHOD,
  SORT_ORDER,
} from '@/constants';
import { PasskeyEntity, PasswordEntity, SocialAccountEntity, UserEntity } from '@/database/entities';
import { AuthSettings } from '@/features/settings/settings.types';

/** Every way a user can currently sign in. Shown on a "Sign-in methods" screen. */
export interface UserSignInMethods {
  hasPassword: boolean;
  /** Can sign in with an email code or magic link (verified email + one of those turned on). */
  canUseEmailCode: boolean;
  /** Can sign in with an SMS code (verified phone + phone OTP turned on). */
  canUsePhoneCode: boolean;
  socialAccounts: { provider: string; email: string | null; linkedAt: string }[];
  passkeyCount: number;
}

/** Answers "how can this user sign in?" and stops them from removing the last way. */
@Injectable()
export class SignInMethodsService {
  private readonly database: DataSource;

  constructor(@Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions) {
    this.database = options.dataSource;
  }

  /**
   * Lists every way the user can currently sign in. Methods turned off in settings don't count.
   *
   * @param user - The user.
   * @param settings - The current settings.
   * @returns Password, email/phone codes, linked social accounts and passkey count.
   */
  async listSignInMethods(user: UserEntity, settings: AuthSettings): Promise<UserSignInMethods> {
    const [hasPassword, socialAccounts, passkeyCount] = await Promise.all([
      this.database.getRepository(PasswordEntity).exists({ where: { userId: user.id } }),
      this.database.getRepository(SocialAccountEntity).find({ where: { userId: user.id }, order: { createdAt: SORT_ORDER.oldestFirst } }),
      this.database.getRepository(PasskeyEntity).count({ where: { userId: user.id } }),
    ]);
    return {
      hasPassword: hasPassword && settings.password.enabled,
      canUseEmailCode: !!user.email && user.isEmailVerified && (settings.emailOtp.enabled || settings.magicLink.enabled),
      canUsePhoneCode: !!user.phoneNumber && user.isPhoneVerified && settings.phoneOtp.enabled,
      socialAccounts: socialAccounts.map((account) => ({
        provider: account.provider,
        email: account.email,
        linkedAt: account.createdAt.toISOString(),
      })),
      passkeyCount: settings.passkeys.enabled ? passkeyCount : 0,
    };
  }

  /**
   * Stops the user from removing their last way to sign in.
   *
   * @param user - The user.
   * @param settings - The current settings.
   * @param kind - What is about to be removed: "password", "social" or "passkey" (one item).
   * @throws AuthError LAST_SIGN_IN_METHOD if removing it would leave no way to sign in.
   */
  async assertCanRemove(user: UserEntity, settings: AuthSettings, kind: RemovableSignInMethod): Promise<void> {
    const methods = await this.listSignInMethods(user, settings);
    const totalMethods =
      Number(methods.hasPassword) +
      Number(methods.canUseEmailCode) +
      Number(methods.canUsePhoneCode) +
      methods.socialAccounts.length +
      methods.passkeyCount;

    const removedCount =
      (kind === REMOVABLE_SIGN_IN_METHOD.password && methods.hasPassword) ||
      (kind === REMOVABLE_SIGN_IN_METHOD.social && methods.socialAccounts.length > 0) ||
      (kind === REMOVABLE_SIGN_IN_METHOD.passkey && methods.passkeyCount > 0)
        ? 1
        : 0;
    if (totalMethods - removedCount < 1) throw new AuthError(AUTH_ERRORS.cannotRemoveLastSignInMethod);
  }
}
