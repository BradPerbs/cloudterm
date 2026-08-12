# CloudTerm — Product Requirements Document

| Field | Value |
|-------|-------|
| **Product** | CloudTerm |
| **Owner** | CloudBlast |
| **Version covered** | 1.3.0 (as shipped) |
| **Status** | Living document — current product + next roadmap |
| **License** | Fair-code (free to use/modify/share; commercial resale needs a CloudBlast license) |
| **Repo** | https://github.com/BradPerbs/cloudterm |

---

## 1. Vision

CloudTerm is a **desktop multi-protocol terminal workspace**: one window for SSH, SFTP, Telnet, serial, RDP, VNC, and BMC/IPMI, with encrypted local vault storage, optional CloudBlast cloud sync, and a local AI agent that can act through live sessions (with approval).

**North star:** Replace tool sprawl (PuTTY + WinSCP + RDP client + VNC + serial terminal + snippet managers) with a single, trustworthy, modern app that travels with the user’s setup across machines.

---

## 2. Problem

| Pain | Today without CloudTerm |
|------|-------------------------|
| Tool sprawl | Separate apps per protocol; repeated logins and context switching |
| Setup doesn’t travel | Hosts, keys, snippets, known hosts differ per laptop |
| AI is paste-driven | Assistants don’t see the live terminal; users copy/paste riskily |
| CloudBlast customers | Manually re-enter VPS details instead of seeing servers ready to connect |

---

## 3. Goals & non-goals

### Goals

1. **One workspace** for every common remote-access protocol on Windows, macOS, and Linux.
2. **Secrets stay local** — vault-locked encrypted storage; cloud sync encrypts before upload.
3. **CloudBlast differentiation** — free encrypted sync for everyone; auto host list for CloudBlast VPS customers.
4. **Session-aware AI** — local CLIs (Claude Code / Codex / OpenCode) with approval gates; no credential tools.
5. **Trustworthy distribution** — signed installs, predictable updates, clear fair-code terms.

### Non-goals (near term)

- Becoming a full IDE or browser-based terminal SaaS
- Replacing enterprise PAM / jump-box products
- Storing plaintext credentials in the cloud
- Shipping AI that can extract or export vault secrets
- Guaranteeing recovery if the vault password is forgotten

---

## 4. Personas

| Persona | Needs | Success looks like |
|---------|--------|-------------------|
| **Sysadmin / SRE** | Many hosts, jump hosts, tunnels, monitoring | Folders/tags/search; reconnect; uptime checks; activity log |
| **Developer** | SSH + SFTP + occasional RDP/VNC | Fast connect, split panes, snippets, remote edit |
| **CloudBlast customer** | Servers appear without manual entry | Sign in → VPS hosts ready |
| **Multi-machine user** | Same setup on laptop + desktop | Encrypted cloud snapshot restore on sign-in |
| **AI-assisted operator** | Agent reads session and runs approved commands | Clear approval UX; safe defaults |

---

## 5. Current product (v1.3)

### 5.1 User-facing capabilities

| Area | Capability |
|------|------------|
| **Sessions** | SSH, Telnet, serial; jump hosts; SOCKS/HTTP proxies; tabs & split panes (max 8); themes; find; broadcast; screenshots; session log |
| **Files** | SFTP (list/mkdir/delete/rename, transfers, resume, conflicts, drag-and-drop); remote edit → upload on save |
| **Networking** | Local / remote / dynamic port forwarding with traffic counters |
| **Desktops** | RDP (IronRDP WASM), VNC (noVNC, SSH-tunnelled), BMC/IPMI web UI (sandboxed webview + auto-login) |
| **Inventory** | Hosts, folders, tags, search, quick-connect; keychain (generate/import, Windows Hello/TPM); snippets with `{{placeholders}}` |
| **Import** | `~/.ssh/config`, PuTTY, MobaXterm |
| **Security** | App lock / vault (password or OS keystore); encrypted backup export/restore |
| **Cloud** | CloudBlast OAuth (PKCE, system browser); VPS server sync; encrypted cross-device snapshot |
| **Ops** | Host TCP monitoring + notifications; activity log; auto-update from GitHub Releases (winget on Windows) |
| **AI** | Claude Code / Codex / OpenCode; tools: hosts, sessions, terminal read/write, files, connect/disconnect — approval modes |
| **i18n** | In-app: en, zh, vi, pt, ru (README also offers Español — see gap below) |

