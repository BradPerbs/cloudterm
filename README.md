<p align="center">
  <img src="cloudterm.png" alt="CloudTerm" width="128">
</p>

<h1 align="center">CloudTerm</h1>

<p align="center">
  <strong>SSH, SFTP, Telnet and Windows RDP, all in one terminal</strong>
</p>

<p align="center">
  A modern terminal workspace built with Electron, React and xterm.js.<br/>
  Split panes · Tabs · File transfers · Port forwarding · Remote desktops · Snippets
</p>

<p align="center">
  <a href="https://github.com/BradPerbs/cloudterm/releases/latest"><img alt="Download" src="https://img.shields.io/badge/Download-Latest-success?style=for-the-badge&logo=github"></a>
  &nbsp;
  <a href="#"><img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue?style=for-the-badge&logo=electron"></a>
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-fair--code-green?style=for-the-badge"></a>
  &nbsp;
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.ru.md">Русский</a>
</p>

---

CloudTerm keeps every way you reach a server in one window. Open an SSH session,
move files over SFTP, forward a port and take a Windows desktop, all on the same
connection and the same tab strip. No second app, no second login.

It connects to anything: your laptop's serial console, a switch that only speaks
telnet, a Windows box over RDP, or a server on any host you like. CloudTerm is
made by [CloudBlast](https://cloudblast.io), a VPS hosting company. It is free for
everyone, and the whole source is here to read and change.

<img src="Main%20Image.png" alt="CloudTerm" width="100%">

---

<h2 align="center">☁️ Free cloud sync, for everyone</h2>

<p align="center">
  <strong>Your setup on every machine you use, at no charge.</strong><br/>
  Hosts, folders, keys, snippets, trusted host keys and terminal settings, encrypted<br/>
  on your machine before it ever leaves and restored the moment you sign in somewhere else.
</p>

<p align="center">
  Free with a <a href="https://cloudblast.io"><strong>CloudBlast</strong></a> account,
  whether or not you host a single server with us.
</p>

<p align="center">
  <a href="https://cloudblast.io"><img alt="Get a free account" src="https://img.shields.io/badge/Get%20a%20free%20account-cloudblast.io-0aa2c0?style=for-the-badge"></a>
</p>

<p align="center">
  <sub>Already a CloudBlast customer? Your servers appear in the host list on their own, ready to connect.</sub>
</p>

---

## Contents

- [What is CloudTerm](#what-is-cloudterm)
- [Features](#features)
- [Screenshots](#screenshots)
- [Getting started](#getting-started)
- [Community](#community)
- [Tech stack](#tech-stack)
- [License](#license)

---

<a name="what-is-cloudterm"></a>
## What is CloudTerm

- **A terminal** for SSH, telnet and serial consoles, with tabs, split panes and
  GPU-accelerated rendering.
- **An SFTP client** on the connection you already have open, with recursive
  transfers and drag and drop.
- **An RDP and VNC viewer**, so a Windows box and a Linux box live side by side
  in the same app.
- **A place to keep servers**: folders, tags, a key vault and snippets, all
  encrypted and all searchable.

<a name="features"></a>
## Features

### Terminal

- **Split panes** in any arrangement, with zoom and fullscreen
- **Tabs** you can name, colour and group, restored on the next launch
- **36 themes**, or pick the colours yourself
- **Find in scrollback** with regex, and clickable links
- **Broadcast input** to every session at once
- **Session recording** and one-click screenshots

### Connections

- **SSH, telnet and serial** in the same window
- **Jump hosts** for anything behind a bastion
- **SOCKS5, SOCKS4 and HTTP proxies**, saved once and used by any connection: terminals, SFTP, port forwards and remote desktops
- **Passwords, keys, SSH agent, certificates** and Windows Hello keys held in the TPM
- **2FA prompts** handled properly
- **Automatic reconnect** after a drop or a laptop waking up
- **Run on connect** commands, replayed every time

### Files and networking

- **Full SFTP manager**: recursive transfers, resume, conflict handling, drag and drop
- **Edit remote files** in your own editor, uploaded on every save
- **Port forwarding**: local, remote and dynamic SOCKS5, with live traffic counters
- **Remote desktops**: RDP and VNC in a pane, tunnelled through SSH

### Organisation

- **Folders and colour-coded tags** across the whole host list
- **Snippets** with prompted values, and packages that run a series of them
- **Instant search** over names, addresses and tags
- **Import** your existing `~/.ssh/config` in one step

### Security

- **Encrypted vault** for every credential, behind an optional opening password
- **Host key verification** on every connection and every hop
- **Free cloud sync**, encrypted on your machine before it is uploaded
- **Encrypted backups** that move your whole setup to another machine
- **Activity log** of every connection made and every change

---

<a name="screenshots"></a>
## Screenshots

### Hosts and keychain

Every server in folders, with tags, search and the protocol on the card. Sign in
to CloudBlast and your servers appear here on their own.

<img src="vaults%20and%20hosts%20page.png" alt="Hosts and keychain" width="100%">

### Split panes and SFTP

Files on the left, two shells on the right, one connection behind all three.
Split as far as the window allows and drag the dividers where you want them.

<img src="Split%20Pane.png" alt="Split panes and SFTP" width="100%">

### Windows RDP

A full Windows desktop in a tab, next to your Linux sessions. Clipboard works
both ways and the desktop resizes to fit the pane.

<img src="RDP.png" alt="Windows RDP" width="100%">

### Make it yours

Terminal themes, app colours, fonts and even the logo in the title bar.

<img src="Customizeable.png" alt="Appearance settings" width="100%">

---

<a name="getting-started"></a>
## Getting started

```bash
git clone https://github.com/BradPerbs/cloudterm.git
cd cloudterm
npm install
npm run dev
```

Build a portable executable into `dist/`:

```bash
npm run build
```

### Shortcuts

| | | | |
| --- | --- | --- | --- |
| `Ctrl+Shift+F` | Find in scrollback | `Alt+Shift+=` | Split right |
| `Ctrl+Shift+K` | Snippet palette | `Alt+Shift+-` | Split down |
| `Ctrl+Shift+B` | Broadcast input | `Alt+Shift+Z` | Zoom pane |
| `Ctrl+Shift+C` / `V` | Copy and paste | `Ctrl+Shift+W` | Close pane |

<a name="community"></a>
## Community

Questions, bugs, feature requests, or just want to see what is coming next?

<p>
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Join the Discord" src="https://img.shields.io/badge/Join%20the%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

Issues and pull requests are welcome here on GitHub.

<a name="tech-stack"></a>
## Tech stack

Electron · React · xterm.js · ssh2 · IronRDP (WebAssembly) · noVNC · Tailwind ·
Vite

`src/main/` is the Electron main process, one module per feature.
`src/renderer/` is the React UI: `components/` by feature, `hooks/` for state,
`lib/` for pure functions.

<a name="license"></a>
## License

CloudTerm is [fair-code](https://faircode.io) under the
[CloudTerm License](LICENSE): the source is open to read, and the software is
free to use, modify and share, at work or anywhere else. Selling it, or putting
any part of its code into something you charge for, needs a commercial license
from [CloudBlast](https://cloudblast.io), which is usually just a matter of
asking.
