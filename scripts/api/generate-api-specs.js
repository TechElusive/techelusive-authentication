/**
 * Generates, from scripts/api/endpoints.js:
 *   api/openapi.json                                  OpenAPI 3 spec (Swagger UI, client generators)
 *   api/techelusive-authentication.postman_collection.json   Postman collection with automatic token/code capture
 *
 * Usage: npm run build && npm run api-specs
 */
const fs = require('node:fs');
const path = require('node:path');
const { ROUTES, AUTH_ERRORS } = require('../../dist/constants');
const { ENDPOINTS, PLAYGROUND_ENDPOINTS, VARIABLES, PATH_PARAMETER_VARIABLES } = require('./endpoints');
const packageJson = require('../../package.json');

const OUTPUT_FOLDER = path.join(__dirname, '..', '..', 'api');
const OPENAPI_FILE = path.join(OUTPUT_FOLDER, 'openapi.json');
const POSTMAN_FILE = path.join(OUTPUT_FOLDER, 'techelusive-authentication.postman_collection.json');
const DOCS_URL = 'https://github.com/TechElusive/techelusive-authentication/tree/main/docs/endpoints';

/** POST routes that answer 201 Created (Nest's default for POST without @HttpCode(200)). */
const CREATED_ROUTES = new Set(['auth.register', 'organizations.prefix', 'organizations.invitations', 'admin.apiKeys', 'admin.webhooks']);

const POSTMAN_VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const PATH_PARAMETER_PATTERN = /:(\w+)/g;

function routePath(endpoint) {
  if (endpoint.path) return endpoint.path;
  const [group, key] = endpoint.route;
  const prefix = ROUTES[group].prefix;
  const subPath = key === 'prefix' ? '' : ROUTES[group][key];
  if (subPath === undefined) throw new Error(`Unknown route ${group}.${key}`);
  return `/${prefix}${subPath ? `/${subPath}` : ''}`;
}

/** Replaces {{variables}} with readable example values for Swagger. */
function withExampleValues(value) {
  if (typeof value === 'string') {
    return value.replace(POSTMAN_VARIABLE_PATTERN, (_match, name) => VARIABLES[name] || `<${name}>`);
  }
  if (Array.isArray(value)) return value.map(withExampleValues);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withExampleValues(item)]));
  return value;
}