### 5.2 Architecture (summary)

```
Renderer (React + xterm / IronRDP / noVNC)
    ↕ IPC + MessagePort (session bytes)
Main (Electron): store, vault, transport (ssh|telnet|serial),
                 sftp, tunnels, rdp, vnc, bmc, account, AI, monitor
```

- **Security defaults:** `contextIsolation`, no `nodeIntegration`, `sandbox`; secrets resolved in main; vault lock gates IPC.
- **Persistence:** `sessions.json`, `vault.json`, window state, cloud snapshot under Electron `userData`; UI prefs in `localStorage`.

### 5.3 Platforms & distribution

| Channel | Notes |
|---------|--------|
| GitHub Releases | NSIS + portable (Win), DMG/zip (macOS), AppImage (Linux) |
| winget | `CloudBlast.CloudTerm` — see `docs/winget.md` |
| Signing | **Not code-signed today** — SmartScreen / enterprise friction |

---

## 6. Requirements

### 6.1 Functional (must remain true)

| ID | Requirement |
|----|-------------|
| F1 | User can open SSH / Telnet / serial sessions from a host record without leaving the app |
| F2 | Credentials and private keys never leave the main process (RDP CredSSP path is the documented exception) |
| F3 | Vault lock blocks sensitive IPC until unlocked |
| F4 | SFTP and tunnels can reuse an active SSH connection |
| F5 | Cloud snapshot is encrypted client-side before upload |
| F6 | AI cannot read vault secrets; destructive/session-changing tools require approval unless user opts into a looser mode |
| F7 | Auto-update can be disabled (`CLOUDBLAST_UPDATE_DISABLED`) for air-gapped use |

### 6.2 Non-functional

| ID | Requirement | Current gap |
|----|-------------|-------------|
| N1 | PR builds run automated tests | Release-only CI; no PR test workflow |
| N2 | Installers code-signed on Windows (and ideally macOS) | Unsigned |
| N3 | Core paths (SSH connect, SFTP, lock/unlock) covered by automated smoke | Unit tests only; no E2E |
| N4 | Cold start acceptable for SSH-only users | RDP/VNC/WASM always in bundle weight |
| N5 | CJK IME composition usable in terminal | Known TODO in `xterm.css` |
| N6 | Marketing locales match in-app locales | Spanish README without in-app `es` |

---

## 7. Success metrics (suggested)

| Metric | Target (directional) |
|--------|----------------------|
| Crash-free sessions / week | Track via optional anonymous telemetry later; start with GitHub issue rate |
| Time-to-first-connect (fresh install → SSH) | &lt; 2 minutes with import or CloudBlast sync |
| Update adoption (7-day) | Majority on latest within a week of release (post-signing) |
| Test gate | `npm test` green on every PR before merge |
| AI incident rate | Near-zero reports of unexpected `run_command` without approval on default settings |

---

## 8. Roadmap — bugs, enhancements, optimizations

Priorities: **P0** ship-blocking / trust / safety · **P1** product quality · **P2** polish & scale.

### 8.1 Bug fixes & reliability (P0–P1)

| Priority | Item | Rationale | Notes |
|----------|------|-----------|-------|
| **P0** | Add CI workflow that runs `npm test` on PRs | Regressions can ship with release-only CI | Mirror local `npm test` script |
| **P0** | Harden AI approval defaults + first-run warning | “Never ask” + `run_command` is high risk | Prefer ask-before-run; document modes clearly |
| **P0** | Audit RDP password lifetime in renderer/WASM | Documented secret exception | Zero after auth; no logs; teardown tests |
| **P0** | Fix or quarantine IME composition positioning | Blocks CJK users; zh locale is shipped | `src/renderer/xterm.css` TODO |
| **P1** | Session restore reconnect policy | Tabs restore without live sockets | Explicit “reconnect all” or per-tab option |
| **P1** | Update download UX | `autoDownload = true` may surprise corporate users | Optional “ask before download” |
| **P1** | Align Spanish: add `es` locale **or** remove es README until ready | Docs/product mismatch | |

