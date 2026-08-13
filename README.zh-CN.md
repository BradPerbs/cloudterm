<p align="center">
  <img src="cloudterm.png" alt="CloudTerm" width="128">
</p>

<h1 align="center">CloudTerm</h1>

<p align="center">
  <strong>SSH、SFTP、Telnet 与 Windows RDP，全部集于一个终端</strong>
</p>

<p align="center">
  基于 Electron、React 和 xterm.js 打造的现代终端工作区。<br/>
  AI 助手 · 分屏 · 标签页 · 文件传输 · 端口转发 · 远程桌面 · 命令片段
</p>

<p align="center">
  <a href="https://github.com/BradPerbs/cloudterm/releases/latest"><img alt="Download" src="https://img.shields.io/badge/Download-Latest-success?style=for-the-badge&logo=github"></a>
  &nbsp;
  <a href="#"><img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge&logo=electron"></a>
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-fair--code-green?style=for-the-badge"></a>
  &nbsp;
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.ru.md">Русский</a>
</p>

---

CloudTerm 把连接服务器的所有方式放进同一个窗口。开一个 SSH 会话、用 SFTP 传文件、
转发一个端口、接管一台 Windows 桌面，全都在同一条连接、同一排标签页上完成。不需要
第二个程序，也不需要第二次登录。

