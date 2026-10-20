import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MAINTENANCE_DATABASE_NAME, PLAYGROUND_LOG_CONTEXT, POSTGRES_DATABASE_NAME_PATTERN } from './playground.constants';

/**
 * Creates the playground's database when the server has none by that name, e.g. when a Postgres
 * already installed on the machine (Homebrew, Postgres.app) answers instead of the Docker one.
 * Connects to the always-present "postgres" database to do it.
 */
export async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!POSTGRES_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Unexpected database name "${databaseName}" in DATABASE_URL (letters, digits and _ only).`);
  }

  url.pathname = `/${MAINTENANCE_DATABASE_NAME}`;
  const maintenance = new DataSource({ type: 'postgres', url: url.toString() });
  await maintenance.initialize();
  try {
    const existing: unknown[] = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (existing.length === 0) {
      // Names can't be bound as parameters; the pattern check above keeps this safe.
      await maintenance.query(`CREATE DATABASE "${databaseName}"`);
      new Logger(PLAYGROUND_LOG_CONTEXT).log(`Created database "${databaseName}"`);
    }
  } finally {
    await maintenance.destroy();
  }
}
