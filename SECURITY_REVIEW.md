# Quiet Notes — security checklist review

**Review date:** 2026-10-04
**Scope:** the current GitHub Pages application and its source repository. This is a code/configuration review, not a penetration test, legal opinion, or formal cryptographic audit.

## Architecture first

Quiet Notes is a static React/Vite site. It has no application server, account system, admin area, hosted user files, email service, payment system, SQL database, or cloud synchronization. Ordinary notes and preferences are stored locally; private-workspace records are AES-256-GCM ciphertext in the browser's IndexedDB. The app has no external analytics, session-replay, or font service.

That makes many checks in generic SaaS checklists **not applicable**, rather than features to fake or advertise. It also means there is no server-side enforcement for local data: someone with access to the browser profile can delete/corrupt it, and copied ciphertext can be attacked offline. See `THREAT_MODEL.md` for the security boundary and remaining risks.

## The 19 checks

| # | Check | Status and evidence |
|---|---|---|
| 1 | Protect admin routes | **N/A.** There are no admin routes, roles, or administrative API. |
| 2 | Server-side access control | **N/A.** GitHub Pages serves static assets; there is no application backend or server-side data endpoint. |
| 3 | Row-level security | **N/A.** No hosted database or shared-user records exist. IndexedDB is browser-local, not an authorization boundary. |
| 4 | Verify email | **N/A.** There is no signup, account, or email collection. |
| 5 | Hash passwords | **Applied differently for a local vault.** The passphrase is not stored. PBKDF2-SHA-256 with 310,000 iterations and a random 16-byte salt derives a non-extractable AES-256-GCM key; the encrypted verification value is stored instead. The established crypto parameters and hidden `Password = ` trigger were not changed in this review. |
| 6 | No local auth tokens | **N/A.** There is no authentication/session-token system. `localStorage` is used for theme and sort preferences; startup removes only four named leftovers from the retired tracker (`site_stats`, `site_fp`, `wippy_stats`, `wippy_fp`). No tracker runs, and private content or the vault key is not stored there. |
| 7 | Server-side secrets | **N/A.** There is no application server or third-party service key. The browser code is public by design. |
| 8 | Keep `.env` off GitHub | **Applied.** `.env` and `.env.*` are ignored, with only `.env.example` allowed. The tracked tree and commit history were checked for common credential patterns during this review; no matches were found. Do not put credentials in the repository. |
| 9 | No secrets in logs | **Applied.** Application `console.error` calls were removed; passphrases and decrypted content are not logged. User-facing errors remain generic. |
| 10 | Parameterized SQL | **N/A.** There is no SQL engine or SQL query path. |
| 11 | Validate form inputs | **Applied.** Passphrase fields cap input at 1,024 characters; private metadata is type/length/timestamp/size checked; note-backup imports and exports are capped at 100 MB and 10,000 notes/folders; portable archives validate schema, metadata, item counts, base64, and content-size consistency. |
| 12 | Block XSS | **Applied with defense in depth.** User text is rendered as React text, not HTML; the app has no `innerHTML`, `eval`, or `dangerouslySetInnerHTML` path. Production builds emit a restrictive CSP. Text is shown in a text preview; inline image previews are restricted to signature-checked raster formats, and PDF previews require a PDF signature before being handed to the browser's built-in PDF viewer. The PDF frame is not given an HTML sandbox attribute because that blocks native PDF rendering in common browsers; untrusted HTML is never routed through that frame. |
| 13 | Validate uploads | **Applied for local imports.** Each private item is limited to 25 MB; files are checked before encryption, questionable MIME values fall back to `application/octet-stream`, and portable archives are limited to 100 MB. Unsupported or mismatched media is downloaded rather than embedded as active content. Zero-byte files remain supported. |
| 14 | Verify webhooks | **N/A.** There are no webhook endpoints or incoming server requests. |
| 15 | Rate-limit requests | **N/A for network requests.** The app makes no application API requests. There is no server-side login throttle; copied vault data remains subject to offline passphrase guessing as described in the threat model. |
| 16 | Tighten CORS | **N/A for production APIs.** There is no API server or cross-origin data request. Production CSP limits connections to the same origin. Vite's development/preview host allowlist is limited to the Arena preview domain rather than every host. GitHub Pages does not provide this project a configurable CORS/header policy. |
| 17 | Production debug off | **Applied.** No debug mode or debug route is shipped, application console logging was removed, retired tracker/admin files are absent, and the service-worker cache version was bumped so the next activation removes older cached app shells. |
| 18 | Patch dependencies | **Applied and automated.** Dependencies are pinned to exact versions; `npm audit` reported zero known vulnerabilities after updating affected test dependencies. GitHub Actions are pinned to release commit SHAs, and Dependabot checks npm and Actions weekly. CI runs Node 24, an audit, tests, then a production build before deploy. |
| 19 | Security scan | **Reviewed, not certified.** A targeted source/configuration review, secret-pattern check, `npm audit`, and regression tests were run. No third-party or AI security certification is claimed. |

## Other risks visible in the attached checklist

- **Age question / COPPA:** there is no signup or age collection. This is an architecture note, not a legal conclusion for every possible use of the site.
- **Google Fonts / visitor tracking / session replay:** no remote font, analytics, or replay provider is loaded by the app.
- **Launch email / unsubscribe:** the app sends no email.
- **Stripe / subscription terms:** the app takes no payments and creates no subscriptions.
- **DMCA agent:** the app does not receive or publicly host users' files; user files remain in that user's browser profile. This is not legal advice if the owner later adds public user uploads or republishes third-party material.

## Verification run for this review

- `npm audit --audit-level=moderate` — zero vulnerabilities reported.
- `npm test` — full crypto, archive, input-validation, legacy-tracker cleanup, hidden-trigger, XSS-rendering, password-field, and auto-lock regression suite.
- `VITE_BASE_PATH=/Note_vault/ npm run build` followed by `npm run check:production-security` — production-path build and automated CSP/referrer-policy verification.
- Source checks — no application HTML injection/eval sinks, no external analytics/font/payment/email integrations, and no application console logging.

The application cannot prevent a compromised browser/OS, malicious extensions, someone reading the screen while unlocked, browser-profile tampering, or offline guessing of a weak passphrase. The five-minute auto-lock and local encryption reduce exposure; they do not eliminate those risks.
