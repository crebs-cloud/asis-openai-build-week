# OpenAI Build Week provenance

This document separates the Asis foundation that existed before OpenAI Build
Week from the meaningful extension implemented during the official submission
period. It is intentionally sanitized: the operational repository remains
private, and no production identifiers, credentials, customer data, or private
runbooks are included.

## Official build window

The OpenAI Build Week submission period opened on July 13, 2026 at 9:00 AM
Pacific Time (`2026-07-13T16:00:00Z`, 10:00 AM Costa Rica time). The evidence
below uses immutable Git object IDs and ISO 8601 timestamps.

## Pre-existing foundation

Before the submission period, Asis already had a WhatsApp-oriented operations
assistant foundation and production-readiness work. The last source baseline
used for this comparison was:

| Field | Value |
| --- | --- |
| Source commit | `45b5d5d14219eb87eeed81ce47060b0fd7dfbfb7` |
| Timestamp | `2026-07-09T17:16:35-06:00` |
| Subject | `Phase 8E.128 CREBS 360 WhatsApp OTP readiness` |

The pre-existing foundation provides product context, but it is not presented
as work newly created during Build Week.

## Meaningful Build Week extension

The extension was committed after the submission period opened:

| Field | Value |
| --- | --- |
| Source commit | `fd9c26edefa6fd7216f46d47cb0b9a45ca14c4cf` |
| Parent baseline | `45b5d5d14219eb87eeed81ce47060b0fd7dfbfb7` |
| Timestamp | `2026-07-13T20:03:01-06:00` |
| Subject | `feat: add layered website OTP integration` |
| Change size | 39 files changed, 2,154 insertions, 50 deletions |

That change added or meaningfully extended:

- a versioned website-to-WhatsApp OTP contract;
- server-generated, hashed, expiring OTP challenges with consent, session
  binding, throttling, retention, and normalized failures;
- distinct webhook ingestion, routing, policy, and application-service layers;
- adapters for Azure Communication Services, Cosmos DB, Azure OpenAI, Google
  Places, and email;
- non-production provider checks and focused runtime/contract tests; and
- CI validation and deployment-boundary documentation.

## Public judging-package mapping

The public repository is a curated, credential-free representation of the
Build Week extension, not a copy of the operational deployment repository.
Judges can inspect and run the relevant behavior here:

| Build Week contribution | Public evidence |
| --- | --- |
| Versioned integration contract | [`contracts/crebs-website-whatsapp-otp.v1.json`](../contracts/crebs-website-whatsapp-otp.v1.json) |
| Server-side OTP application logic | [`src/lib/asisOtpApplicationService.js`](../src/lib/asisOtpApplicationService.js) |
| OTP HTTP and security boundary | [`src/lib/asisOtpHttpApi.js`](../src/lib/asisOtpHttpApi.js), [`src/lib/asisOtpSecurity.js`](../src/lib/asisOtpSecurity.js) |
| Layered webhook | [`src/lib/asisWebhookEventIngestion.js`](../src/lib/asisWebhookEventIngestion.js), [`src/lib/asisWebhookEventRouter.js`](../src/lib/asisWebhookEventRouter.js), [`src/lib/asisWebhookPolicyService.js`](../src/lib/asisWebhookPolicyService.js), [`src/lib/asisWebhookApplicationService.js`](../src/lib/asisWebhookApplicationService.js) |
| Provider isolation | [`src/lib/integration`](../src/lib/integration) |
| Focused verification | [`tests`](../tests), [`samples/judge`](../samples/judge) |

The public judging package was committed as
`f25bcce88ee8f43f202d0a55b8280b9a0b8872e4` at
`2026-07-20T20:05:55-06:00`. Its GitHub Actions workflow installs from the lock
file, runs syntax checks and tests, and executes the sanitized demonstration.

## Codex and GPT-5.6 evidence

- Primary Codex `/feedback` Session ID:
  `019f59af-15d0-78e1-860d-caa2883f2bad`
- GPT-5.6 was used through Codex for the cross-repository contract, security
  boundary, webhook decomposition, adapter design, test construction, and
  release validation.
- The public package makes those decisions inspectable without exposing
  production authorization values or private evidence.

## Reproduce the public evidence

From a credential-free clone:

```bash
npm ci
npm run check
npm test
npm run demo
```

The commands require Node.js 20 or later and make no live provider calls.
