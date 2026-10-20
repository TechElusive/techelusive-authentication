import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  validateSync,
  ValidationError,
} from 'class-validator';
import {
  COUNTRY_CALLING_CODE_PATTERN,
  EMAIL_DOMAIN_PATTERN,
  OAUTH_CLIENT_ID_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH_FLOOR,
  ROLE_NAME_PATTERN,
  SETTINGS_LIMITS,
  SETTINGS_PATH_SEPARATOR,
  VALIDATION_PROBLEM,
} from '@/constants';
import { AuthSettings, SettingsChanges } from './settings.types';

/**
 * Rules for every setting. Used for the settings in your code (checked at startup) and for
 * admin changes (checked before saving). Unknown settings are rejected so typos fail loudly.
 */


class RegistrationRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(SETTINGS_LIMITS.maximumRolesInList) @Matches(ROLE_NAME_PATTERN, { each: true }) defaultRoles?: string[];
  @IsOptional() @IsBoolean() requireFirstAndLastName?: boolean;
  @IsOptional() @IsBoolean() requirePhoneNumber?: boolean;
  @IsOptional() @IsBoolean() requireTermsAcceptance?: boolean;
  @IsOptional() @IsBoolean() requirePrivacyPolicyAcceptance?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(SETTINGS_LIMITS.maximumAllowedEmailDomains) @Matches(EMAIL_DOMAIN_PATTERN, { each: true, message: VALIDATION_PROBLEM.emailDomainFormat })
  allowedEmailDomains?: string[];
}

class ActivationRules {
  @IsOptional() @IsBoolean() requireVerifiedEmail?: boolean;
  @IsOptional() @IsBoolean() requireVerifiedPhone?: boolean;
}

class PasswordRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(PASSWORD_MIN_LENGTH_FLOOR) @Max(PASSWORD_MAX_LENGTH) minimumLength?: number;
  @IsOptional() @IsBoolean() requireUppercaseLetter?: boolean;
  @IsOptional() @IsBoolean() requireLowercaseLetter?: boolean;
  @IsOptional() @IsBoolean() requireNumber?: boolean;
  @IsOptional() @IsBoolean() requireSymbol?: boolean;
  @IsOptional() @IsBoolean() rejectBreachedPasswords?: boolean;
  @IsOptional() @IsBoolean() notifyOnChange?: boolean;
}

class EmailVerificationRules {
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.emailVerificationLinkHours.minimum) @Max(SETTINGS_LIMITS.emailVerificationLinkHours.maximum) linkExpiresInHours?: number;
}

class PasswordResetRules {
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.passwordResetLinkMinutes.minimum) @Max(SETTINGS_LIMITS.passwordResetLinkMinutes.maximum) linkExpiresInMinutes?: number;
}

class EmailChangeRules {
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.emailChangeLinkMinutes.minimum) @Max(SETTINGS_LIMITS.emailChangeLinkMinutes.maximum) linkExpiresInMinutes?: number;
}

class OneTimeCodeRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.codeLength.minimum) @Max(SETTINGS_LIMITS.codeLength.maximum) codeLength?: number;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.codeExpiresInMinutes.minimum) @Max(SETTINGS_LIMITS.codeExpiresInMinutes.maximum) expiresInMinutes?: number;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.resendAfterSeconds.minimum) @Max(SETTINGS_LIMITS.resendAfterSeconds.maximum) resendAfterSeconds?: number;
  @IsOptional() @IsBoolean() allowSignUp?: boolean;
}

class PhoneOtpRules extends OneTimeCodeRules {
  @IsOptional() @IsArray() @ArrayMaxSize(SETTINGS_LIMITS.maximumCountryCodes) @Matches(COUNTRY_CALLING_CODE_PATTERN, { each: true, message: VALIDATION_PROBLEM.countryCodeFormat })
  allowedCountryCodes?: string[];
}

class MagicLinkRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.magicLinkMinutes.minimum) @Max(SETTINGS_LIMITS.magicLinkMinutes.maximum) expiresInMinutes?: number;
  @IsOptional() @IsBoolean() allowSignUp?: boolean;
}

class ClientIdProviderRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(SETTINGS_LIMITS.maximumClientIds) @Matches(OAUTH_CLIENT_ID_PATTERN, { each: true }) clientIds?: string[];
}

class FacebookRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(SETTINGS_LIMITS.facebookAppIdMaxLength) appId?: string;
}

class SwitchRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class TwoFactorRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.twoFactorChallengeMinutes.minimum) @Max(SETTINGS_LIMITS.twoFactorChallengeMinutes.maximum) challengeExpiresInMinutes?: number;
}

class OrganizationRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() allowUsersToCreate?: boolean;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.invitationDays.minimum) @Max(SETTINGS_LIMITS.invitationDays.maximum) invitationExpiresInDays?: number;
}

class TokenRules {
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.accessTokenMinutes.minimum) @Max(SETTINGS_LIMITS.accessTokenMinutes.maximum) accessTokenMinutes?: number;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.refreshTokenDays.minimum) @Max(SETTINGS_LIMITS.refreshTokenDays.maximum) refreshTokenDays?: number;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.sessionDays.minimum) @Max(SETTINGS_LIMITS.sessionDays.maximum) sessionDays?: number;
}

class AdminRules {
  @IsOptional() @IsArray() @ArrayMaxSize(SETTINGS_LIMITS.maximumRolesInList) @Matches(ROLE_NAME_PATTERN, { each: true }) adminRoles?: string[];
}

class SecurityRules {
  @IsOptional() @IsBoolean() notifyOnNewSignIn?: boolean;
}

class RetentionRules {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.expiredRecordDays.minimum) @Max(SETTINGS_LIMITS.expiredRecordDays.maximum) expiredRecordDays?: number;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.webhookDeliveryDays.minimum) @Max(SETTINGS_LIMITS.webhookDeliveryDays.maximum) webhookDeliveryDays?: number;
  @IsOptional() @IsInt() @Min(SETTINGS_LIMITS.auditLogDays.minimum) @Max(SETTINGS_LIMITS.auditLogDays.maximum) auditLogDays?: number;
}

class SettingsChangesRules {
  @IsOptional() @ValidateNested() @Type(() => RegistrationRules) registration?: RegistrationRules;
  @IsOptional() @ValidateNested() @Type(() => ActivationRules) activation?: ActivationRules;
  @IsOptional() @ValidateNested() @Type(() => PasswordRules) password?: PasswordRules;
  @IsOptional() @ValidateNested() @Type(() => EmailVerificationRules) emailVerification?: EmailVerificationRules;
  @IsOptional() @ValidateNested() @Type(() => PasswordResetRules) passwordReset?: PasswordResetRules;
  @IsOptional() @ValidateNested() @Type(() => EmailChangeRules) emailChange?: EmailChangeRules;
  @IsOptional() @ValidateNested() @Type(() => OneTimeCodeRules) emailOtp?: OneTimeCodeRules;
  @IsOptional() @ValidateNested() @Type(() => MagicLinkRules) magicLink?: MagicLinkRules;
  @IsOptional() @ValidateNested() @Type(() => PhoneOtpRules) phoneOtp?: PhoneOtpRules;
  @IsOptional() @ValidateNested() @Type(() => ClientIdProviderRules) google?: ClientIdProviderRules;
  @IsOptional() @ValidateNested() @Type(() => ClientIdProviderRules) apple?: ClientIdProviderRules;
  @IsOptional() @ValidateNested() @Type(() => FacebookRules) facebook?: FacebookRules;
  @IsOptional() @ValidateNested() @Type(() => SwitchRules) passkeys?: SwitchRules;
  @IsOptional() @ValidateNested() @Type(() => TwoFactorRules) twoFactor?: TwoFactorRules;
  @IsOptional() @ValidateNested() @Type(() => OrganizationRules) organizations?: OrganizationRules;
  @IsOptional() @ValidateNested() @Type(() => TokenRules) tokens?: TokenRules;
  @IsOptional() @ValidateNested() @Type(() => AdminRules) admin?: AdminRules;
  @IsOptional() @ValidateNested() @Type(() => SecurityRules) security?: SecurityRules;
  @IsOptional() @ValidateNested() @Type(() => RetentionRules) retention?: RetentionRules;
}

