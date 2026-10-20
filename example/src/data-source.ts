import { DataSource } from 'typeorm';
import { AUTH_ENTITIES, AUTH_MIGRATIONS } from '@techelusive/nest-auth';

/**
 * The app's own database. The auth tables live in it next to the app's tables.
 * Run the auth migration once with:  npx typeorm migration:run -d dist/data-source.js
 */
export const appDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [...AUTH_ENTITIES /* , ...your own entities */],
  migrations: [...AUTH_MIGRATIONS /* , ...your own migrations */],
  synchronize: false, // never auto-change tables in production; use migrations
});
