# Contributing

Thanks for helping. This library guards user accounts, so the bar is: **clear, tested, and secure by default**.

## Set up

```bash
git clone <this repository>
cd techelusive-authentication
npm install
npm test          # unit tests
npm run typecheck
npm run build
# with a local PostgreSQL (see below):
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run e2e
```

To try changes in a real app, use the [example](example/) (`npm install` there links the library with `file:..`) and a local PostgreSQL:

```bash
docker run -d --name auth-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

## Before you open a pull request

- [ ] **Open an issue first** for anything larger than a bug fix, so we agree on the approach before you spend time on it.
- [ ] **Follow the [design rules](docs/architecture.md#design-rules-for-contributors).** In short:
  - every constant goes in `src/constants.ts`
  - descriptive names
  - `AuthError` for errors
  - no account enumeration
  - single-use things are consumed atomically
  - events never contain secrets
- [ ] **Tests:** add unit tests for pure logic in `test/`, and a step in `scripts/e2e-check.js` for new flows (it runs against a real PostgreSQL in CI).
- [ ] **Database changes need a new migration file.** Never edit a released migration.
- [ ] **Docs:** update the page in `docs/` that describes the behavior you changed, and `CHANGELOG.md` under "Unreleased".
- [ ] **New settings** need validation, a secure default, and a row in [docs/configuration.md](docs/configuration.md).
- [ ] **No new runtime dependency** without discussion. Every dependency is attack surface.

## Commit messages

Use a short summary in the imperative mood ("Add Microsoft sign-in"), then a body explaining **why**.

## Security issues

Never in public issues or pull requests. See [SECURITY.md](SECURITY.md).

## Code of conduct

Be respectful and constructive. This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
