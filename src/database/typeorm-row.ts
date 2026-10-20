import type { QueryDeepPartialEntity } from 'typeorm';

/**
 * Hands a row to TypeORM's insert() / update().
 *
 * Their parameter type (QueryDeepPartialEntity) recurses into every column, which fails for jsonb
 * columns holding free-form JSON ("type instantiation is excessively deep"). The row is still
 * checked here as Partial<Entity>, so a wrong column name or type is caught by the compiler.
 *
 * @param row - The columns to write.
 * @returns The same object, typed for TypeORM.
 * @example
 * await repository.update({ id }, typeormRow<UserEntity>({ status, statusChangedAt: new Date() }));
 */
export function typeormRow<Entity>(row: Partial<Entity>): QueryDeepPartialEntity<Entity> {
  return row as QueryDeepPartialEntity<Entity>;
}

/**
 * Same as `typeormRow`, for inserting several rows at once.
 *
 * @param rows - The rows to insert.
 * @returns The same array, typed for TypeORM.
 */
export function typeormRows<Entity>(rows: Partial<Entity>[]): QueryDeepPartialEntity<Entity>[] {
  return rows as QueryDeepPartialEntity<Entity>[];
}
