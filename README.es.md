<p align="center">
  <img src="cloudterm.png" alt="CloudTerm" width="128">
</p>

<h1 align="center">CloudTerm</h1>

<p align="center">
  <strong>SSH, SFTP, Telnet y Windows RDP, todo en un solo terminal</strong>
</p>

<p align="center">
  Un espacio de trabajo de terminal moderno, hecho con Electron, React y xterm.js.<br/>
  Agente de IA · Paneles divididos · Pestañas · Transferencia de archivos · Reenvío de puertos · Escritorios remotos · Fragmentos
</p>

<p align="center">
  <a href="https://github.com/BradPerbs/cloudterm/releases/latest"><img alt="Download" src="https://img.shields.io/badge/Descargar-Última%20versión-success?style=for-the-badge&logo=github"></a>
  &nbsp;
  <a href="#"><img alt="Platform" src="https://img.shields.io/badge/Plataforma-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge&logo=electron"></a>
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/Licencia-fair--code-green?style=for-the-badge"></a>
  &nbsp;
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Discord" src="https://img.shields.io/badge/Discord-Unirse-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <strong>Español</strong> ·
  <a href="./README.ru.md">Русский</a>
</p>

---

CloudTerm reúne en una sola ventana todas las formas de llegar a un servidor.
Abre una sesión SSH, mueve archivos por SFTP, reenvía un puerto y toma un
escritorio de Windows, todo sobre la misma conexión y la misma barra de
pestañas. Sin una segunda aplicación y sin un segundo inicio de sesión.

