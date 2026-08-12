# Security

CloudTerm holds SSH keys, passwords, and live server sessions. This page
covers distribution trust (SmartScreen, VirusTotal), dependency hygiene, and
where to report issues.

## Code signing status

| Item | Status |
|------|--------|
| Windows Authenticode certificate | **Pending procurement** |
| macOS Developer ID certificate | **Not started** (Windows first) |
| CI signing wiring (`release.yml`) | **Ready** — signs automatically once secrets are set |
| Current release builds | **Unsigned** |

A Windows code-signing certificate is being procured. Until `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` are added as repository secrets, tagged releases continue
to ship unsigned installers and portable executables. See [Enabling code signing in CI](#enabling-code-signing-in-ci) below for the steps once the certificate arrives.

## VirusTotal and SmartScreen (unsigned builds)

Release builds are **not code-signed today** (certificate pending). On Windows that means:

- **SmartScreen** may warn on first download ("Windows protected your PC").
- **VirusTotal** and some enterprise scanners may flag the portable exe
  (`CloudTerm-x64.exe`) or the NSIS installer with heuristic detections
  (often 1–3 vendors out of 60+). This is common for unsigned Electron apps
  packaged with NSIS; it does not mean the published GitHub release binary
  contains malware.

What actually reduces those warnings:

1. **Authenticode signing** — sign the app binary and the installer with an
   Extended Validation or standard code-signing certificate.
2. **Reputation** — signed builds gain SmartScreen reputation over time as
   more users install them.
3. **False-positive review** — submit the file hash to vendors that flagged it
   for whitelisting (use the full VirusTotal report to see which engines).

### Enabling code signing in CI

**Prerequisite:** a code-signing certificate must be procured and converted to
the secrets below. Windows certificate procurement is **in progress**; macOS
Developer ID is planned after Windows.

When repository secrets are configured, [release.yml](../.github/workflows/release.yml)
passes them to electron-builder:

| Secret | Platform | Purpose |
|--------|----------|---------|
| `WIN_CSC_LINK` | Windows | Base64-encoded `.pfx` or path to cert |
| `WIN_CSC_KEY_PASSWORD` | Windows | PFX password |
| `CSC_LINK` | macOS | Developer ID Application cert (`.p12`) |
| `CSC_KEY_PASSWORD` | macOS | P12 password |

Obtain certificates from a public CA (e.g. DigiCert, Sectigo). Store the PFX
as base64:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('cloudterm.pfx')) | Set-Clipboard
```

Paste the result into `WIN_CSC_LINK`. After the next tagged release, installers
and the portable exe are signed automatically.

Unsigned builds continue to work when these secrets are absent.

## npm dependencies

CI runs `npm audit --omit=dev --audit-level=high` on every pull request and
push to `main`. That checks **production** dependencies only — the libraries
shipped inside the packaged app.

Dev-only tools (Vite, esbuild, electron-builder) may still show advisories
locally when you run `npm audit` without `--omit=dev`. Those affect the
development server, not end users.

To refresh production deps after an advisory:

```bash
npm audit fix
npm audit --omit=dev
npm test
```

## Application security model (summary)

| Area | Behaviour |
|------|-----------|
| Renderer | Sandboxed; no Node integration; context isolation |
| Secrets | Passwords and keys stay in the main process; vault lock blocks sensitive IPC |
| RDP | Password cleared from renderer after CredSSP — see [rdp-credentials.md](rdp-credentials.md) |
| Assistant | Default approval mode asks before mutating tools — see [assistant-approvals.md](assistant-approvals.md) |
| External links | Only `http:` and `https:` via `open-external` IPC |
| Updates | Auto-install only when platform signature checks apply; unsigned mac builds use notify-only mode |
| BMC webview | Guest pages sandboxed; only `http(s)` in `bmc-*` partitions |

## Reporting a vulnerability

Open a [GitHub Security Advisory](https://github.com/BradPerbs/cloudterm/security/advisories/new)
or email the maintainers listed in the repository. Include steps to reproduce
and affected version.

Do **not** file public issues for undisclosed credential theft or RCE paths
before a fix is available.
