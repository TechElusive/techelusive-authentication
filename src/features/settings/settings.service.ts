import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { AuthError } from '@/common/auth-error';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  SECOND_IN_MILLISECONDS,
  SETTINGS_CACHE_SECONDS,
  SETTINGS_ROW_ID,
} from '@/constants';
import { SettingsEntity } from '@/database/entities';
import { DEFAULT_SETTINGS } from './settings.defaults';
import { AuthSettings, SettingsChanges } from './settings.types';
import {
  applySettingsChanges,
  combineSettingsChanges,
  findProblemsInChanges,
  findSettingsConflicts,
} from './settings.validation';

/**
 * Works out the settings in force:
 *   built-in defaults  ->  settings from your code  ->  changes an admin saved in the database
 *
 * Settings from code are checked when the app starts; a mistake stops the app with a clear message.
 */
@Injectable()
export class SettingsService {
  private readonly database: DataSource;
  private readonly settingsFromCode: AuthSettings;
  private cachedSettings?: { settings: Promise<AuthSettings>; loadedAt: number };

  constructor(@Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions) {
    this.database = options.dataSource;

    const problemsInCode = findProblemsInChanges(options.settings ?? {});
    this.settingsFromCode = applySettingsChanges(DEFAULT_SETTINGS, options.settings);
    problemsInCode.push(...findSettingsConflicts(this.settingsFromCode));
    if (problemsInCode.length > 0) {
      throw new Error(`AuthModule settings are invalid:\n  - ${problemsInCode.join('\n  - ')}`);
    }
  }

  /**
   * The settings in force right now: code settings with admin changes on top.
   * Cached for a few seconds, so admin changes reach every server quickly without a query per request.
   *
   * @returns The full settings.
   */
  getSettings(): Promise<AuthSettings> {
    const cacheIsFresh =
      this.cachedSettings && Date.now() - this.cachedSettings.loadedAt < SETTINGS_CACHE_SECONDS * SECOND_IN_MILLISECONDS;
    if (!cacheIsFresh) {
      const settings = this.loadAdminChanges().then((adminChanges) => applySettingsChanges(this.settingsFromCode, adminChanges));
      settings.catch(() => (this.cachedSettings = undefined));
      this.cachedSettings = { settings, loadedAt: Date.now() };
    }
    return this.cachedSettings!.settings;
  }

  /**
   * Saves an admin's changes. Settings not mentioned keep their current values.
   *
   * @param changes - Only the sections and fields to change.
   * @param changedBy - Who made the change, e.g. "admin:<id>".
   * @returns The settings now in force.
   * @throws AuthError INVALID_SETTINGS (with `problems`) when a value is not allowed or the
   *   result would conflict (e.g. no sign-in method left on).
   */
  async saveAdminChanges(changes: SettingsChanges, changedBy: string): Promise<AuthSettings> {
    const problemsInChanges = findProblemsInChanges(changes);
    if (problemsInChanges.length > 0) throw new AuthError(AUTH_ERRORS.invalidSettings, { problems: problemsInChanges });

    const allAdminChanges = combineSettingsChanges(await this.loadAdminChanges(), changes);
    const newSettings = applySettingsChanges(this.settingsFromCode, allAdminChanges);
    const combinedProblems = findSettingsConflicts(newSettings);
    if (combinedProblems.length > 0) throw new AuthError(AUTH_ERRORS.invalidSettings, { problems: combinedProblems });

    await this.database.getRepository(SettingsEntity).save({ id: SETTINGS_ROW_ID, changedValues: allAdminChanges, changedBy });
    this.cachedSettings = undefined;
    return newSettings;
  }

  /**
   * Forgets every admin change; the settings from your code apply again.
   *
   * @returns The settings from code.
   */
  async discardAdminChanges(): Promise<AuthSettings> {
    await this.database.getRepository(SettingsEntity).delete({ id: SETTINGS_ROW_ID });
    this.cachedSettings = undefined;
    return this.settingsFromCode;
  }

  /**
   * Reads the admin's saved changes. If a code update made them invalid, they are ignored
   * (rather than breaking sign-in for everyone).
   *
   * @returns The saved changes, or {} when there are none or they are no longer valid.
   */
  private async loadAdminChanges(): Promise<SettingsChanges> {
    const row = await this.database.getRepository(SettingsEntity).findOne({ where: { id: SETTINGS_ROW_ID } });
    if (!row) return {};

    // A code update may have made an old admin change invalid. Fall back to the code settings
    // rather than break sign-in for everyone.
    const savedChanges = row.changedValues as SettingsChanges;
    const stillValid =
      findProblemsInChanges(savedChanges).length === 0 &&
      findSettingsConflicts(applySettingsChanges(this.settingsFromCode, savedChanges)).length === 0;
    return stillValid ? savedChanges : {};
  }
}