/**
 * Checks a set of changes on its own (types, ranges, unknown fields).
 *
 * @param changes - Settings changes from code or from an admin.
 * @returns Readable problems like "password.minimumLength must not be less than 8"; empty means valid.
 */
export function findProblemsInChanges(changes: unknown): string[] {
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return [VALIDATION_PROBLEM.settingsNotAnObject];
  const instance = plainToInstance(SettingsChangesRules, changes);
  return describeValidationErrors(validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }));
}

/**
 * Checks rules that involve several settings together, on the final merged settings
 * (e.g. at least one sign-in method must stay on).
 *
 * @param settings - The full merged settings.
 * @returns Readable problems; empty means valid.
 */
export function findSettingsConflicts(settings: AuthSettings): string[] {
  const problems: string[] = [];

  if (settings.tokens.refreshTokenDays > settings.tokens.sessionDays) {
    problems.push(VALIDATION_PROBLEM.refreshLongerThanSession);
  }

  const anySignInMethodEnabled =
    settings.password.enabled ||
    settings.emailOtp.enabled ||
    settings.magicLink.enabled ||
    settings.phoneOtp.enabled ||
    settings.google.enabled ||
    settings.apple.enabled ||
    settings.facebook.enabled ||
    settings.passkeys.enabled;
  if (!anySignInMethodEnabled) problems.push(VALIDATION_PROBLEM.noSignInMethodEnabled);

  if (settings.google.enabled && settings.google.clientIds.length === 0) problems.push(VALIDATION_PROBLEM.googleClientIdsRequired);
  if (settings.apple.enabled && settings.apple.clientIds.length === 0) problems.push(VALIDATION_PROBLEM.appleClientIdsRequired);
  if (settings.facebook.enabled && !settings.facebook.appId) problems.push(VALIDATION_PROBLEM.facebookAppIdRequired);
  if (settings.admin.adminRoles.length === 0) problems.push(VALIDATION_PROBLEM.adminRolesRequired);

  return problems;
}

/**
 * Turns class-validator's nested errors into lines like "password.minimumLength must not be less than 8".
 *
 * @param errors - The errors from `validateSync`.
 * @param parentPath - The dotted path of the parent section (used while recursing).
 * @returns One readable line per problem.
 */
function describeValidationErrors(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const path = parentPath ? [parentPath, error.property].join(SETTINGS_PATH_SEPARATOR) : error.property;
    const ownProblems = Object.values(error.constraints ?? {}).map((message) =>
      message.startsWith(error.property) ? path + message.slice(error.property.length) : VALIDATION_PROBLEM.atPath(path, message),
    );
    return [...ownProblems, ...describeValidationErrors(error.children ?? [], path)];
  });
}

/**
 * Applies changes on top of settings, one section at a time. Unknown sections are ignored.
 * The input objects are not modified.
 *
 * @param base - The settings to start from.
 * @param changes - The changes to apply.
 * @returns A new settings object.
 */
export function applySettingsChanges(base: AuthSettings, changes: SettingsChanges = {}): AuthSettings {
  const result = structuredClone(base);
  for (const section of Object.keys(result) as Array<keyof AuthSettings>) {
    const sectionChanges = changes[section];
    if (sectionChanges) Object.assign(result[section], sectionChanges);
  }
  return result;
}

/**
 * Combines two sets of changes; later values win. Used to keep admin changes on top of each other.
 *
 * @param earlier - The changes saved before.
 * @param later - The new changes.
 * @returns A new, combined set of changes.
 */
export function combineSettingsChanges(earlier: SettingsChanges, later: SettingsChanges): SettingsChanges {
  const combined: SettingsChanges = structuredClone(earlier);
  for (const section of Object.keys(later) as Array<keyof AuthSettings>) {
    combined[section] = { ...(combined[section] as object), ...(later[section] as object) } as any;
  }
  return combined;
}