function describe(endpoint) {
  const lines = [];
  if (endpoint.note) lines.push(withExampleValues(endpoint.note));
  if (endpoint.auth === 'admin') lines.push('Requires an admin (a role listed in settings.admin.adminRoles).');
  lines.push(`Full request/response details: ${DOCS_URL}`);
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------------------------

function buildOpenApi() {
  const paths = {};
  for (const endpoint of ENDPOINTS) {
    const expressPath = routePath(endpoint);
    const openApiPath = expressPath.replace(PATH_PARAMETER_PATTERN, '{$1}');
    const routeName = endpoint.route.join('.');
    const successStatus = endpoint.method === 'POST' && CREATED_ROUTES.has(routeName) ? '201' : '200';

    const operation = {
      tags: [endpoint.folder],
      summary: endpoint.name,
      description: describe(endpoint),
      operationId: `${endpoint.method.toLowerCase()}_${routeName.replace('.', '_')}`,
      security: endpoint.auth === 'public' ? [] : [{ bearerAuth: [] }],
      parameters: [
        ...[...expressPath.matchAll(PATH_PARAMETER_PATTERN)].map(([, name]) => ({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })),
        ...Object.entries(endpoint.query ?? {}).map(([name, example]) => ({ name, in: 'query', required: false, schema: { type: 'string' }, example })),
      ],
      responses: {
        [successStatus]: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
        400: { $ref: '#/components/responses/Error' },
        401: { $ref: '#/components/responses/Error' },
        403: { $ref: '#/components/responses/Error' },
        429: { $ref: '#/components/responses/Error' },
      },
    };
    if (endpoint.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: { type: 'object' }, example: withExampleValues(endpoint.body) } },
      };
    }
    paths[openApiPath] ??= {};
    paths[openApiPath][endpoint.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: '@techelusive/nest-auth',
      version: packageJson.version,
      description:
        'Authentication API for NestJS apps. Every response has `success: true|false`; errors carry a stable `code`.\n\n' +
        'Use **Authorize** with an access token from Login (or any sign-in) to call protected endpoints.',
    },
    servers: [{ url: VARIABLES.baseUrl, description: 'Local playground' }],
    tags: [...new Set(ENDPOINTS.map((endpoint) => endpoint.folder))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Success: { type: 'object', properties: { success: { type: 'boolean', example: true } }, additionalProperties: true },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            code: { type: 'string', enum: [...new Set(Object.values(AUTH_ERRORS).map((error) => error.code))] },
            message: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Postman
// ---------------------------------------------------------------------------------------------

/** Postman script lines that save values from the JSON response into collection variables. */
function saveScript(saves) {
  if (!saves) return [];
  return [
    'const body = pm.response.json();',
    'const read = (object, dottedPath) => dottedPath.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);',
    ...Object.entries(saves).map(
      ([variable, responsePath]) =>
        `if (read(body, ${JSON.stringify(responsePath)}) !== undefined) { pm.collectionVariables.set(${JSON.stringify(variable)}, read(body, ${JSON.stringify(responsePath)})); console.log("saved ${variable}"); }`,
    ),
  ];
}

/** Pre-request lines that read the latest code/token from the playground's dev inbox. */
function inboxScript(fetchFromInbox) {
  if (!fetchFromInbox) return [];
  const { variable, to, type, field } = fetchFromInbox;
  return [
    `const to = pm.variables.replaceIn(${JSON.stringify(to)});`,
    `pm.sendRequest(pm.variables.replaceIn("{{baseUrl}}") + "/dev/api/inbox/latest?to=" + encodeURIComponent(to) + "&type=${type}", (error, response) => {`,
    '  if (error || response.code !== 200) { console.warn("No message in the dev inbox yet: send it first."); return; }',
    `  pm.collectionVariables.set(${JSON.stringify(variable)}, response.json().${field});`,
    `  console.log("${variable} taken from the dev inbox");`,
    '});',
  ];
}

/** Pre-request lines that compute the current authenticator code from {{totpSecret}}. */
function totpScript(needsTotp) {
  if (!needsTotp) return [];
  return [
    'pm.sendRequest(pm.variables.replaceIn("{{baseUrl}}/dev/api/totp?secret={{totpSecret}}"), (error, response) => {',
    '  if (error || response.code !== 200) { console.warn("Run \\"Start 2FA setup\\" first."); return; }',
    '  pm.collectionVariables.set("totpCode", response.json().code);',
    '});',
  ];
}

function postmanUrl(expressPath, query) {
  const postmanPath = expressPath.replace(PATH_PARAMETER_PATTERN, (_match, name) => `{{${PATH_PARAMETER_VARIABLES[name] ?? name}}}`);
  const queryPairs = Object.entries(query ?? {});
  const raw = `{{baseUrl}}${postmanPath}${queryPairs.length ? `?${queryPairs.map(([key, value]) => `${key}=${value}`).join('&')}` : ''}`;
  return {
    raw,
    host: ['{{baseUrl}}'],
    path: postmanPath.split('/').filter(Boolean),
    ...(queryPairs.length ? { query: queryPairs.map(([key, value]) => ({ key, value })) } : {}),
  };
}

function buildPostmanCollection() {
  const folders = new Map();
  for (const endpoint of [...ENDPOINTS, ...PLAYGROUND_ENDPOINTS]) {
    const events = [];
    const preRequest = [...inboxScript(endpoint.fetchFromInbox), ...totpScript(endpoint.totp)];
    if (preRequest.length) events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: preRequest } });
    const tests = saveScript(endpoint.saves);
    if (tests.length) events.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });

    const item = {
      name: endpoint.name,
      event: events,
      request: {
        method: endpoint.method,
        description: describe(endpoint),
        ...(endpoint.auth === 'public' ? { auth: { type: 'noauth' } } : {}),
        header: [
          ...(endpoint.body ? [{ key: 'Content-Type', value: 'application/json' }] : []),
          ...Object.entries(endpoint.headers ?? {}).map(([key, value]) => ({ key, value })),
        ],
        url: postmanUrl(routePath(endpoint), endpoint.query),
        ...(endpoint.body ? { body: { mode: 'raw', raw: JSON.stringify(endpoint.body, null, 2), options: { raw: { language: 'json' } } } } : {}),
      },
    };
    if (!folders.has(endpoint.folder)) folders.set(endpoint.folder, []);
    folders.get(endpoint.folder).push(item);
  }

  return {
    info: {
      name: '@techelusive/nest-auth (local playground)',
      description:
        'Every endpoint of @techelusive/nest-auth.\n\n' +
        '1. Start the playground (npm run playground) and open http://localhost:3000/dev to watch emails, SMS and events.\n' +
        '2. Run requests top to bottom inside a folder. Tokens, codes and links are captured automatically into collection variables.\n' +
        '3. Change {{email}} / {{password}} in the collection variables to test other users.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            'let body = {};',
            'try { body = pm.response.json(); } catch (error) { return; }',
            'pm.test("response has a success field", () => pm.expect(body).to.have.property("success"));',
            'if (body.success === false) console.log("Error code:", body.code, "-", body.message);',
            '// A deactivated account offers reactivation: keep the token for "Reactivate".',
            'if (body.reactivationToken) pm.collectionVariables.set("reactivationToken", body.reactivationToken);',
          ],
        },
      },
    ],
    variable: Object.entries(VARIABLES).map(([key, value]) => ({ key, value })),
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
}

fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
fs.writeFileSync(OPENAPI_FILE, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
fs.writeFileSync(POSTMAN_FILE, `${JSON.stringify(buildPostmanCollection(), null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), OPENAPI_FILE)} and ${path.relative(process.cwd(), POSTMAN_FILE)} (${ENDPOINTS.length} endpoints)`);
