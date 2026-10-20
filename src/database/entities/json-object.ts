/**
 * The shape of a value stored in a jsonb column.
 *
 * Spelled out precisely (instead of Record<string, unknown>) for two reasons:
 * - only JSON can be stored, so the compiler should reject Dates, functions or `undefined`;
 * - TypeORM's insert()/update() typing (QueryDeepPartialEntity) accepts exactly these types,
 *   but rejects `unknown` and `any` values.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
