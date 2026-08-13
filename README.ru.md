<p align="center">
  <img src="cloudterm.png" alt="CloudTerm" width="128">
</p>

<h1 align="center">CloudTerm</h1>

<p align="center">
  <strong>SSH, SFTP, Telnet и Windows RDP в одном терминале</strong>
</p>

<p align="center">
  Современное терминальное рабочее пространство на Electron, React и xterm.js.<br/>
  ИИ-агент · Разделение панелей · Вкладки · Передача файлов · Проброс портов · Удалённые рабочие столы · Сниппеты
</p>

<p align="center">
  <a href="https://github.com/BradPerbs/cloudterm/releases/latest"><img alt="Download" src="https://img.shields.io/badge/%D0%A1%D0%BA%D0%B0%D1%87%D0%B0%D1%82%D1%8C-%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D1%8F%D1%8F%20%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F-success?style=for-the-badge&logo=github"></a>
  &nbsp;
  <a href="#"><img alt="Platform" src="https://img.shields.io/badge/%D0%9F%D0%BB%D0%B0%D1%82%D1%84%D0%BE%D1%80%D0%BC%D0%B0-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge&logo=electron"></a>
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/%D0%9B%D0%B8%D1%86%D0%B5%D0%BD%D0%B7%D0%B8%D1%8F-fair--code-green?style=for-the-badge"></a>
  &nbsp;
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Discord" src="https://img.shields.io/badge/Discord-%D0%9F%D1%80%D0%B8%D1%81%D0%BE%D0%B5%D0%B4%D0%B8%D0%BD%D0%B8%D1%82%D1%8C%D1%81%D1%8F-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.es.md">Español</a> ·
  <strong>Русский</strong>
</p>

---

CloudTerm собирает все способы подключения к серверу в одном окне. Откройте
сеанс SSH, передайте файлы по SFTP, пробросьте порт и подключитесь к рабочему
столу Windows, и всё это в рамках одного соединения и одной строки вкладок. Без
второй программы и без второго входа.