### 8.2 Enhancements (P1–P2)

| Priority | Item | Rationale |
|----------|------|-----------|
| **P1** | Code-sign Windows (and ideally macOS) builds | SmartScreen, winget, enterprise adoption |
| **P1** | Split oversized modules (`ipc.js`, `store.js`, `App.jsx`, `TerminalView.jsx`) by domain | Safer reviews; fewer regressions |
| **P1** | E2E smoke: mock SSH → SFTP → lock/unlock | Catch IPC/UI wiring unit tests miss |
| **P1** | SSH/SFTP integration tests (container or mock) | Core path under-tested vs edge protocols |
| **P1** | True 1024² app icon (replace upscaled soft cloud) | Documented in `resources/README.md` |
| **P1** | Rename npm package / clarify branding (`cloudblast-ssh` → `cloudterm`) | Contributor & packaging clarity |
| **P2** | Accessibility pass on dialogs + terminal chrome | Enterprise procurement |
| **P2** | Portable winget package parity | Mentioned as future in `docs/winget.md` |
| **P2** | Document env vars & `userData` layout under `docs/` | Support / IT / contributors |
| **P2** | Gradual TypeScript on `store` / `vault` / `ai/tools` | Catch IPC/secret-field shape bugs |

### 8.3 Optimizations (P2)

| Priority | Item | Rationale |
|----------|------|-----------|
| **P2** | Lazy-load RDP / VNC / noVNC chunks | Faster cold start for SSH-only users |
| **P2** | Cap / paginate activity & AI event retention more aggressively | Long-lived processes; large event buffers |
| **P2** | Parallelize `npm test` (today sequential `&&`) | Faster local + CI feedback |
| **P2** | Profile WebGL terminals under multi-pane load | Cap is 8 panes; validate GPU cost |

### 8.4 Explicitly out of scope for this PRD cycle

- Vault password recovery without user-held secret
- Server-side decryption of cloud snapshots
- AI tools that return private keys or vault DEK material

---

## 9. Security & threat notes (product constraints)

| Topic | Stance |
|-------|--------|
| Vault | Protects against disk theft; forgotten password = data unrecoverable by design |
| Cloud snapshot | Protects DB theft in transit/at rest; **not** a compromised CloudBlast app server acting as a malicious client |
| AI | Local CLIs under user accounts; approval modes are the control plane |
| BMC webview | Sandboxed but still untrusted vendor JS on LAN — treat as higher risk surface |
| RDP | Password must reach WASM for CredSSP — minimize lifetime and logging |
| OAuth | System browser + PKCE; client id `cloudblast-desktop` |

---

## 10. Milestones (suggested)

| Milestone | Scope | Exit criteria |
|-----------|--------|---------------|
| **M1 — Trust & gates** | PR CI for tests; AI default hardening; RDP password audit; IME fix plan | Tests on every PR; safer AI defaults; documented RDP secret handling |
| **M2 — Distribution** | Code signing; icon quality; optional update consent | Signed Win (+ mac if feasible); reduced SmartScreen friction |
| **M3 — Quality depth** | Module splits; E2E smoke; SSH/SFTP integration tests | Reviewable IPC surfaces; smoke green in CI |
| **M4 — Polish** | Locale alignment; lazy-load remoting; docs for env/`userData`; a11y pass | Marketing ↔ app parity; measurable startup win |

---

## 11. Open questions

1. Should cloud sync remain forever-free for non-CloudBlast users, or become tiered later?
2. Is code signing budgeted for Windows only first, or Win+mac together?
3. Should “never ask” AI mode remain available, or be removed / hidden behind an advanced unlock?
4. Telemetry: opt-in crash/usage metrics, or stay fully silent?
5. Rename `appId` / package name in a major version, or keep `com.cloudblast.ssh` for upgrade continuity?

---

## 12. References

| Doc | Path / URL |
|-----|------------|
| User README | `README.md` (+ zh-CN, es, ru) |
| Winget publish | `docs/winget.md` |
| Resources / icon notes | `resources/README.md` |
| License | `LICENSE` |
| Product site | https://cloudblast.io |

---

*This PRD describes the product as of v1.3.0 and a prioritized improvement backlog. Update milestones when releases ship.*
