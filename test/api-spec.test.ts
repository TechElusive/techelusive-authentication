import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROUTES } from '@/constants';

/**
 * Keeps the Swagger spec and Postman collection (generated from scripts/api/endpoints.js) in step
 * with the controllers: every handler must be documented, and nothing documented may be missing.
 */

const SOURCE_FOLDER = join(__dirname, '..', 'src');
const CONTROLLER_PREFIX = /@Controller\(ROUTES\.(\w+)\.prefix\)/;
const HANDLER = /@(Get|Post|Patch|Put|Delete)\((?:ROUTES\.(\w+)\.(\w+))?\)/g;
const { ENDPOINTS } = require('../scripts/api/endpoints');

function listControllerFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return listControllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

function toPath(group: string, key: string | undefined): string {
  const routes = ROUTES as unknown as Record<string, Record<string, string>>;
  const subPath = key ? routes[group][key] : '';
  return `/${routes[group].prefix}${subPath ? `/${subPath}` : ''}`;
}

describe('API spec matches the controllers', () => {
  it('documents every handler, and only real handlers', () => {
    const handlers = new Set<string>();
    for (const file of listControllerFiles(SOURCE_FOLDER)) {
      const source = readFileSync(file, 'utf8');
      const group = CONTROLLER_PREFIX.exec(source)?.[1];
      assert.ok(group, `${file} does not use ROUTES for its prefix`);
      for (const [, method, handlerGroup, key] of source.matchAll(HANDLER)) {
        handlers.add(`${method.toUpperCase()} ${toPath(handlerGroup ?? group, key)}`);
      }
    }
    const documented = new Set<string>(
      ENDPOINTS.map((endpoint: { method: string; route: [string, string] }) => {
        const [group, key] = endpoint.route;
        return `${endpoint.method} ${toPath(group, key === 'prefix' ? undefined : key)}`;
      }),
    );
    assert.deepEqual([...handlers].filter((handler) => !documented.has(handler)), [], 'handlers missing from scripts/api/endpoints.js');
    assert.deepEqual([...documented].filter((endpoint) => !handlers.has(endpoint)), [], 'documented endpoints with no handler');
  });
});