它能连接任何设备：笔记本上的串口控制台、只会说 telnet 的交换机、通过 RDP 访问的
Windows 主机，或者任意服务商上的服务器。CloudTerm 由 VPS 云主机公司
[CloudBlast](https://cloudblast.io) 开发，对所有人免费，全部源码都在这个仓库里，可以随意阅读和修改。

<img src="Main%20Image.png" alt="CloudTerm" width="100%">

---

<h2 align="center">☁️ 免费云同步，人人可用</h2>

<p align="center">
  <strong>在你用的每一台电脑上，都是同一套配置，完全免费。</strong><br/>
  主机、文件夹、密钥、命令片段、已信任的主机密钥和终端设置，<br/>
  先在本机加密再上传，换一台设备登录即刻还原。
</p>

<p align="center">
  只要有 <a href="https://cloudblast.io"><strong>CloudBlast</strong></a> 账号即可免费使用，
  无论你是否在我们这里托管服务器。
</p>

<p align="center">
  <a href="https://cloudblast.io"><img alt="Get a free account" src="https://img.shields.io/badge/%E5%85%8D%E8%B4%B9%E6%B3%A8%E5%86%8C-cloudblast.io-0aa2c0?style=for-the-badge"></a>
</p>

<p align="center">
  <sub>已经是 CloudBlast 用户？你的服务器会自动出现在主机列表里，随时可以连接。</sub>
</p>

---

## 目录

- [下载](#download)
- [什么是 CloudTerm](#what-is-cloudterm)
- [功能](#features)
- [界面截图](#screenshots)
- [快速开始](#getting-started)
- [社区](#community)
- [贡献者](#contributors)
- [技术栈](#tech-stack)
- [许可证](#license)

---

<a name="what-is-cloudterm"></a>
## 什么是 CloudTerm

- **一个终端**：SSH、telnet 和串口控制台，带标签页、分屏和 GPU 加速渲染。
- **一个 SFTP 客户端**：复用已经打开的连接，支持递归传输和拖放。
- **一个 RDP 和 VNC 客户端**：Windows 主机和 Linux 主机并排放在同一个程序里。
- **一个存放服务器的地方**：文件夹、标签、密钥库和命令片段，全部加密、全部可搜索。

<a name="features"></a>
## 功能

### AI 助手

<p align="center">
  <img src="docs/logos/claude-code.svg" alt="Claude Code" title="Claude Code" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/codex.svg" alt="Codex" title="Codex" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/opencode.svg" alt="OpenCode" title="OpenCode" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/grok.svg" alt="Grok Build" title="Grok Build" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/local-model.svg" alt="本地模型" title="本地模型" height="34">
  <br/>
  <sub><b>Claude Code</b> &nbsp;·&nbsp; <b>Codex</b> &nbsp;·&nbsp; <b>OpenCode</b>
  &nbsp;·&nbsp; <b>Grok Build</b> &nbsp;·&nbsp; <b>本地模型</b></sub>
</p>

- **使用本机已有的 Claude Code、Codex、OpenCode 或 Grok Build**，沿用你自己的账号和配置
- **也可以用本地模型**：LM Studio、Ollama、llama.cpp、vLLM 等，无需账号和密钥，任何内容都不会离开这台电脑
- **读取当前会话并操作远程服务器**，执行更改前会先征求你的同意
- **每个对话可单独选择模型和推理强度**，并在运行时显示用量

### 终端

- **任意分屏**，可放大单个面板，也可全屏
- **标签页**可命名、上色、分组，下次启动自动恢复
- **36 款主题**，也可以自己配色
- **回滚区搜索**支持正则，链接可直接点击
- **广播输入**，一次输入发往所有会话
- **会话录制**和一键截图

### 连接

- **SSH、telnet 和串口**同处一个窗口
- **跳板机**，穿过堡垒机连到内网
- **密码、密钥、SSH agent、证书**，以及保存在 TPM 里的 Windows Hello 密钥
- **两步验证**提示能正确处理
- **自动重连**，掉线或笔记本唤醒后都会重新连上
- **连接时执行**的命令，每次连上都会重放

### 文件与网络

- **完整的 SFTP 管理器**：递归传输、断点续传、冲突处理、拖放
- **用本地编辑器改远程文件**，每次保存自动上传
- **端口转发**：本地、远程和动态 SOCKS5，带实时流量统计
- **远程桌面**：RDP 和 VNC 直接开在面板里，经 SSH 隧道传输

### 整理

- **文件夹和彩色标签**，贯穿整个主机列表
- **命令片段**支持参数提示，还能打包成一串按顺序执行
- **即时搜索**名称、地址和标签
- **一步导入**现有的 `~/.ssh/config`

### 操作系统

连接时会自动识别系统，主机卡片和标签页会显示对应的标志，一眼就能分辨
Debian 和 Fedora 的机器，不用去读主机名。

<p align="center">
  <img src="src/renderer/assets/icons/128_debian.png" alt="Debian" title="Debian" width="42">
  <img src="src/renderer/assets/icons/128_ubuntu.png" alt="Ubuntu" title="Ubuntu" width="42">
  <img src="src/renderer/assets/icons/128_kubuntu.png" alt="Kubuntu" title="Kubuntu" width="42">
  <img src="src/renderer/assets/icons/128_lubuntu.png" alt="Lubuntu" title="Lubuntu" width="42">
  <img src="src/renderer/assets/icons/128_xubuntu.png" alt="Xubuntu" title="Xubuntu" width="42">
  <img src="src/renderer/assets/icons/128_mint.png" alt="Linux Mint" title="Linux Mint" width="42">
  <img src="src/renderer/assets/icons/128_pop.png" alt="Pop!_OS" title="Pop!_OS" width="42">
  <img src="src/renderer/assets/icons/128_elementary.png" alt="elementary OS" title="elementary OS" width="42">
  <img src="src/renderer/assets/icons/128_zorin.png" alt="Zorin OS" title="Zorin OS" width="42">
  <img src="src/renderer/assets/icons/128_mx.png" alt="MX Linux" title="MX Linux" width="42">
  <img src="src/renderer/assets/icons/128_deepin.png" alt="deepin" title="deepin" width="42">
  <img src="src/renderer/assets/icons/128_raspios.png" alt="Raspberry Pi OS" title="Raspberry Pi OS" width="42">
  <img src="src/renderer/assets/icons/128_kali.png" alt="Kali Linux" title="Kali Linux" width="42">
  <img src="src/renderer/assets/icons/128_parrot.png" alt="Parrot OS" title="Parrot OS" width="42">
  <img src="src/renderer/assets/icons/128_tails.png" alt="Tails" title="Tails" width="42">
  <br/>
  <img src="src/renderer/assets/icons/128_fedora_newlogo.png" alt="Fedora" title="Fedora" width="42">
  <img src="src/renderer/assets/icons/128_redhat.png" alt="Red Hat Enterprise Linux" title="Red Hat Enterprise Linux" width="42">
  <img src="src/renderer/assets/icons/128_centos_blue.png" alt="CentOS" title="CentOS" width="42">
  <img src="src/renderer/assets/icons/128_alma_darkblue.png" alt="AlmaLinux" title="AlmaLinux" width="42">
  <img src="src/renderer/assets/icons/128_suse.png" alt="openSUSE and SLES" title="openSUSE and SLES" width="42">
  <img src="src/renderer/assets/icons/128_arch.png" alt="Arch Linux" title="Arch Linux" width="42">
  <img src="src/renderer/assets/icons/128_manjaro.png" alt="Manjaro" title="Manjaro" width="42">
  <img src="src/renderer/assets/icons/128_endeavour.png" alt="EndeavourOS" title="EndeavourOS" width="42">
  <img src="src/renderer/assets/icons/128_garuda_blue.png" alt="Garuda Linux" title="Garuda Linux" width="42">
  <img src="src/renderer/assets/icons/128_arco.png" alt="ArcoLinux" title="ArcoLinux" width="42">
  <img src="src/renderer/assets/icons/128_artix.png" alt="Artix Linux" title="Artix Linux" width="42">
  <br/>
  <img src="src/renderer/assets/icons/128_alpine.png" alt="Alpine Linux" title="Alpine Linux" width="42">
  <img src="src/renderer/assets/icons/128_nixos.png" alt="NixOS" title="NixOS" width="42">
  <img src="src/renderer/assets/icons/128_gentoo.png" alt="Gentoo" title="Gentoo" width="42">
  <img src="src/renderer/assets/icons/128_void.png" alt="Void Linux" title="Void Linux" width="42">
  <img src="src/renderer/assets/icons/128_solus.png" alt="Solus" title="Solus" width="42">
  <img src="src/renderer/assets/icons/128_slackware.png" alt="Slackware" title="Slackware" width="42">
  <img src="src/renderer/assets/icons/128_linux.png" alt="Linux" title="Any other Linux" width="42">
  <img src="src/renderer/assets/icons/128_windows.png" alt="Windows" title="Windows" width="42">
  <img src="docs/logos/macos.svg" alt="macOS" title="macOS" width="42">
</p>

### 安全

- **加密保险库**存放所有凭据，可选设置启动密码
- **主机密钥校验**，每次连接、每一跳都验证
- **免费云同步**，上传前先在本机加密
- **加密备份**，把整套配置搬到另一台机器
- **活动日志**记录每一次连接和每一次改动

---

<a name="screenshots"></a>
## 界面截图

### 主机与密钥库

所有服务器按文件夹整理，带标签、搜索，卡片上直接标明协议。登录 CloudBlast 之后，
你的服务器会自动出现在这里。

<img src="hostscloudterm.png" alt="主机与密钥库" width="100%">

### 分屏与 SFTP

左边是文件，右边是两个 shell，背后只有一条连接。窗口能放下多少就能分多少，
分隔条随手拖动。

<img src="Split%20Pane.png" alt="分屏与 SFTP" width="100%">

### Windows 远程桌面

完整的 Windows 桌面就开在标签页里，和 Linux 会话并排。剪贴板双向同步，
桌面分辨率会跟着面板变化。

<img src="RDP.png" alt="Windows 远程桌面" width="100%">

### 打造成你喜欢的样子

终端主题、界面配色、字体，连标题栏上的图标都能换。

<img src="Customizeable.png" alt="外观设置" width="100%">

---

<a name="getting-started"></a>
## 快速开始

<a name="download"></a>
### 下载

下载适用于你平台的最新版本：

| 操作系统 | 下载 |
| --- | --- |
| macOS | [Apple 芯片（M1 及更新机型）](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-arm64.dmg) · [Intel](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x64.dmg) |
| Windows | [安装版，x64（推荐）](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-Setup-x64.exe) · [便携版，x64](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x64.exe) |
| Linux | [AppImage，x64](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x86_64.AppImage) |

在 Windows 上也可以直接从终端安装和更新：

```powershell
winget install CloudBlast.CloudTerm
```

也可以浏览 [GitHub 上的全部版本](https://github.com/BradPerbs/cloudterm/releases)。

### 从源码构建

```bash
git clone https://github.com/BradPerbs/cloudterm.git
cd cloudterm
npm install
npm run dev
```

要通过 OpenCode 使用 AI 助手，请安装 `opencode` CLI，并运行
`opencode auth login` 配置至少一个模型提供商。CloudTerm 只使用 OpenCode
现有的提供商和凭据，不会复制或保存它们。

构建便携版可执行文件，输出到 `dist/`：

```bash
npm run build
```

### 快捷键

| | | | |
| --- | --- | --- | --- |
| `Ctrl+Shift+F` | 回滚区搜索 | `Alt+Shift+=` | 向右分屏 |
| `Ctrl+Shift+K` | 片段面板 | `Alt+Shift+-` | 向下分屏 |
| `Ctrl+Shift+B` | 广播输入 | `Alt+Shift+Z` | 放大面板 |
| `Ctrl+Shift+C` / `V` | 复制与粘贴 | `Ctrl+Shift+W` | 关闭面板 |

<a name="community"></a>
## 社区

有疑问、发现 bug、想提需求，或者只是想看看接下来会做什么？

<p>
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Join the Discord" src="https://img.shields.io/badge/Join%20the%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

也欢迎在 GitHub 上提交 issue 和 pull request。

<a name="contributors"></a>
## 贡献者

感谢每一位为 CloudTerm 付出努力的人。

<a href="https://github.com/BradPerbs/cloudterm/graphs/contributors">
  <img alt="贡献者" src="https://contrib.rocks/image?repo=BradPerbs/cloudterm" />
</a>

<a name="tech-stack"></a>
## 技术栈

Electron · React · xterm.js · ssh2 · IronRDP（WebAssembly）· noVNC · Tailwind ·
Vite · Claude Agent SDK · Codex SDK · OpenCode SDK

`src/main/` 是 Electron 主进程，每个功能一个模块。
`src/renderer/` 是 React 界面：`components/` 按功能划分，`hooks/` 管状态，
`lib/` 放纯函数。

<a name="license"></a>
## 许可证

CloudTerm 采用 [fair-code](https://faircode.io) 模式，条款见 [CloudTerm 许可证](LICENSE)：
源码公开，软件可以自由使用、修改和免费分发，在公司里用也没问题。但要出售它，或者把它的
任何一部分代码放进你收费的产品或服务里，需要向 [CloudBlast](https://cloudblast.io)
取得商业许可，通常问一声就行。
