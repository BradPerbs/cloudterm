# Assistant approval modes

The local AI agent can read live terminals and run tools against saved hosts.
Approval modes decide when those tools stop for a person.

| Mode | Value | Behaviour |
|------|-------|-----------|
| Ask every time | `always` | Every tool waits, including reads |
| Ask before changes | `writes` | **Default.** Reads run freely; mutating tools ask |
| Never ask | `never` | Nothing asks; blocked commands are still refused |

## Defaults and hardening

- New installs ship with `writes` and `allowLocalTools: false`.
- The first time the assistant panel opens, a short warning explains the modes
  and that tools act on live sessions. Choosing **Got it** sets
  `acknowledgedApprovalWarning` in `assistant.json` (Escape / backdrop do not).
- Switching to **Never ask** from the composer chip or Settings requires an
  explicit confirm dialog. The block list (`blockedCommands`, seeded with
  `rm -rf`) still refuses matching commands under every mode, including never.

## Where it lives

- Persistence: `userData/assistant.json` via `src/main/ai/settings.js`
- Policy: `src/main/ai/tools.js` (`isAutoApproved`, `blockedReason`)
- UI: composer `ApprovalMenu`, Settings → Assistant

Settings for the assistant stay machine-local on purpose and do not sync with
cloud snapshots.