Он подключается к чему угодно: к последовательной консоли ноутбука, к
коммутатору, который понимает только telnet, к машине с Windows по RDP или к
серверу у любого провайдера. CloudTerm сделан компанией
[CloudBlast](https://cloudblast.io), хостинг-провайдером VPS. Он бесплатен для
всех, а весь исходный код лежит здесь: читайте и меняйте.

<img src="Main%20Image.png" alt="CloudTerm" width="100%">

---

<h2 align="center">☁️ Бесплатная облачная синхронизация для всех</h2>

<p align="center">
  <strong>Ваша конфигурация на каждом компьютере, полностью бесплатно.</strong><br/>
  Хосты, папки, ключи, сниппеты, доверенные ключи серверов и настройки терминала<br/>
  шифруются на вашем компьютере до отправки и восстанавливаются, как только вы войдёте в аккаунт на другой машине.
</p>

<p align="center">
  Бесплатно с аккаунтом <a href="https://cloudblast.io"><strong>CloudBlast</strong></a>,
  даже если у вас нет у нас ни одного сервера.
</p>

<p align="center">
  <a href="https://cloudblast.io"><img alt="Создать бесплатный аккаунт" src="https://img.shields.io/badge/%D0%A1%D0%BE%D0%B7%D0%B4%D0%B0%D1%82%D1%8C%20%D0%B0%D0%BA%D0%BA%D0%B0%D1%83%D0%BD%D1%82-cloudblast.io-0aa2c0?style=for-the-badge"></a>
</p>

<p align="center">
  <sub>Уже клиент CloudBlast? Ваши серверы сами появятся в списке хостов, готовые к подключению.</sub>
</p>

---

## Содержание

- [Скачать](#download)
- [Что такое CloudTerm](#what-is-cloudterm)
- [Возможности](#features)
- [Скриншоты](#screenshots)
- [Начало работы](#getting-started)
- [Сообщество](#community)
- [Участники](#contributors)
- [Технологии](#tech-stack)
- [Лицензия](#license)

---

<a name="what-is-cloudterm"></a>
## Что такое CloudTerm

- **Терминал** для SSH, telnet и последовательных консолей, со вкладками,
  разделением панелей и отрисовкой на GPU.
- **SFTP-клиент** поверх уже открытого соединения, с рекурсивной передачей и
  перетаскиванием файлов.
- **Просмотрщик RDP и VNC**, чтобы машина с Windows и машина с Linux
  соседствовали в одном приложении.
- **Место для хранения серверов**: папки, теги, хранилище ключей и сниппеты,
  всё зашифровано и доступно для поиска.
- **ИИ-агент** в панели рядом с терминалом: читает сеанс, который перед вами, и
  работает на сервере через него, спрашивая, прежде чем что-то менять.

<a name="features"></a>
## Возможности

### ИИ-агент

<p align="center">
  <img src="docs/logos/claude-code.svg" alt="Claude Code" title="Claude Code" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/codex.svg" alt="Codex" title="Codex" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/opencode.svg" alt="OpenCode" title="OpenCode" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/grok.svg" alt="Grok Build" title="Grok Build" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/local-model.svg" alt="Локальная модель" title="Локальная модель" height="34">
  <br/>
  <sub><b>Claude Code</b> &nbsp;·&nbsp; <b>Codex</b> &nbsp;·&nbsp; <b>OpenCode</b>
  &nbsp;·&nbsp; <b>Grok Build</b> &nbsp;·&nbsp; <b>Локальная модель</b></sub>
</p>

- **Работает на уже установленных у вас Claude Code, Codex, OpenCode или Grok
  Build**, под вашей собственной учётной записью: ничего не нужно вставлять и ни
  на что дополнительно подписываться
- **Или на локальной модели**, запущенной на вашем же компьютере (LM Studio,
  Ollama, llama.cpp, vLLM): без учётной записи, без ключа, и ничего не покидает
  машину
- **Читает сеанс, который вы смотрите**, поэтому отвечает на ту ошибку, что у
  вас на экране, и вставлять её не нужно
- **Работает в терминале, который вы видите**: команды печатаются в панели, а
  вывод остаётся в вашем буфере. Или выполняются в скрытом канале, если так
  удобнее
- **Спрашивает, прежде чем что-то менять**, со списком команд, которые только
  смотрят, и режимом строже или свободнее, когда он нужен
- **Направлен туда, куда скажете**: сеанс перед вами, закреплённый сеанс или
  все сохранённые хосты
- **Инструменты вместо догадок**: подключиться к сохранённому хосту, читать и
  писать файлы, ответить на уже ждущий запрос, прочитать буфер
- **Не трогает вашу машину**, пока вы не разрешите, и останавливается сам, а не
  ходит по кругу
- **Модель и уровень рассуждения для каждого разговора**, а во время работы
  видно, во что это обходится или сколько от тарифа израсходовано

### Терминал

- **Разделение панелей** в любой раскладке, с увеличением и полноэкранным режимом
- **Вкладки** с именем, цветом и группой, восстанавливаются при следующем запуске
- **36 тем** или собственный набор цветов
- **Поиск по буферу** с регулярными выражениями и кликабельные ссылки
- **Широковещательный ввод** сразу во все сеансы
- **Запись сеансов** и скриншоты в один клик

### Подключения

- **SSH, telnet и последовательный порт** в одном окне
- **Прыжковые хосты** для всего, что находится за бастионом
- **Пароли, ключи, SSH-агент, сертификаты** и ключи Windows Hello, хранящиеся в TPM
- **Запросы 2FA** обрабатываются корректно
- **Автоматическое переподключение** после обрыва или пробуждения ноутбука
- **Команды при подключении**, выполняются при каждом соединении

### Файлы и сеть

- **Полноценный SFTP-менеджер**: рекурсивная передача, докачка, разрешение
  конфликтов, перетаскивание
- **Правка удалённых файлов** в своём редакторе, загрузка при каждом сохранении
- **Проброс портов**: локальный, удалённый и динамический SOCKS5, со счётчиками
  трафика в реальном времени
- **Удалённые рабочие столы**: RDP и VNC прямо в панели, через SSH-туннель

### Организация

- **Папки и цветные теги** по всему списку хостов
- **Сниппеты** с запросом значений и пакеты, выполняющие их по порядку
- **Мгновенный поиск** по именам, адресам и тегам
- **Импорт** существующего `~/.ssh/config` в один шаг

### Операционные системы

Система определяется при подключении, и карточка хоста и вкладка берут её
логотип, так что машина на Debian отличается от машины на Fedora с первого
взгляда, без чтения имён.

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

### Безопасность

- **Зашифрованное хранилище** для всех учётных данных, при желании за паролем на
  запуск
- **Проверка ключей хостов** при каждом подключении и на каждом переходе
- **Бесплатная облачная синхронизация**, шифруется на вашем компьютере до отправки
- **Зашифрованные резервные копии**, переносящие всю конфигурацию на другую машину
- **Журнал активности** по каждому подключению и каждому изменению

---

<a name="screenshots"></a>
## Скриншоты

### Хосты и хранилище ключей

Все серверы разложены по папкам, с тегами, поиском и протоколом прямо на
карточке. Войдите в CloudBlast, и ваши серверы появятся здесь сами.

<img src="hostscloudterm.png" alt="Хосты и хранилище ключей" width="100%">

### Разделение панелей и SFTP

Слева файлы, справа две оболочки, и одно соединение на всё это. Делите столько,
сколько позволяет окно, и двигайте разделители как удобно.

<img src="Split%20Pane.png" alt="Разделение панелей и SFTP" width="100%">

### Windows RDP

Полноценный рабочий стол Windows во вкладке, рядом с сеансами Linux. Буфер
обмена работает в обе стороны, а разрешение подстраивается под размер панели.

<img src="RDP.png" alt="Windows RDP" width="100%">

### Настройте под себя

Темы терминала, цвета интерфейса, шрифты и даже логотип в заголовке окна.

<img src="Customizeable.png" alt="Настройки внешнего вида" width="100%">

---

<a name="getting-started"></a>
## Начало работы

<a name="download"></a>
### Скачать

Скачайте последнюю версию для вашей платформы:

| ОС | Скачать |
| --- | --- |
| macOS | [Apple silicon (M1 и новее)](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-arm64.dmg) · [Intel](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x64.dmg) |
| Windows | [Установщик, x64 (рекомендуется)](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-Setup-x64.exe) · [Портативная версия, x64](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x64.exe) |
| Linux | [AppImage, x64](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x86_64.AppImage) |

В Windows его также можно установить и обновлять из терминала:

```powershell
winget install CloudBlast.CloudTerm
```

Или просмотрите [все релизы на GitHub](https://github.com/BradPerbs/cloudterm/releases).

### Сборка из исходного кода

```bash
git clone https://github.com/BradPerbs/cloudterm.git
cd cloudterm
npm install
npm run dev
```

Чтобы использовать ИИ-агента с OpenCode, установите CLI `opencode` и настройте
хотя бы одного провайдера моделей командой `opencode auth login`. CloudTerm
использует существующие провайдеры и учётные данные OpenCode, не копируя и не
сохраняя их.

Собрать переносимый исполняемый файл в `dist/`:

```bash
npm run build
```

### Горячие клавиши

| | | | |
| --- | --- | --- | --- |
| `Ctrl+Shift+F` | Поиск по буферу | `Alt+Shift+=` | Разделить вправо |
| `Ctrl+Shift+K` | Палитра сниппетов | `Alt+Shift+-` | Разделить вниз |
| `Ctrl+Shift+B` | Широковещательный ввод | `Alt+Shift+Z` | Увеличить панель |
| `Ctrl+Shift+C` / `V` | Копировать и вставить | `Ctrl+Shift+W` | Закрыть панель |
| `Ctrl+Shift+A` | ИИ-агент | `Alt+Стрелки` | Переход между панелями |

<a name="community"></a>
## Сообщество

Вопросы, ошибки, идеи для новых возможностей или просто хотите узнать, что будет
дальше?

<p>
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Присоединиться к Discord" src="https://img.shields.io/badge/%D0%9F%D1%80%D0%B8%D1%81%D0%BE%D0%B5%D0%B4%D0%B8%D0%BD%D0%B8%D1%82%D1%8C%D1%81%D1%8F%20%D0%BA%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

Issues и pull requests на GitHub тоже приветствуются.

<a name="contributors"></a>
## Участники

Спасибо всем, кто вложил свой труд в CloudTerm.

<a href="https://github.com/BradPerbs/cloudterm/graphs/contributors">
  <img alt="Участники" src="https://contrib.rocks/image?repo=BradPerbs/cloudterm" />
</a>

<a name="tech-stack"></a>
## Технологии

Electron · React · xterm.js · ssh2 · IronRDP (WebAssembly) · noVNC · Tailwind ·
Vite · Claude Agent SDK · Codex SDK · OpenCode SDK

`src/main/` это главный процесс Electron, по одному модулю на возможность.
`src/renderer/` это интерфейс на React: `components/` по функциям, `hooks/` для
состояния, `lib/` для чистых функций.

<a name="license"></a>
## Лицензия

CloudTerm распространяется по модели [fair-code](https://faircode.io), условия
изложены в [Лицензии CloudTerm](LICENSE): исходный код открыт, а программу можно
свободно использовать, изменять и передавать, в том числе на работе. Продавать
её или включать любую часть её кода в то, за что вы берёте деньги, можно только
по коммерческой лицензии от [CloudBlast](https://cloudblast.io), и обычно
достаточно просто попросить.
