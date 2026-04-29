# PRES-043: Harden Provider Runtime Ingestion Idempotence

Status: Done

## Goal

Stop exact provider runtime event replays from creating duplicate orchestration commands or mutating transient ingestion buffers twice before Presence observation sees the event.

## Implementation

Made provider-derived orchestration command ids deterministic from provider, thread id, provider event id, and command tag. This lets the existing orchestration command receipt store suppress exact duplicate provider deliveries instead of depending on projection-level upserts or random command ids.

Added an ingestion-local replay guard keyed by provider, thread id, and provider event id. This protects transient side effects such as assistant text buffering from exact duplicate deliveries during the current runtime process, while avoiding semantic guessing by request text, error payload, or lifecycle status.

Added focused regression coverage for replayed `request.opened` and `runtime.error` provider events. Exact replays are deduped, while a later runtime error with a new provider event id still remains visible.

## Validation

Focused validation passed with `bun run --filter t3 test -- ProviderRuntimeIngestion.test.ts`.
