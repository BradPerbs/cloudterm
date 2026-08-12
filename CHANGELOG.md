# Changelog

All notable changes to CloudTerm are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions align
with [GitHub Releases](https://github.com/BradPerbs/cloudterm/releases).

## [Unreleased]

### Added

- GitHub Actions CI (`.github/workflows/ci.yml`) runs `npm test` on every pull
  request and on pushes to `main`.
- First-run assistant warning explaining that tools act on live sessions and
  what each approval mode means.
- Confirm dialog before switching the assistant to **Never ask**.
- Contributor docs: [assistant approval modes](docs/assistant-approvals.md),
  [RDP credential lifetime](docs/rdp-credentials.md), and
  [IME composition plan](docs/ime-composition.md).

### Changed

- Default assistant approval mode is **Ask before changes** (`writes`): reads
  run freely; mutating tools stop for approval.
- New installs ship with `allowLocalTools: false`.
- RDP passwords are cleared from the renderer as soon as CredSSP completes;
  reconnect always re-fetches credentials from the vault. See
  [RDP credentials](docs/rdp-credentials.md).
- Activity log redacts `rdpPassword` and `bmcPassword` in change diffs.

### Fixed

- Session log transcript files are opened synchronously in `start()` so
  retention tests (and immediate `utime`) do not race the path.

## [1.3.0] - 2026-08-10

### Added

- Host monitoring with desktop notifications when a saved host stops answering.
- Launch CloudTerm at sign-in (Windows).
- Check for updates on every launch.
- BMC/IPMI web UI opens in a tab with auto-login.
- App icon on every platform (`build/icon.png`).

### Changed

- Host cards fit every protocol kind on one row.
- Distro icons halved to match on-screen draw size.
- Renderer dependencies kept out of the packaged app bundle.
- Monitor events kept out of the notifications bell.

## [1.2.1] - 2026-08-06

### Added

- Quick connect: type an address in the host picker and connect immediately.
- Windows install and update via `winget install CloudBlast.CloudTerm`. See
  [docs/winget.md](docs/winget.md).

## [1.2.0]

Earlier releases are listed on
[GitHub Releases](https://github.com/BradPerbs/cloudterm/releases).

[Unreleased]: https://github.com/BradPerbs/cloudterm/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/BradPerbs/cloudterm/releases/tag/v1.3.0
[1.2.1]: https://github.com/BradPerbs/cloudterm/releases/tag/v1.2.1
[1.2.0]: https://github.com/BradPerbs/cloudterm/releases/tag/v1.2.0
