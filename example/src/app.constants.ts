/**
 * The example app's own fixed values. Each product keeps its own constants file like this one,
 * so roles, scopes and routes are defined once.
 */

/** RideMate's app-wide roles. */
export const APP_ROLE = {
  traveller: 'TRAVELLER',
  tripHost: 'TRIP_HOST',
  admin: 'ADMIN',
  superAdmin: 'SUPER_ADMIN',
} as const;

/** Scopes partner servers can be given on their API keys. */
export const API_KEY_SCOPE = {
  ridesRead: 'rides:read',
} as const;

export const RIDES_ROUTES = {
  prefix: 'rides',
  popular: 'popular',
  mine: 'mine',
  payout: 'payout',
  export: 'export',
} as const;

export const PAYOUT_STATUS = { requested: 'requested' } as const;

/** Defaults for local development; production values come from environment variables. */
export const DEVELOPMENT_ISSUER = 'http://localhost:3000';
export const DEFAULT_AWS_REGION = 'ap-south-1';
export const DEFAULT_PORT = 3000;
export const APP_NAME = 'RideMate';
/** India only, to limit SMS fraud costs. */
export const ALLOWED_PHONE_COUNTRY_CODES = ['+91'];

/** Express: trust exactly one proxy hop (the load balancer) when reading the client IP. */
export const TRUSTED_PROXY_HOPS = 1;
export const TRUST_PROXY_SETTING = 'trust proxy';
/** WEB_APP_ORIGIN may list several origins separated by commas. */
export const ORIGIN_LIST_SEPARATOR = ',';
export const PRODUCTION_ENVIRONMENT = 'production';
