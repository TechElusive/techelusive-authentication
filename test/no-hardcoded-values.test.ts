import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Project rule: every fixed value (route, status, name, number, pattern, message, header...) lives in
 * src/constants.ts. This test scans the rest of src/ and fails when a literal value appears.
 *
 * Not checked (they are code, not configuration):
 * - comments and import lines,
 * - human-readable text in log lines and developer errors (logger.*, new Error(...)),
 * - typeof checks ('string', 'object'...), empty strings, and the numbers 0 and 1 in arithmetic,
 * - template strings made only of ${...} parts,
 * - src/database/ (entity column mappings and released migrations must never change),
 * - the ALLOWED_CODE_LITERALS below.
 *
 * If this test fails: move the value to src/constants.ts and import it.
 */

const SOURCE_FOLDER = join(__dirname, '..', 'src');
const SKIPPED_PATHS = ['constants.ts', 'database'];

/** Literals that are code: SQL, query aliases, entity property names, and module names. */
const ALLOWED_CODE_LITERALS = new Set([
  // SQL fragments (queries are logic; their values are passed as parameters)
  "'(user.email ILIKE :pattern OR user.phone_number ILIKE :pattern OR user.first_name ILIKE :pattern OR user.last_name ILIKE :pattern)'",
  "':role = ANY(user.roles)'",
  "'now()'",
  "'session.id = :sessionId AND session.user_id = :userId'",
  "'session.revoked_at IS NULL AND session.expires_at > now()'",
  "'token_hash = :tokenHash AND purpose = :purpose AND used_at IS NULL AND expires_at > now()'",
  "'token_hash = :tokenHash AND used_at IS NULL AND expires_at > now()'",
  "'user.created_at'",
  "'user.id = session.user_id'",
  "'user.status <> :deletedStatus'",
  "'user.status = :activeStatus'",
  "'user.status = :status'",
  "'user_id = :userId AND (last_used_time_step IS NULL OR last_used_time_step < :matchedTimeStep)'",
  '`UPDATE auth_sessions SET active_organization_id = NULL WHERE user_id = $1 AND active_organization_id = $2`',
  // Query-builder aliases and returned column names
  "'user'",
  "'session'",
  "'sessionId'",
  "'email'",
  // Entity property names (TypeORM increment/upsert, Omit<> and Pick<> types, `in` checks)
  "'failedAttempts'",
  "'userId'",
  "'keyHash'",
  "'encryptedSigningSecret'",
  "'name'",
  "'slug'",
  "'localKey'",
  "'awsKmsKeyId'",
  // Optional package loaded by name
  "'ioredis'",
]);

const IGNORED_LITERALS = new Set(["''", "'string'", "'number'", "'object'", "'function'", "'boolean'", "'undefined'", '0', '1']);
const HUMAN_TEXT_LINE = /(logger\.(log|warn|error)|new Error\(|console\.)/;
const LITERAL = /'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|(?<![\w.$])\d+(?:_\d+)*(?![\w.])/g;
const REGEX_LITERAL = /[(=,:!]\s*\/(?![/*])(?:[^/\\\n]|\\.)+\/[gimsuy]*/g;
const ONLY_INTERPOLATIONS = /^`(\$\{[^}]*\})+`$/;

function listSourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    const relativePath = relative(SOURCE_FOLDER, path);
    if (SKIPPED_PATHS.includes(relativePath)) return [];
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function findHardcodedValues(): string[] {
  const findings: string[] = [];
  for (const file of listSourceFiles(SOURCE_FOLDER)) {
    let insideBlockComment = false;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (insideBlockComment || trimmed.startsWith('/*')) {
          insideBlockComment = !trimmed.includes('*/');
          return;
        }
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) return;
        if (/^(export \{|export type \{|\} from )/.test(trimmed)) return;

        // Remove a trailing comment (" // ..."), but not "//" inside strings such as URLs.
        const code = line.replace(/\s\/\/\s.*$/, '');
        if (HUMAN_TEXT_LINE.test(code)) return;

        const literals = [...(code.match(LITERAL) ?? []), ...(code.match(REGEX_LITERAL) ?? []).map((match) => match.slice(1).trim())];
        for (const literal of literals) {
          if (IGNORED_LITERALS.has(literal) || ALLOWED_CODE_LITERALS.has(literal)) continue;
          if (literal.startsWith("'.") || literal.startsWith("'@") || literal.startsWith("'node:")) continue;
          if (ONLY_INTERPOLATIONS.test(literal)) continue;
          findings.push(`${relative(SOURCE_FOLDER, file)}:${index + 1}  ${literal}`);
        }
      });
  }
  return findings;
}

describe('no hardcoded values outside src/constants.ts', () => {
  it('finds none', () => {
    const findings = findHardcodedValues();
    assert.deepEqual(findings, [], `Move these values to src/constants.ts:\n${findings.join('\n')}`);
  });
});