Se conecta a lo que sea: la consola serie de tu portátil, un switch que solo
habla telnet, una máquina Windows por RDP o un servidor en el proveedor que
prefieras. CloudTerm está hecho por [CloudBlast](https://cloudblast.io), una
empresa de hosting VPS. Es gratuito para todo el mundo y todo el código está aquí
para leerlo y modificarlo.

<img src="Main%20Image.png" alt="CloudTerm" width="100%">

---

<h2 align="center">☁️ Sincronización en la nube gratis, para todos</h2>

<p align="center">
  <strong>Tu configuración en todos tus equipos, sin coste alguno.</strong><br/>
  Hosts, carpetas, claves, fragmentos, claves de host de confianza y ajustes del terminal,<br/>
  cifrados en tu equipo antes de salir de él y restaurados en cuanto inicias sesión en otro sitio.
</p>

<p align="center">
  Gratis con una cuenta de <a href="https://cloudblast.io"><strong>CloudBlast</strong></a>,
  alojes o no un solo servidor con nosotros.
</p>

<p align="center">
  <a href="https://cloudblast.io"><img alt="Crear una cuenta gratis" src="https://img.shields.io/badge/Crear%20una%20cuenta%20gratis-cloudblast.io-0aa2c0?style=for-the-badge"></a>
</p>

<p align="center">
  <sub>¿Ya eres cliente de CloudBlast? Tus servidores aparecen solos en la lista de hosts, listos para conectar.</sub>
</p>

---

## Contenido

- [Descargas](#download)
- [Qué es CloudTerm](#what-is-cloudterm)
- [Características](#features)
- [Capturas](#screenshots)
- [Primeros pasos](#getting-started)
- [Comunidad](#community)
- [Colaboradores](#contributors)
- [Tecnología](#tech-stack)
- [Licencia](#license)

---

<a name="what-is-cloudterm"></a>
## Qué es CloudTerm

- **Un terminal** para SSH, telnet y consolas serie, con pestañas, paneles
  divididos y renderizado acelerado por GPU.
- **Un cliente SFTP** sobre la conexión que ya tienes abierta, con
  transferencias recursivas y arrastrar y soltar.
- **Un visor RDP y VNC**, para que una máquina Windows y una Linux convivan en
  la misma aplicación.
- **Un sitio donde guardar servidores**: carpetas, etiquetas, un almacén de
  claves y fragmentos, todo cifrado y todo buscable.
- **Un agente de IA** en un panel junto al terminal, que lee la sesión que
  tienes delante y trabaja en el servidor a través de ella, preguntando antes
  de cambiar nada.

<a name="features"></a>
## Características

### Agente de IA

<p align="center">
  <img src="docs/logos/claude-code.svg" alt="Claude Code" title="Claude Code" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/codex.svg" alt="Codex" title="Codex" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/opencode.svg" alt="OpenCode" title="OpenCode" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/grok.svg" alt="Grok Build" title="Grok Build" height="34">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/logos/local-model.svg" alt="Modelo local" title="Modelo local" height="34">
  <br/>
  <sub><b>Claude Code</b> &nbsp;·&nbsp; <b>Codex</b> &nbsp;·&nbsp; <b>OpenCode</b>
  &nbsp;·&nbsp; <b>Grok Build</b> &nbsp;·&nbsp; <b>Modelo local</b></sub>
</p>

- **Funciona con Claude Code, Codex, OpenCode o Grok Build que ya tienes** en tu
  máquina, con tu propia cuenta: nada que pegar, ninguna suscripción adicional
- **O con un modelo local** servido en tu propio ordenador (LM Studio, Ollama,
  llama.cpp, vLLM): sin cuenta, sin clave y sin que nada salga de la máquina
- **Lee la sesión que estás mirando**, así que responde al error que tienes en
  pantalla sin que pegues nada
- **Trabaja en el terminal que ves**: los comandos se escriben en el panel y la
  salida se queda en tu historial, o se ejecutan en un canal oculto si lo
  prefieres
- **Pregunta antes de cambiar nada**, con una lista de comandos que solo miran
  y un modo más estricto o más suelto cuando lo quieras
- **Apuntado donde tú digas**: la sesión que tienes delante, una que fijes, o
  todos los hosts que tengas guardados
- **Herramientas en vez de suposiciones**: conectar un host guardado, leer y
  escribir archivos, responder a una pregunta que ya está esperando, leer el
  historial
- **Deja en paz tu propia máquina** salvo que le digas lo contrario, y se
  detiene solo en vez de dar vueltas
- **Modelo y nivel de razonamiento por conversación**, y mientras trabaja
  muestra lo que cuesta o cuánto de tu plan llevas usado

### Terminal

- **Paneles divididos** en cualquier disposición, con zoom y pantalla completa
- **Pestañas** con nombre, color y grupo, restauradas al volver a abrir
- **36 temas**, o elige tú mismo los colores
- **Búsqueda en el historial** con expresiones regulares, y enlaces pulsables
- **Entrada difundida** a todas las sesiones a la vez
- **Grabación de sesiones** y capturas con un clic

### Conexiones

- **SSH, telnet y serie** en la misma ventana
- **Hosts de salto** para todo lo que esté detrás de un bastión
- **Contraseñas, claves, agente SSH, certificados** y claves de Windows Hello
  guardadas en el TPM
- **Solicitudes de 2FA** gestionadas como es debido
- **Reconexión automática** tras una caída o al despertar el portátil
- **Comandos al conectar**, repetidos en cada reconexión

### Archivos y red

- **Gestor SFTP completo**: transferencias recursivas, reanudación, resolución
  de conflictos y arrastrar y soltar
- **Edita archivos remotos** en tu propio editor, subidos en cada guardado
- **Reenvío de puertos**: local, remoto y SOCKS5 dinámico, con contadores de
  tráfico en vivo
- **Escritorios remotos**: RDP y VNC en un panel, tunelizados por SSH

### Organización

- **Carpetas y etiquetas de colores** en toda la lista de hosts
- **Fragmentos** con valores que se piden al vuelo, y paquetes que ejecutan
  varios en orden
- **Búsqueda instantánea** por nombre, dirección y etiqueta
- **Importa** tu `~/.ssh/config` existente en un paso

### Sistemas operativos

El sistema se detecta al conectar, y la tarjeta del host y la pestaña toman su
logo, así que distingues una máquina Debian de una Fedora de un vistazo en vez
de leer nombres.

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

### Seguridad

- **Almacén cifrado** para cada credencial, tras una contraseña de apertura
  opcional
- **Verificación de claves de host** en cada conexión y en cada salto
- **Sincronización en la nube gratuita**, cifrada en tu equipo antes de subirse
- **Copias de seguridad cifradas** que llevan toda tu configuración a otro equipo
- **Registro de actividad** de cada conexión y cada cambio

---

<a name="screenshots"></a>
## Capturas

### Hosts y llavero

Cada servidor en carpetas, con etiquetas, búsqueda y el protocolo en la tarjeta.
Inicia sesión en CloudBlast y tus servidores aparecen aquí solos.

<img src="hostscloudterm.png" alt="Hosts y llavero" width="100%">

### Paneles divididos y SFTP

Archivos a la izquierda, dos shells a la derecha, una sola conexión detrás de
las tres. Divide hasta donde dé la ventana y arrastra los separadores a tu gusto.

<img src="Split%20Pane.png" alt="Paneles divididos y SFTP" width="100%">

### Windows RDP

Un escritorio de Windows completo en una pestaña, junto a tus sesiones de Linux.
El portapapeles funciona en ambos sentidos y el escritorio se ajusta al panel.

<img src="RDP.png" alt="Windows RDP" width="100%">

### Hazlo tuyo

Temas del terminal, colores de la aplicación, fuentes e incluso el logo de la
barra de título.

<img src="Customizeable.png" alt="Ajustes de apariencia" width="100%">

---

<a name="getting-started"></a>
## Primeros pasos

<a name="download"></a>
### Descargas

Descarga la última versión para tu plataforma:

| SO | Descarga |
| --- | --- |
| macOS | [Apple silicon (M1 y posteriores)](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-arm64.dmg) · [Intel](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x64.dmg) |
| Windows | [Instalador, x64 (recomendado)](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-Setup-x64.exe) · [Portable, x64](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x64.exe) |
| Linux | [AppImage, x64](https://github.com/BradPerbs/cloudterm/releases/latest/download/CloudTerm-x86_64.AppImage) |

En Windows también puedes instalarlo y actualizarlo desde una terminal:

```powershell
winget install CloudBlast.CloudTerm
```

También puedes consultar [todas las versiones en GitHub](https://github.com/BradPerbs/cloudterm/releases).

### Compilar desde el código fuente

```bash
git clone https://github.com/BradPerbs/cloudterm.git
cd cloudterm
npm install
npm run dev
```

Para usar el agente de IA con OpenCode, instala la CLI `opencode` y configura
al menos un proveedor de modelos con `opencode auth login`. CloudTerm utiliza
los proveedores y credenciales existentes de OpenCode; no los copia ni almacena.

Compila un ejecutable portable en `dist/`:

```bash
npm run build
```

### Atajos

| | | | |
| --- | --- | --- | --- |
| `Ctrl+Shift+F` | Buscar en el historial | `Alt+Shift+=` | Dividir a la derecha |
| `Ctrl+Shift+K` | Paleta de fragmentos | `Alt+Shift+-` | Dividir abajo |
| `Ctrl+Shift+B` | Entrada difundida | `Alt+Shift+Z` | Ampliar panel |
| `Ctrl+Shift+C` / `V` | Copiar y pegar | `Ctrl+Shift+W` | Cerrar panel |
| `Ctrl+Shift+A` | Agente de IA | `Alt+Flechas` | Moverse entre paneles |

<a name="community"></a>
## Comunidad

¿Dudas, errores, ideas para nuevas funciones, o simplemente quieres ver qué
viene después?

<p>
  <a href="https://discord.gg/7M84Xp8QBr"><img alt="Unirse al Discord" src="https://img.shields.io/badge/Unirse%20al%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

Las issues y los pull requests son bienvenidos aquí en GitHub.

<a name="contributors"></a>
## Colaboradores

Gracias a todas las personas que han aportado su trabajo a CloudTerm.

<a href="https://github.com/BradPerbs/cloudterm/graphs/contributors">
  <img alt="Colaboradores" src="https://contrib.rocks/image?repo=BradPerbs/cloudterm" />
</a>

<a name="tech-stack"></a>
## Tecnología

Electron · React · xterm.js · ssh2 · IronRDP (WebAssembly) · noVNC · Tailwind ·
Vite · Claude Agent SDK · Codex SDK · OpenCode SDK

`src/main/` es el proceso principal de Electron, un módulo por función.
`src/renderer/` es la interfaz React: `components/` por función, `hooks/` para el
estado y `lib/` para funciones puras.

<a name="license"></a>
## Licencia

CloudTerm es [fair-code](https://faircode.io) bajo la
[Licencia CloudTerm](LICENSE): el código está abierto y el software se puede
usar, modificar y compartir libremente, en el trabajo o donde sea. Venderlo, o
meter cualquier parte de su código en algo por lo que cobres, requiere una
licencia comercial de [CloudBlast](https://cloudblast.io), que normalmente basta
con pedir.
