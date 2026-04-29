# PRES-024: Upstream Delta Hygiene Audit

## Summary

`main` is 39 commits ahead of `pingdotgg/main`, while `pingdotgg/main` is 2 commits ahead of local `main`. The immediate merge/cherry-pick hotspot is WebSocket/RPC lifecycle work: upstream changed `apps/web/src/rpc/protocol.ts` and `apps/web/src/rpc/wsTransport.ts`, and the current dirty tree modifies those same files.

## Commands Recorded By Auditor

```powershell
Get-Content -Raw .plans/presence/tasks/ready/PRES-024-upstream-delta-hygiene.md
git remote -v
git config --get-regexp "^remote\."
git branch -vv --all
git status --short
git status --branch --short
git merge-base main remotes/pingdotgg/main
git rev-list --left-right --count main...remotes/pingdotgg/main
git log --date=short --format="%h %ad %s" ada410bccff144ce4cfed0e2c6e18974b045f968..remotes/pingdotgg/main
git diff --name-status ada410bccff144ce4cfed0e2c6e18974b045f968..remotes/pingdotgg/main
git diff --name-status remotes/pingdotgg/main...main
git diff --stat
git ls-remote https://github.com/pingdotgg/t3code.git refs/heads/main
bun fmt:check
bun lint
bun typecheck
```

## Repo State

`main` is at `2e71cfc8 Add Presence provider tool bridge`, tracking `origin/main`.

Only `origin` is configured as a remote. There is a local `remotes/pingdotgg/main` ref at `dbebc387`, and `git ls-remote` confirmed that `dbebc387` is current `pingdotgg/t3code` `main`.

Merge base with `pingdotgg/main` is:

```text
ada410bccff144ce4cfed0e2c6e18974b045f968
```

`git rev-list --left-right --count main...remotes/pingdotgg/main` returned:

```text
39 2
```

Local fork has 39 committed commits not in upstream, and upstream has 2 commits not in local.

## Upstream Commits Ahead

```text
dbebc387 2026-04-27 Ignore stale WebSocket lifecycle events after reconnect (#2372)
5cf83ffe 2026-04-26 fix(release): use configured node for smoke manifest merge (#2364)
```

Upstream changed:

```text
apps/web/src/rpc/protocol.ts
apps/web/src/rpc/wsTransport.test.ts
apps/web/src/rpc/wsTransport.ts
scripts/release-smoke.ts
```

Current dirty tree also modifies `apps/web/src/rpc/protocol.ts` and `apps/web/src/rpc/wsTransport.ts`, so `dbebc387` is the immediate merge/cherry-pick hotspot.

## Dirty Tree Summary

`git status --short` showed 109 dirty entries during audit:

- 40 treated as Presence-owned.
- 69 outside Presence-owned paths.

Presence-owned paths assumed:

```text
.plans/presence/
apps/server/src/presence/
apps/web/src/components/presence/
apps/web/src/lib/presenceReactQuery.ts
packages/contracts/src/presence*.ts
```

Dirty files outside those paths include shared server orchestration/provider/websocket files, shared web RPC/settings/command files, shared contracts, shared settings, scripts, and broad tests.

Highest-risk concrete files:

```text
apps/web/src/rpc/protocol.ts
apps/web/src/rpc/wsTransport.ts
apps/web/src/rpc/wsRpcClient.ts
apps/server/src/ws.ts
apps/server/src/server.ts
packages/contracts/src/rpc.ts
packages/contracts/src/ipc.ts
packages/contracts/src/provider.ts
packages/contracts/src/settings.ts
apps/web/src/components/CommandPalette.tsx
apps/web/src/components/PresenceCommandRegistry.tsx
apps/web/src/components/settings/SettingsPanels.tsx
apps/server/src/persistence/Migrations.ts
apps/server/src/persistence/Migrations/039_PresenceResidentController.ts
scripts/dev-runner.ts
```

## Hotspot Classification

### WebSocket / RPC

Risk: High.

Upstream just changed `protocol.ts` and `wsTransport.ts` for stale lifecycle protection. The dirty tree modifies the same files plus `wsConnectionState.ts`, `wsRpcClient.ts`, server `ws.ts`, and contracts `rpc.ts`.

### Provider Contracts

Risk: High.

Dirty changes touch `packages/contracts/src/provider.ts`, server provider adapters, provider runtime ingestion, and `ProviderRegistry.ts`. Keep schema additions narrow and put Presence behavior behind Presence modules.

### Settings

Risk: Medium-high.

Dirty changes touch `SettingsPanels.tsx`, `packages/contracts/src/settings.ts`, and `packages/shared/src/serverSettings.test.ts`. Reduce this to a thin registration/config hook.

### Command Palette

Risk: Medium-high.

Dirty changes touch upstream-owned `CommandPalette.tsx`, plus untracked `PresenceCommandRegistry.tsx` and test. Keep Presence commands inside a registry file and make `CommandPalette.tsx` only import/register them.

### Scripts / Tests

Risk: Medium.

Dirty changes touch `scripts/dev-runner.ts`, `scripts/mock-update-server.test.ts`, many server/web tests, and upstream changed `scripts/release-smoke.ts`. There is no direct dirty overlap with `release-smoke.ts`, but script churn should remain separate from Presence runtime work.

### Persistence / Migrations

Risk: High operational risk.

Dirty changes touch `Migrations.ts`, an existing `026_PresenceDomain.ts`, and add `039_PresenceResidentController.ts`. Migration numbering and registration are shared upstream territory, so merge upstream before finalizing numbers.

## Recommendations

1. Isolate or commit the dirty tree before merging `pingdotgg/main`; the current dirty overlap on `apps/web/src/rpc/protocol.ts` and `apps/web/src/rpc/wsTransport.ts` is the sharpest conflict point.
2. Cherry-pick or merge upstream commit `dbebc387` before any further RPC work. Preserve its stale lifecycle event guard as upstream-owned behavior.
3. Split Presence work into smaller commits: Presence service internals, shared contract/schema hooks, WebSocket/RPC hooks, settings hook, command palette hook, migrations, then tests.
4. Keep shared upstream files as registration surfaces only. Move behavior into Presence-owned modules wherever possible.
5. Treat migration registration as its own reviewable commit after rebasing on current `pingdotgg/main`.
6. Keep script changes separate from runtime changes so upstream release/smoke script updates can cherry-pick cleanly.

## Checks

The auditor reported:

- `bun fmt:check` passed.
- `bun lint` exited `0` with 228 warnings.
- `bun typecheck` passed.

The auditor did not run mutating `bun fmt`.

