# 06: Frontend Command Facade And Cockpit

## Goal

Make the UI a cockpit over server-owned state instead of a second domain control plane.

## Why

`PresenceDashboard` currently owns too many mutations, gating rules, optimistic messages, and action semantics. This makes commands inconsistent and hard to test.

## Outcomes

- Shared web-local Presence command facade powers dashboard and command palette.
- Dashboard renders cockpit, attention queue, and evidence panel from view models.
- Risky actions flow through one confirmation/policy path.
- Natural-language goal input does not bypass command/control routing.

## Backlog

- Extract ticket evidence sections.
- Move repository tools to a secondary panel.
- Add a dedicated `usePresenceCommands` hook if dashboard command definitions keep growing after the evidence split.

## Completed

- Extract Presence cockpit view model.
- Extract attention queue view model.
- Extract evidence panel shell.
