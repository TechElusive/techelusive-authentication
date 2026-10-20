# Security policy

Authentication code protects other people's accounts, so security reports get priority over everything else.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting).

Please include:
- the version or commit,
- what an attacker can do and under which settings,
- steps or a proof of concept,
- any fix you suggest.

What to expect:

| Step | Target time |
|---|---|
| Acknowledgement | 3 working days |
| First assessment (severity, affected versions) | 7 days |
| Fix released for critical / high issues | 30 days |

We will credit you in the release notes unless you prefer otherwise. Please give us a reasonable chance to release a fix before publishing details.

## Supported versions

Until 1.0, only the latest minor release receives security fixes. After 1.0, the latest two minor releases do.

## Scope

**In scope:**
- Authentication bypass
- Account takeover or pre-hijacking
- Token forgery or replay
- Privilege escalation (roles, organizations, admin)
- Enumeration that leaks which accounts exist
- Rate-limit bypass
- SSRF through webhooks
- Secrets exposed in responses, logs or events
- Cryptographic weaknesses

**Out of scope:**
- Issues that need a compromised server or database administrator
- Missing CAPTCHA
- Missing HTTP security headers in the host app
- Misconfiguration contrary to the [production checklist](docs/production-checklist.md)

The design and the attacks it defends against are described in [docs/security.md](docs/security.md).
