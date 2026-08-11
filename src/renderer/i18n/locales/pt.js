/**
 * Português (Portuguese).
 *
 * Two plural forms, `_one` and `_other`, the same shape English uses. Anything
 * missing here falls back to en.js.
 */
export default {
    /* ---- Shared words ---- */
    'common.allFiles': 'Todos os ficheiros',
    'common.apply': 'Aplicar',
    'common.cancel': 'Cancelar',
    'common.change': 'Alterar',
    'common.changeEllipsis': 'Alterar…',
    'common.clear': 'Limpar',
    'common.close': 'Fechar',
    'common.filter': 'Filtrar',
    'common.filtered': 'Filtrado.',
    'common.keepCurrentColors': 'Nenhuma (manter as cores atuais)',
    'common.left': 'Esquerda',
    'common.loading': 'A carregar…',
    'common.noFilterMatches': 'Nada corresponde a esses filtros.',
    'common.noMatches': 'Nada corresponde a “{query}”',
    'common.noMatchesTitle': 'Sem resultados',
    'common.off': 'Desligado',
    'common.remove': 'Remover',
    'common.reset': 'Repor',
    'common.right': 'Direita',
    'common.save': 'Guardar',
    'common.saveAndApply': 'Guardar e aplicar',
    'common.startFrom': 'Começar a partir de',
    'common.working': 'A trabalhar…',

    /* ---- Sidebar ---- */
    'nav.hosts': 'Anfitriões',
    'nav.keychain': 'Porta-chaves',
    'nav.proxies': 'Proxies',
    'nav.snippets': 'Excertos',
    'nav.logs': 'Registos',
    'nav.settings': 'Definições',

    /* ---- Hosts ---- */
    'hosts.count_one': '{count} anfitrião',
    'hosts.count_other': '{count} anfitriões',
    'hosts.folderCount_one': '{count} pasta',
    'hosts.folderCount_other': '{count} pastas',
    'hosts.empty': 'Ainda sem anfitriões',
    'hosts.emptyNote': 'Adicione um servidor para começar.',
    'hosts.emptyFolder': 'Ainda não há nada aqui',
    'hosts.layout': 'Disposição dos cartões',
    'hosts.newFolder': 'Nova pasta',
    'hosts.newHost': 'Novo anfitrião',
    'hosts.search': 'Procurar anfitriões',
    'hosts.viewGrid': 'Grelha',
    'hosts.viewList': 'Lista',

    /* ---- Keychain ---- */
    'keychain.count_one': '{count} chave',
    'keychain.count_other': '{count} chaves',
    'keychain.empty': 'Ainda sem chaves',
    'keychain.emptyNote': 'Gere ou importe uma para começar.',
    'keychain.helloAdd': 'Adicionar uma chave do Windows Hello, guardada no TPM deste PC',
    'keychain.helloWaiting': 'A aguardar o Windows Hello…',
    'keychain.import': 'Importar uma chave existente, de um ficheiro ou colada',
    'keychain.newKey': 'Nova chave',
    'keychain.search': 'Procurar chaves',

    /* ---- Proxies ---- */
    'proxies.empty': 'Ainda sem proxies',
    'proxies.emptyNote': 'Adicione um proxy SOCKS ou HTTP e qualquer anfitrião passa a poder ligar '
        + 'através dele: sessões de terminal, SFTP, encaminhamentos de portas e ambientes de '
        + 'trabalho remotos.',
    'proxies.newProxy': 'Novo proxy',
    'proxies.search': 'Procurar proxies',

    /* ---- Snippets ---- */
    'snippets.count_one': '{count} excerto',
    'snippets.count_other': '{count} excertos',
    'snippets.empty': 'Ainda sem excertos',
    'snippets.emptyNote': 'Guarde os comandos que reescreve em todas as máquinas.',
    'snippets.newPackage': 'Novo pacote',
    'snippets.newSnippet': 'Novo excerto',
    'snippets.nothingShown': 'Nada a mostrar',
    'snippets.search': 'Procurar excertos',
    'snippets.showing': 'A mostrar: {kind}',
    'snippets.kind.all': 'Tudo',
    'snippets.kind.command': 'Só comandos',
    'snippets.kind.package': 'Só pacotes',

    /* ---- Logs ---- */
    'logs.blurbStart': 'Todas as ligações feitas e todos os registos alterados nesta máquina, do '
        + 'mais recente para o mais antigo. Registados na conta do sistema com sessão iniciada',
    'logs.blurbEnd': ', e assinalados na linha apenas quando foi outra pessoa. Palavras-passe e '
        + 'material de chaves nunca são registados.',
    'logs.categoryConnection': 'Ligações',
    'logs.categoryData': 'Alterações',
    'logs.categoryFiles': 'Ficheiros',
    'logs.categorySecurity': 'Segurança',
    'logs.empty': 'Ainda nada registado',
    'logs.emptyNote': 'As ligações e alterações aparecem aqui à medida que as faz.',
    'logs.export': 'Exportar como JSON',
    'logs.filterAll': 'Tudo',
    'logs.filterAria': 'Filtrar o registo de atividade',
    'logs.noMatches': 'Nada corresponde a esses filtros',
    'logs.noMatchesNote': 'Experimente outra categoria, ou limpe a caixa de filtro.',
    'logs.problemsOnly': 'Só problemas',
    'logs.reading': 'A ler o registo…',
    'logs.refresh': 'Atualizar',

    /* ---- New session tab ---- */
    'newTab.title': 'Nova sessão',
    'newTab.subtitle': 'Escolha um anfitrião, ou escreva um endereço para ligar diretamente.',
    'newTab.searchPlaceholder': 'Procure anfitriões, ou escreva um endereço…',
    'newTab.recent': 'Recentes',
    'newTab.allHosts': 'Todos os anfitriões',
    'newTab.notSaved': 'Não guardado',
    'newTab.notSavedNote': 'Não guardado. Pede as credenciais à medida que liga.',
    'newTab.connectTo': 'Ligar a',
    'newTab.hintNavigate': 'navegar',
    'newTab.hintConnect': 'ligar',
    'newTab.hintClose': 'fechar separador',

    /* ---- Title bar ---- */
    'titleBar.reload': 'Recarregar',
    'titleBar.devTools': 'Ferramentas de programador',
    'titleBar.minimize': 'Minimizar',
    'titleBar.maximize': 'Maximizar',
    'titleBar.exit': 'Sair',
    'titleBar.rename': 'Mudar o nome…',
    'titleBar.renameAria': 'Mudar o nome de {name}',
    'titleBar.renameGroup': 'Mudar o nome do grupo…',
    'titleBar.renameGroupAria': 'Mudar o nome do grupo {name}',
    'titleBar.useHostName': 'Voltar a usar o nome do anfitrião',
    'titleBar.colour': 'Cor',
    'titleBar.removeFromGroup': 'Retirar do grupo',
    'titleBar.newGroup': 'Novo grupo a partir deste separador',
    'titleBar.moveToGroup': 'Mover para “{group}”',
    'titleBar.duplicate': 'Duplicar',
    'titleBar.reconnect': 'Voltar a ligar',
    'titleBar.reconnectAll': 'Voltar a ligar tudo',
    'titleBar.disconnect': 'Desligar',
    'titleBar.disconnectAll': 'Desligar tudo',
    'titleBar.closeTab': 'Fechar separador',
    'titleBar.closeOthers': 'Fechar os outros',
    'titleBar.closeRight': 'Fechar os da direita',
    'titleBar.ungroup': 'Desagrupar',
    'titleBar.closeGroupTabs_one': 'Fechar o separador',
    'titleBar.closeGroupTabs_other': 'Fechar os {count} separadores',

    /* ---- Monitoring vocabulary ---- */
    'monitor.every30s': '30 s',
    'monitor.every1min': '1 min',
    'monitor.every5min': '5 min',
    'monitor.every15min': '15 min',
    'monitor.wait5s': '5 s',
    'monitor.wait10s': '10 s',
    'monitor.wait20s': '20 s',
    'monitor.wait30s': '30 s',
    'monitor.onceFailed': 'Uma vez',
    'monitor.twiceFailed': 'Duas vezes',
    'monitor.thriceFailed': '3 vezes',
    'monitor.stateOnline': 'Responde',
    'monitor.stateOffline': 'Não responde',
    'monitor.stateProblem': 'Não é possível verificar',
    'monitor.stateUnknown': 'Ainda não verificado',
    'monitor.unsupportedSerial': 'Uma consola série não tem endereço de rede para verificar.',
    'monitor.unsupportedJump': 'Este anfitrião é alcançado através de um anfitrião de salto, por '
        + 'isso não há rota a partir desta máquina para o verificar. Vigie antes o anfitrião de salto.',
    'monitor.justNow': 'agora mesmo',
    'monitor.minutesAgo': 'há {count} min',
    'monitor.hoursAgo': 'há {count} h',
    'monitor.daysAgo': 'há {count} d',
    'monitor.notAnswering': 'não responde',
    'monitor.describeOffline': '{reason}, desde {when}',
    'monitor.describeOnline': 'respondeu, verificado {when}',
    'monitor.describeOnlineLatency': 'respondeu em {latency} ms, verificado {when}',
    'monitor.describeUnknown': 'ainda não verificado',

    /* ---- App palette editor ---- */
    'appColors.subtitle': 'As seis superfícies de que a aplicação é feita. Escolha a cor da janela '
        + 'e o resto segue, ou defina cada passo à mão.',
    'appColors.surfaces': 'Superfícies',
    'appColors.derive': 'Construir a partir de uma cor',
    'appColors.deriveHint': 'Reescreve os seis passos, mantendo o espaçamento próprio da aplicação '
        + 'entre eles',
    'appColors.base': 'Janela',
    'appColors.baseHint': 'Aquilo sobre o que assenta toda a aplicação',
    'appColors.raised': 'Painéis',
    'appColors.raisedHint': 'Cartões, caixas de diálogo, a barra lateral',
    'appColors.control': 'Controlos',
    'appColors.controlHint': 'Botões, campos e as suas margens',
    'appColors.hover': 'Sob o cursor',
    'appColors.hoverHint': 'Um controlo por baixo do ponteiro',
    'appColors.active': 'Premido',
    'appColors.activeHint': 'Um controlo a ser usado, e as linhas',
    'appColors.muted': 'Texto secundário',
    'appColors.mutedHint': 'Etiquetas secundárias e texto de sugestão',

    /* ---- Terminal palette editor ---- */
    'termColors.title': 'Tema de terminal personalizado',
    'termColors.subtitle': 'Escolha cada cor à mão, ou comece por um tema incluído e altere o que '
        + 'quiser.',
    'termColors.groupBase': 'Base',
    'termColors.groupAnsi': 'Cores ANSI',
    'termColors.background': 'Fundo',
    'termColors.foreground': 'Texto',
    'termColors.cursor': 'Cursor',
    'termColors.selection': 'Seleção',
    'termColors.black': 'Preto',
    'termColors.red': 'Vermelho',
    'termColors.green': 'Verde',
    'termColors.yellow': 'Amarelo',
    'termColors.blue': 'Azul',
    'termColors.magenta': 'Magenta',
    'termColors.cyan': 'Ciano',
    'termColors.white': 'Branco',

    /* ---- OpenSSH import ---- */
    'import.title': 'Do OpenSSH',
    'import.desc': 'Lê ~/.ssh/config e ~/.ssh/known_hosts e traz para aqui os anfitriões, os seus '
        + 'encaminhamentos de portas e as suas chaves de confiança.',
    'import.nothingFound': 'Nada encontrado em {dir}. Pode escolher um ficheiro à mesma.',
    'import.scan': 'Analisar ~/.ssh',
    'import.scanning': 'A analisar…',
    'import.scanFailed': 'Não foi possível ler a configuração SSH: {reason}',
    'import.chooseConfigTitle': 'Escolher um ficheiro de configuração SSH',
    'import.trustedKeys': 'Chaves de anfitrião de confiança',
    'import.statusPresent': 'já adicionado',
    'import.statusConflict': 'difere da chave guardada',
    'import.selectedOf': '{selected} de {count} selecionados',
    'import.keyNote': 'chave {name}',
    'import.keyNoteState': 'chave {name} ({state})',
    'import.included': 'mais {count} incluídos',
    'import.nothingToImport': 'Nada a importar destes ficheiros.',
    'import.copyKeys': 'Copiar as chaves privadas que estes anfitriões referenciam',
    'import.copyKeysDesc': 'Cada IdentityFile é lido para o porta-chaves e cifrado com o cofre do '
        + 'sistema. Sem isto, os anfitriões importados ficam a usar o seu agente SSH.',
    'import.importing': 'A importar…',
    'import.importSelected': 'Importar {count} selecionados',
    'import.nothingSelected': 'Nada selecionado',
    'import.imported': 'Importado: {what}',
    'import.nothingNew': 'Nada de novo para importar',
    'import.failed': 'A importação falhou: {reason}',
    'import.hostKeyCount_one': '{count} chave de anfitrião',
    'import.hostKeyCount_other': '{count} chaves de anfitrião',
    'import.report': 'Importados {hosts} anfitriões, {keys} chaves, {hostKeys} chaves de anfitrião.',
    'import.reportSkipped': '{count} já existiam.',
    'import.reportRelayed': '{count} ficaram a ligar através de um anfitrião de salto.',
    'import.skipHashed': '{count} com hash',
    'import.skipPatterns': '{count} com caracteres universais',
    'import.skipMarkers': '{count} de certificado ou revogados',
    'import.skipMalformed': '{count} ilegíveis',
    'import.skipped': '{what} ignorados',

    /* ---- Import from other apps ---- */
    'appImport.title': 'De outras aplicações',
    'appImport.desc': 'Anfitriões, encaminhamentos de portas, pastas e definições de série ou de '
        + 'ambiente de trabalho vêm todos. As palavras-passe ficam para trás; cada aplicação '
        + 'guarda-as cifradas à sua maneira.',
    'appImport.checking': 'A verificar…',
    'appImport.notFound': 'Não encontrado',
    'appImport.sessionCount_one': '{count} sessão guardada',
    'appImport.sessionCount_other': '{count} sessões guardadas',
    'appImport.import': 'Importar',
    'appImport.chooseFile': 'Escolher um ficheiro do MobaXterm…',
    'appImport.choosePortable': 'Instalação portátil? Escolha um ficheiro do MobaXterm…',
    'appImport.chooseFileHint': 'Um MobaXterm.ini portátil, ou uma exportação .mxtsessions',
    'appImport.chooseFileTitle': 'Escolher um ficheiro MobaXterm.ini ou .mxtsessions',
    'appImport.fileKind': 'Sessões do MobaXterm',
    'appImport.scanFailed': 'Não foi possível ler as sessões do {source}: {reason}',
    'appImport.sessionsOf': 'Sessões do {app}',
    'appImport.nothingIn': 'Nada importável no {app}.',
    'appImport.inFolder': 'em {folder}',
    'appImport.keyEncrypted': 'protegida por frase-passe',
    'appImport.keyNeedsConversion': 'precisa de conversão',
    'appImport.keyUnreadable': 'ilegível',
    'appImport.copyKeysDesc': 'Cada ficheiro de chave é lido para o porta-chaves e cifrado com o '
        + 'cofre do sistema. Sem isto, os anfitriões importados ficam a usar o seu agente SSH.',
    'appImport.report': 'Importados {hosts} anfitriões',

    /* ---- Settings navigation ---- */
    'settings.nav.aria': 'Categorias de definições',
    'settings.nav.general': 'Geral',
    'settings.nav.appearance': 'Aspeto',
    'settings.nav.terminal': 'Terminal',
    'settings.nav.assistant': 'Assistente',
    'settings.nav.monitoring': 'Monitorização',
    'settings.nav.logging': 'Registo',
    'settings.nav.security': 'Segurança',
    'settings.nav.account': 'Conta',
    'settings.nav.backup': 'Cópia de segurança',
    'settings.nav.about': 'Acerca',

    /* ---- Settings: General ---- */
    'settings.general.title': 'Geral',
    'settings.general.desc': 'Como a aplicação se comporta ao arrancar.',
    'settings.general.language': 'Idioma',
    'settings.general.languageDesc': 'O idioma em que é mostrado o texto da própria aplicação. O '
        + 'que o terminal e os seus servidores escrevem fica exatamente como chega.',
    'settings.general.languageChanged': 'Idioma alterado para {language}',
    'settings.general.startup': 'Iniciar com a sessão',
    'settings.general.startupDesc': 'Abrir o CloudTerm automaticamente quando inicia sessão neste '
        + 'computador',
    'settings.general.startupOn': 'O CloudTerm abrirá quando iniciar sessão',
    'settings.general.startupOff': 'O CloudTerm deixará de abrir quando iniciar sessão',
    'settings.general.startupFailed': 'Não foi possível alterar isso',
    'settings.general.startupUnknown': 'Não foi possível saber se a aplicação arranca com o sistema',
    'settings.general.restore': 'Restaurar sessões',
    'settings.general.restoreDesc': 'Voltar a abrir os separadores que estavam abertos quando a '
        + 'aplicação fechou e ligar de novo aos respetivos anfitriões',

    /* ---- Settings: Appearance ---- */
    'settings.appearance.title': 'Aspeto',
    'settings.appearance.desc': 'O aspeto da própria aplicação.',
    'settings.appearance.theme': 'Tema',
    'settings.appearance.themeDesc': 'Escolha o tema de interface que prefere',
    'settings.appearance.themeCustomDesc': 'A aplicação está a usar a sua própria paleta. Escolha '
        + 'uma abaixo como ponto de partida, ou defina cada cor à mão.',
    'settings.appearance.theme.light': 'Claro',
    'settings.appearance.theme.dark': 'Escuro',
    'settings.appearance.theme.system': 'Sistema',
    'settings.appearance.theme.custom': 'Personalizado',
    'settings.appearance.themeToast.light': 'modo claro',
    'settings.appearance.themeToast.dark': 'modo escuro',
    'settings.appearance.themeToast.system': 'Sistema',
    'settings.appearance.themeToast.custom': 'Personalizado',
    'settings.appearance.themeChanged': 'Tema alterado para {theme}',
    'settings.appearance.appColors': 'Cores da aplicação',
    'settings.appearance.appColorsDesc': 'Uma paleta de partida. Todas as superfícies da aplicação '
        + 'saem dela.',
    'settings.appearance.appColorsChanged': 'Cores da aplicação alteradas para {palette}',
    'settings.appearance.yours': 'As suas',
    'settings.appearance.customColors': 'Cores personalizadas',
    'settings.appearance.customColorsDesc': 'Defina à mão as cores da janela, dos painéis, dos '
        + 'controlos e do texto',
    'settings.appearance.editColors': 'Editar cores',
    'settings.appearance.colorsApplied': 'Cores da aplicação aplicadas',
    'settings.appearance.showLogo': 'Mostrar o logótipo',
    'settings.appearance.showLogoDesc': 'A marca na barra de título. Desligá-la dá esse espaço à '
        + 'fila de separadores.',
    'settings.appearance.showLogoAria': 'Mostrar o logótipo na barra de título',
    'settings.appearance.logoShown': 'Logótipo visível',
    'settings.appearance.logoHidden': 'Logótipo escondido',
    'settings.appearance.customLogo': 'Logótipo personalizado',
    'settings.appearance.customLogoSet': 'A sua imagem, no lugar da marca CloudBlast.',
    'settings.appearance.customLogoDesc': 'Use a sua imagem em vez da marca CloudBlast. PNG, JPG, '
        + 'GIF, WebP, SVG, BMP ou ICO, até 512 KB.',
    'settings.appearance.choosing': 'A escolher…',
    'settings.appearance.chooseImage': 'Escolher imagem',
    'settings.appearance.logoUnreadable': 'Não foi possível ler essa imagem',
    'settings.appearance.logoSet': 'Logótipo definido para {name}',
    'settings.appearance.logoCleared': 'De volta à marca CloudBlast',
    'settings.appearance.position': 'Posição',
    'settings.appearance.positionDesc': 'Em que extremo da barra de título fica a marca: junto ao '
        + 'botão de menu, ou do lado dos botões da janela.',
    'settings.appearance.positionAria': 'Posição do logótipo',
    'settings.appearance.logoMovedLeft': 'Logótipo movido para a esquerda',
    'settings.appearance.logoMovedRight': 'Logótipo movido para a direita',

    /* ---- Settings: Terminal ---- */
    'settings.terminal.title': 'Terminal',
    'settings.terminal.desc': 'O aspeto da shell dentro de uma sessão, e o que dela fica guardado.',
    'settings.terminal.font': 'Tipo de letra',
    'settings.terminal.fontAria': 'Tipo de letra do terminal',
    'settings.terminal.fontDesc': 'Só são listados os tipos de letra que esta máquina tem mesmo. O '
        + 'JetBrains Mono vem com a aplicação.',
    'settings.terminal.fontMissing': 'Este tipo de letra já não está instalado nesta máquina, por '
        + 'isso o terminal voltou ao JetBrains Mono.',
    'settings.terminal.fontBundled': 'incluído',
    'settings.terminal.fontNotInstalled': 'não instalado',
    'settings.terminal.size': 'Tamanho',
    'settings.terminal.sizeAria': 'Tamanho da letra',
    'settings.terminal.sizeDesc': 'Aplica-se a todas as sessões abertas. Cada uma ajusta-se e '
        + 'comunica ao servidor remoto o novo tamanho da janela.',
    'settings.terminal.weight': 'Espessura',
    'settings.terminal.weightAria': 'Espessura da letra',
    'settings.terminal.weightDesc': 'O negrito mantém o contraste: é desenhado 300 acima do que '
        + 'estiver definido aqui.',
    'settings.terminal.lineHeight': 'Altura da linha',
    'settings.terminal.lineHeightAria': 'Altura da linha',
    'settings.terminal.lineHeightDesc': 'Um múltiplo do tamanho da letra. Linhas mais altas custam '
        + 'linhas de ecrã, e o servidor remoto é informado disso.',
    'settings.terminal.letterSpacing': 'Espaçamento entre letras',
    'settings.terminal.letterSpacingAria': 'Espaçamento entre letras',
    'settings.terminal.letterSpacingDesc': 'Somado a cada célula. Um valor negativo aperta um tipo '
        + 'de letra demasiado solto para um terminal.',
    'settings.terminal.ligatures': 'Ligaduras',
    'settings.terminal.ligaturesDesc': 'Desenha pares como -> e != como um só glifo. Desliga a '
        + 'composição por GPU, que não os consegue desenhar, por isso uma sessão muito ocupada '
        + 'pode deslizar de forma menos suave.',
    'settings.terminal.ligaturesNone': '{font} não tem ligaduras, por isso isto não muda nada. O '
        + 'JetBrains Mono, o Cascadia Code e o Fira Code têm.',
    'settings.terminal.thisFont': 'Este tipo de letra',
    'settings.terminal.cursor': 'Cursor',
    'settings.terminal.cursorAria': 'Estilo do cursor',
    'settings.terminal.cursorDesc': 'O aspeto do cursor onde a shell está à espera.',
    'settings.terminal.cursor.bar': 'Barra',
    'settings.terminal.cursor.block': 'Bloco',
    'settings.terminal.cursor.underline': 'Sublinhado',
    'settings.terminal.blink': 'Piscar o cursor',
    'settings.terminal.scrollback': 'Histórico de deslocamento',
    'settings.terminal.scrollbackAria': 'Linhas de histórico',
    'settings.terminal.scrollbackDesc': 'Linhas guardadas acima do topo da janela, por sessão. A '
        + 'procura no histórico percorre-as todas, e cada linha custa memória nesta janela e não '
        + 'no servidor.',
    'settings.terminal.smoothScroll': 'Deslocamento suave',
    'settings.terminal.smoothScrollAria': 'Duração do deslocamento suave',
    'settings.terminal.smoothScrollDesc': 'Quanto tempo o deslocamento demora a estabilizar depois '
        + 'de usar a roda do rato ou o trackpad. Desligue para que responda de imediato.',
    'settings.terminal.smoothScrollMs': '{value} ms',
    'settings.terminal.links': 'Abrir ligações',
    'settings.terminal.linksDesc': 'Um URL escrito na sessão é clicável e abre no seu navegador. '
        + 'Exigir também {modifier} é o que os editores fazem: impede que um clique destinado ao '
        + 'texto por baixo de um URL atire um navegador para o ecrã a meio da sessão.',
    'settings.terminal.link.click': 'Clique',
    'settings.terminal.link.modifier': '{modifier} + clique',
    'settings.terminal.reset': 'Voltar às predefinições',
    'settings.terminal.resetAlready': 'Tudo acima já está no valor predefinido.',
    'settings.terminal.resetDesc': 'Repõe o tipo de letra, o espaçamento, o cursor, o histórico, o '
        + 'deslocamento suave e o clique em ligações. Deixa o esquema de cores como está.',
    'settings.terminal.resetDone': 'Composição do terminal reposta',
    'settings.terminal.colors': 'Cores do terminal',
    'settings.terminal.colorsDesc': 'Escolha um esquema de cores para o terminal, ou faça o seu',
    'settings.terminal.custom': 'Personalizado',
    'settings.terminal.customTheme': 'Tema personalizado',
    'settings.terminal.customThemeDesc': 'Defina o seu fundo, texto, cursor e cores ANSI',
    'settings.terminal.themeChanged': 'Tema do terminal alterado para {theme}',
    'settings.terminal.customApplied': 'Tema de terminal personalizado aplicado',

    /* ---- Settings: Assistant ---- */
    'settings.assistant.title': 'Assistente',
    'settings.assistant.desc': 'O assistente lê os seus terminais e trabalha nos seus servidores '
        + 'através das ligações que já abriu. Nunca vê uma palavra-passe ou chave guardada.',
    'settings.assistant.loading': 'A carregar as definições do assistente…',
    'settings.assistant.agent': 'Agente',
    'settings.assistant.agentDesc': 'Que agente de programação responde, usando a cópia já '
        + 'instalada nesta máquina. Mudar de agente começa uma conversa nova.',
    'settings.assistant.provider.claudeCode': 'Usa o Claude Code já instalado e com sessão iniciada '
        + 'nesta máquina.',
    'settings.assistant.provider.codex': 'Usa a CLI do Codex instalada nesta máquina.',
    'settings.assistant.provider.opencode': 'Usa a CLI do OpenCode e os fornecedores configurados '
        + 'nesta máquina.',
    'settings.assistant.provider.unavailable': 'Ainda não disponível nesta versão.',
    'settings.assistant.commandMode': 'Onde correm os comandos',
    'settings.assistant.commandMode.terminal': 'No meu terminal',
    'settings.assistant.commandMode.background': 'Fora da vista',
    'settings.assistant.commandMode.terminal.note': 'Os comandos são escritos na sessão que está a '
        + 'ver, por isso vê-os a correr e o resultado fica no seu histórico. Entram no histórico '
        + 'dessa shell, e o assistente lê o resultado do ecrã em vez de receber um código de saída.',
    'settings.assistant.commandMode.background.note': 'Os comandos correm num canal separado que '
        + 'não vê. Fica mais limpo, e o assistente recebe um código de saída verdadeiro e um '
        + 'resultado sem ruído, mas fica a acreditar no que ele diz que aconteceu.',
    'settings.assistant.approval': 'Perguntar antes de correr',
    'settings.assistant.approval.always': 'Todas as ações',
    'settings.assistant.approval.writes': 'Só alterações',
    'settings.assistant.approval.never': 'Nunca',
    'settings.assistant.approval.always.note': 'Todas as chamadas a ferramentas esperam por si, '
        + 'incluindo ler um ficheiro ou o terminal. É minucioso, mas uma investigação longa '
        + 'transforma-se em muitos cliques.',
    'settings.assistant.approval.writes.note': 'A leitura corre à vontade. Tudo o que altere um '
        + 'sistema para e mostra-lhe o comando exato e o anfitrião onde correria.',
    'settings.assistant.approval.never.note': 'Nada para à espera de aprovação, incluindo comandos '
        + 'que apagam dados ou reiniciam serviços. Só faz sentido para anfitriões que pode dar-se '
        + 'ao luxo de estragar.',
    'settings.assistant.localTools': 'Permitir ferramentas neste computador',
    'settings.assistant.localToolsDesc': 'Deixa o assistente ler e escrever ficheiros locais e '
        + 'correr comandos locais. Desligado por predefinição: o painel serve para gerir '
        + 'servidores, e a sua própria máquina é uma superfície muito maior do que isso exige.',
    'settings.assistant.allowList': 'Comandos que nunca precisam de aprovação',
    'settings.assistant.allowListDesc': 'Um por linha, comparados pelas primeiras palavras '
        + 'inteiras. Um comando com um pipe, um redirecionamento, um ponto e vírgula, uma '
        + 'substituição ou uma segunda linha é sempre perguntado, comece por onde começar.',
    'settings.assistant.allowListNote': 'Só se aplica enquanto as aprovações estiverem em “{mode}”.',
    'settings.assistant.blockList': 'Comandos que nunca pode correr',
    'settings.assistant.blockListDesc': 'Um por linha. Estes são recusados em vez de perguntados, '
        + 'em todos os modos de aprovação incluindo “Nunca”, quer o assistente os corra no seu '
        + 'próprio canal quer os escreva no seu terminal. As opções contam: “rm -rf” também trava '
        + '“rm -fr”, “rm -r -f” e “sudo /bin/rm --recursive --force”.',
    'settings.assistant.blockListEmpty': 'Limpe a caixa para não bloquear nada.',
    'settings.assistant.blockListWarning': 'Uma proteção contra enganos, não um controlo de '
        + 'segurança. Uma shell tem demasiadas formas de escrever o mesmo comando para qualquer '
        + 'lista as apanhar todas, por isso mantenha as aprovações ligadas para o que importa.',
    'settings.assistant.saveList': 'Guardar lista',
    'settings.assistant.restoreDefaults': 'Repor predefinições',
    'settings.assistant.quickPrompts': 'Perguntas rápidas',
    'settings.assistant.quickPromptsDesc': 'Perguntas que o painel oferece como botões de um clique '
        + 'quando a conversa está vazia. Uma por linha. Não vem nada preparado, porque as que valem '
        + 'a pena são as que dá por si a fazer às suas máquinas todas as semanas.',
    'settings.assistant.quickPromptsPlaceholder': 'O que está a encher o disco?\n'
        + 'Porque falhou a última implantação?',
    'settings.assistant.quickPromptsNote': 'Até 12. Clicar numa põe-na na caixa em vez de a enviar, '
        + 'para poder acrescentar algo primeiro.',
    'settings.assistant.savePrompts': 'Guardar perguntas',
    'settings.assistant.steps': 'Passos por turno',
    'settings.assistant.stepsDesc': 'Quantas chamadas a ferramentas uma pergunta pode levar antes '
        + 'de o assistente parar e dar conta do trabalho. Uma execução que não está a convergir '
        + 'acaba sozinha em vez de acabar quando reparar nela.',
    'settings.assistant.lines': 'Linhas de terminal que pode ler',
    'settings.assistant.linesDesc': 'Quanto do resultado recente de uma sessão devolve cada '
        + 'leitura. Mais dá-lhe mais contexto para trabalhar e gasta mais do orçamento da conversa.',
    'settings.assistant.signIn': 'Início de sessão',
    'settings.assistant.theAgent': 'o agente',
    'settings.assistant.accountOpencode': 'O OpenCode usa os fornecedores e credenciais já '
        + 'configurados na sua CLI. Trate deles com “opencode auth login”; as chaves guardadas no '
        + 'CloudBlast não são passadas ao OpenCode.',
    'settings.assistant.accountPlan': 'Com sessão iniciada através do {agent} nesta máquina, num '
        + 'plano {plan}. A utilização sai desse plano, por isso não é precisa nenhuma chave aqui.',
    'settings.assistant.accountProvider': 'O {agent} nesta máquina está configurado com {provider}, '
        + 'que trata das suas próprias credenciais. Não é preciso nada aqui.',
    'settings.assistant.accountAgentKey': 'O {agent} nesta máquina está a usar uma chave de API, '
        + 'por isso a utilização é cobrada por token.',
    'settings.assistant.accountStoredKey': 'Está aqui guardada uma chave e será usada. Limpe a '
        + 'caixa e guarde para a remover e voltar ao início de sessão do {agent}.',
    'settings.assistant.accountNone': 'Não é preciso fazer nada se já tem sessão iniciada no '
        + '{agent} nesta máquina, que é o caso habitual. Só é precisa uma chave quando não tem.',
    'settings.assistant.apiKey': 'Chave de API',
    'settings.assistant.keyStored': 'Há uma chave guardada',
    'settings.assistant.keySaved': 'Chave guardada.',
    'settings.assistant.keyRemoved': 'Chave removida.',
    'settings.assistant.keyFailed': 'Não foi possível guardar essa chave.',
    'settings.assistant.noSecureStore': 'Este sistema não tem nenhum cofre seguro disponível, por '
        + 'isso não é possível guardar aqui uma chave.',
    'settings.assistant.tools': 'O que pode fazer',
    'settings.assistant.toolsDesc': '{count} ferramentas, das quais {readOnly} apenas leem. As '
        + 'restantes estão sujeitas à definição de aprovação acima.',

    /* ---- Settings: Monitoring ---- */
    'settings.monitoring.title': 'Monitorização',
    'settings.monitoring.desc': 'Verifique se os anfitriões continuam acessíveis enquanto a '
        + 'aplicação está aberta, e receba uma notificação quando um deixar de responder. São '
        + 'precisos dois interruptores: esta página liga a funcionalidade, e cada anfitrião que '
        + 'quiser vigiar é ligado no seu próprio editor.',
    'settings.monitoring.unreadable': 'Não foi possível ler a monitorização a partir da aplicação. '
        + 'Reinicie o CloudTerm e abra esta página outra vez.',
    'settings.monitoring.saveFailed': 'Não foi possível guardar essa definição',
    'settings.monitoring.checkFailed': 'Não foi possível verificar os anfitriões',
    'settings.monitoring.master': 'Vigiar quedas dos anfitriões',
    'settings.monitoring.masterDesc': 'O interruptor principal. Os anfitriões são vigiados um a um '
        + 'e não todos de uma vez, por isso isto sozinho não verifica nada: cada anfitrião que '
        + 'quiser vigiar é ligado no seu próprio editor, em Monitorização.',
    'settings.monitoring.interval': 'Com que frequência',
    'settings.monitoring.intervalDesc': 'Cada anfitrião vigiado é verificado neste intervalo. Uma '
        + 'verificação é uma única ligação que é fechada assim que abre, por isso fica barata '
        + 'mesmo com uma lista longa.',
    'settings.monitoring.timeout': 'Quanto tempo esperar',
    'settings.monitoring.timeoutDesc': 'Um anfitrião que não aceite a ligação dentro deste tempo '
        + 'falhou a verificação. Vale a pena aumentar para algo do outro lado de uma VPN.',
    'settings.monitoring.failures': 'Antes de o dar como em baixo',
    'settings.monitoring.failuresDesc': 'Quantas verificações seguidas têm de falhar. Em wifi, '
        + 'deixe isto em duas ou mais: um pacote perdido não é um servidor a cair, e ser avisado '
        + 'disso uma vez por minuto é como uma notificação deixa de ser lida.',
    'settings.monitoring.notify': 'Avisar-me quando um anfitrião cair',
    'settings.monitoring.notifyDesc': 'Uma notificação no ambiente de trabalho, uma vez, quando um '
        + 'anfitrião passa de responder a não responder. Desligue isto para manter os estados nos '
        + 'cartões e no sino sem ser interrompido por eles.',
    'settings.monitoring.notifyBack': 'E quando voltar',
    'settings.monitoring.notifyBackDesc': 'Uma segunda notificação quando um anfitrião que estava '
        + 'em baixo volta a responder, dizendo quanto tempo esteve ausente.',
    'settings.monitoring.list': 'O que está a ser vigiado',
    'settings.monitoring.checkNow': 'Verificar agora',
    'settings.monitoring.checking': 'A verificar…',
    'settings.monitoring.noneWatched': 'A vigilância liga-se por anfitrião, no editor do anfitrião.',
    'settings.monitoring.watched_one': '{count} anfitrião.',
    'settings.monitoring.watched_other': '{count} anfitriões.',
    'settings.monitoring.watchedButOff_one': '{count} anfitrião configurado, e nada a verificá-lo '
        + 'enquanto o interruptor acima estiver desligado.',
    'settings.monitoring.watchedButOff_other': '{count} anfitriões configurados, e nada a '
        + 'verificá-los enquanto o interruptor acima estiver desligado.',
    'settings.monitoring.watchedWithOffline_one': '{count} anfitrião, {offline} sem responder.',
    'settings.monitoring.watchedWithOffline_other': '{count} anfitriões, {offline} sem responder.',
    'settings.monitoring.emptyList': 'Ainda não há anfitriões a ser vigiados.',
    'settings.monitoring.emptyListHow': 'Abra um anfitrião na página Anfitriões, encontre '
        + 'Monitorização em Opcional, e ligue “Vigiar este anfitrião”.',
    'settings.monitoring.noNetwork': 'Esta máquina não tem ligação de rede, por isso nada está a '
        + 'ser verificado e nada foi dado como em baixo.',
    'settings.monitoring.allFailed': 'Todos os anfitriões falharam a última verificação ao mesmo '
        + 'tempo, o que normalmente é esta máquina e não todos eles. Esses resultados foram '
        + 'descartados e nada foi comunicado.',
    'settings.monitoring.lastChecked': 'Última verificação {when}.',

    /* ---- Settings: Logging ---- */
    'settings.logging.title': 'Registo',
    'settings.logging.desc': 'Escreva num ficheiro o que cada sessão mostrou, e decida que sessões '
        + 'são registadas e durante quanto tempo os ficheiros são guardados.',
    'settings.logging.saveFailed': 'Não foi possível guardar essa definição',
    'settings.logging.folderFailed': 'Não foi possível usar essa pasta',
    'settings.logging.folderChanged': 'Os registos de sessão passam a ir para ali',
    'settings.logging.openFailed': 'Não foi possível abrir essa pasta',
    'settings.logging.revealFailed': 'Não foi possível encontrar esse registo',
    'settings.logging.recordAll': 'Registar todas as sessões',
    'settings.logging.recordAllDesc': 'Escreve num ficheiro o que o servidor imprime, para cada '
        + 'sessão à medida que abre. Uma sessão isolada pode sempre ser registada a partir do seu '
        + 'próprio cabeçalho, sem ligar isto.',
    'settings.logging.whichSessions': 'Que sessões',
    'settings.logging.whichSessionsDesc': 'Que tipos de sessão o interruptor acima regista. '
        + 'Registar uma sessão a partir do seu próprio cabeçalho ignora esta lista.',
    'settings.logging.format': 'O que escrever',
    'settings.logging.formatDesc': '“Legível” retira os códigos de cor e de cursor, que é o que '
        + 'torna um registo pesquisável com grep. “Literal” guarda cada byte, para o reproduzir '
        + 'num terminal mais tarde.',
    'settings.logging.formatPlain': 'Legível',
    'settings.logging.formatRaw': 'Literal',
    'settings.logging.timestamps': 'Marcar cada linha com a hora',
    'settings.logging.timestampsDesc': 'Antecede cada linha com a hora local em que chegou.',
    'settings.logging.timestampsUnavailable': 'Não está disponível para registos literais: uma '
        + 'marca de hora no meio de uma sequência de escape corrompia-a.',
    'settings.logging.retention': 'Durante quanto tempo guardá-los',
    'settings.logging.retentionDesc': 'As transcrições mais antigas são apagadas, no arranque e à '
        + 'medida que as sessões abrem. Uma que ainda esteja a ser escrita nunca é tocada, seja '
        + 'qual for a sua idade.',
    'settings.logging.forever': 'Para sempre',
    'settings.logging.days_one': '{count} dia',
    'settings.logging.days_other': '{count} dias',
    'settings.logging.cap': 'Limitar o tamanho da pasta',
    'settings.logging.capDesc': 'Assim que a pasta passar disto, as transcrições mais antigas são '
        + 'apagadas primeiro até voltar a caber.',
    'settings.logging.noCap': 'Sem limite',
    'settings.logging.folder': 'Para onde vão',
    'settings.logging.folderDesc': 'Os registos guardam tudo o que esteve no ecrã, o que para uma '
        + 'sessão que correu um gestor de palavras-passe ou imprimiu um token é tão sensível como '
        + 'as próprias credenciais. Guarde-os onde guardaria essas.',
    'settings.logging.openFolder': 'Abrir a pasta',
    'settings.logging.defaultFolder': 'Voltar à pasta predefinida',
    'settings.logging.showInFolder': 'Mostrar na pasta',

    /* ---- Settings: Security ---- */
    'settings.security.title': 'Segurança',
    'settings.security.desc': 'Quem pode abrir esta aplicação, e em que servidores ela confia.',

    'settings.lock.title': 'Palavra-passe de abertura',
    'settings.lock.badgeOn': 'ligada',
    'settings.lock.descOn': 'Pedida sempre que a aplicação abre. As suas palavras-passe, chaves e '
        + 'frases-passe guardadas são cifradas com ela, por isso o ficheiro guardado é ilegível '
        + 'sem ela.',
    'settings.lock.descOff': 'Exigir uma palavra-passe para abrir a aplicação, e cifrar com ela as '
        + 'suas palavras-passe, chaves e frases-passe guardadas.',
    'settings.lock.warnOn': 'Não há recuperação possível. Se esquecer esta palavra-passe, as '
        + 'credenciais guardadas não voltam a poder ser lidas.',
    'settings.lock.warnOff': 'Sem ela, as credenciais estão protegidas apenas pelo cofre do '
        + 'sistema, o que significa que qualquer pessoa com sessão iniciada como si as pode ler.',
    'settings.lock.lockNow': 'Bloquear agora',
    'settings.lock.setPassword': 'Definir palavra-passe',
    'settings.lock.changePassword': 'Alterar palavra-passe',
    'settings.lock.removePassword': 'Remover palavra-passe',
    'settings.lock.currentPassword': 'Palavra-passe atual',
    'settings.lock.password': 'Palavra-passe',
    'settings.lock.newPassword': 'Nova palavra-passe',
    'settings.lock.confirmPassword': 'Confirmar palavra-passe',
    'settings.lock.mismatch': 'As duas palavras-passe não coincidem',
    'settings.lock.failed': 'Isso não funcionou',
    'settings.lock.passwordSet': 'Palavra-passe de abertura definida',
    'settings.lock.passwordChanged': 'Palavra-passe alterada',
    'settings.lock.passwordRemoved': 'Palavra-passe de abertura removida',
    'settings.lock.acknowledge': 'Compreendo que esta palavra-passe não pode ser recuperada',
    'settings.lock.acknowledgeDesc': 'As suas palavras-passe, chaves e frases-passe guardadas são '
        + 'cifradas com ela. Esqueça-a e não voltam a poder ser lidas, nem por esta aplicação nem '
        + 'por mais nada.',
    'settings.lock.confirmTitle': 'Bloquear a aplicação agora?',
    'settings.lock.confirmMessage': 'Todas as sessões abertas serão desligadas, e será precisa a '
        + 'palavra-passe para voltar a entrar.',
    'settings.lock.confirmAction': 'Bloquear',

    'settings.knownHosts.title': 'Anfitriões conhecidos',
    'settings.knownHosts.desc': 'Chaves de servidor em que confiou. Esqueça uma para voltar a ser '
        + 'perguntado sobre ela, o que é preciso se um servidor foi mesmo reconstruído.',
    'settings.knownHosts.unknownType': 'desconhecido',
    'settings.knownHosts.copy': 'Copiar impressão digital',
    'settings.knownHosts.copied': 'Impressão digital copiada',
    'settings.knownHosts.forget': 'Esquecer',
    'settings.knownHosts.forgetKey': 'Esquecer esta chave',
    'settings.knownHosts.keyCount_one': '{count} chave',
    'settings.knownHosts.keyCount_other': '{count} chaves',
    'settings.knownHosts.empty': 'Ainda sem chaves de anfitrião de confiança',
    'settings.knownHosts.emptyNote': 'Na primeira vez que ligar a um servidor, a chave dele será '
        + 'registada aqui.',
    'settings.knownHosts.confirmTitle': 'Esquecer esta chave de anfitrião?',
    'settings.knownHosts.confirmMessage': '{host} será tratado como um anfitrião novo da próxima '
        + 'vez que ligar, e ser-lhe-á pedido que confirme a chave outra vez.',
    'settings.knownHosts.forgotHost': '{host} esquecido',
    'settings.knownHosts.forgotKey': 'Esquecida a chave {type} de {host}',

    /* ---- Settings: Account ---- */
    'settings.account.title': 'Conta',
    'settings.account.fallbackName': 'Conta CloudBlast',
    'settings.account.yourAccount': 'a sua conta CloudBlast',
    'settings.account.connectedAs': 'Ligado como {account}',
    'settings.account.disconnect': 'Desligar',
    'settings.account.disconnecting': 'A desligar…',
    'settings.account.disconnected': 'Conta desligada',
    'settings.account.disconnectedLocally': 'Sessão terminada neste dispositivo, mas não foi '
        + 'possível contactar a consola para revogar o acesso. Remova o dispositivo em '
        + 'Definições → API.',
    'settings.account.connect': 'Ligue a sua conta',
    'settings.account.connectAction': 'Ligar',
    'settings.account.connectDesc': 'Sincronize os seus servidores e faça cópia da sua configuração.',
    'settings.account.unlockFirst': 'Desbloqueie a aplicação primeiro.',
    'settings.account.waitingForBrowser': 'A aguardar o navegador…',
    'settings.account.syncServers': 'Sincronizar os meus servidores',
    'settings.account.syncServersDesc': 'Os seus servidores CloudBlast aparecem em Anfitriões, '
        + 'prontos a ligar.',
    'settings.account.syncOn': 'A sincronizar os seus servidores CloudBlast para Anfitriões',
    'settings.account.syncOff': 'Sincronização desligada. Os anfitriões já adicionados ficam onde '
        + 'estão.',
    'settings.account.syncNow': 'Sincronizar agora',
    'settings.account.syncing': 'A sincronizar…',
    'settings.account.syncedAgo': 'Sincronizado {when}',
    'settings.account.notSyncedYet': 'Ainda não sincronizado',
    'settings.account.serverCount_one': '{count} servidor',
    'settings.account.serverCount_other': '{count} servidores',
    'settings.account.serversSynced_one': '{count} servidor sincronizado',
    'settings.account.serversSynced_other': '{count} servidores sincronizados',
    'settings.account.noServers': 'Esta conta ainda não tem servidores',
    'settings.account.cloudBackup': 'Cópia na nuvem',
    'settings.account.cloudBackupDesc': 'Os seus anfitriões, pastas, chaves e definições, guardados '
        + 'na sua conta para os seus outros dispositivos.',
    'settings.account.backupOn': 'A cópia na nuvem está ligada',
    'settings.account.backupOff': 'A cópia na nuvem está desligada. O que já está guardado fica até '
        + 'que o substitua.',
    'settings.account.backedUp': 'Guardado na sua conta CloudBlast',
    'settings.account.saveNow': 'Guardar agora',
    'settings.account.saving': 'A guardar…',
    'settings.account.savedAgo': 'Guardado {when}',
    'settings.account.notSavedYet': 'Ainda não guardado',
    'settings.account.justNow': 'agora mesmo',
    'settings.account.minutesAgo': 'há {count} min',
    'settings.account.hoursAgo': 'há {count} h',
    'settings.account.daysAgo': 'há {count} d',

    /* ---- Settings: Backup ---- */
    'settings.backup.title': 'Cópia de segurança',
    'settings.backup.desc': 'Traga uma configuração existente, ou leve uma cópia consigo.',
    'settings.backup.exportTitle': 'Exportar uma cópia',
    'settings.backup.exportDesc': 'Escreve todos os anfitriões, pastas, chaves SSH, excertos, '
        + 'encaminhamentos de portas e chaves de anfitrião de confiança num único ficheiro '
        + 'cifrado, protegido por uma frase-passe que escolhe aqui.',
    'settings.backup.exportNote': 'A frase-passe é independente da sua palavra-passe de abertura, '
        + 'por isso o ficheiro abre numa máquina que nunca viu esta.',
    'settings.backup.create': 'Criar cópia',
    'settings.backup.passphrase': 'Frase-passe da cópia',
    'settings.backup.confirmPassphrase': 'Confirmar frase-passe',
    'settings.backup.tooShort': 'Use pelo menos {count} caracteres',
    'settings.backup.mismatch': 'As duas frases-passe não coincidem',
    'settings.backup.acknowledge': 'Compreendo que este ficheiro contém as minhas credenciais '
        + 'guardadas',
    'settings.backup.acknowledgeDesc': 'Quem tiver o ficheiro e esta frase-passe consegue ler todas '
        + 'as palavras-passe, chaves privadas e frases-passe lá guardadas. Guarde-o onde guardaria '
        + 'as próprias credenciais.',
    'settings.backup.chooseLocation': 'Escolher local…',
    'settings.backup.exportFailed': 'Não foi possível escrever a cópia',
    'settings.backup.exported': 'Cópia guardada: {hosts}, {keys}, {snippets}',
    'settings.backup.restoreTitle': 'Restaurar uma cópia',
    'settings.backup.restoreDesc': 'Lê um ficheiro .cbbackup e adiciona o que ele contém. Vê o que '
        + 'lá está antes de alguma coisa mudar.',
    'settings.backup.restoreNote': 'O que já cá está fica intocado por predefinição, por isso '
        + 'restaurar duas vezes é seguro.',
    'settings.backup.chooseFile': 'Escolher ficheiro…',
    'settings.backup.openTitle': 'Abrir cópia cifrada',
    'settings.backup.fileKind': 'Cópia CloudBlast',
    'settings.backup.pickerFailed': 'Não foi possível abrir o seletor de ficheiros',
    'settings.backup.file': 'Ficheiro',
    'settings.backup.open': 'Abrir cópia',
    'settings.backup.opening': 'A abrir…',
    'settings.backup.openFailed': 'Não foi possível abrir essa cópia',
    'settings.backup.from': 'Cópia de {when}',
    'settings.backup.unknownDate': 'uma data desconhecida',
    'settings.backup.appVersion': 'aplicação {version}',
    'settings.backup.emptyFile': 'Esta cópia está vazia.',
    'settings.backup.folders': 'Pastas',
    'settings.backup.keys': 'Chaves SSH',
    'settings.backup.newCount': '{count} novos',
    'settings.backup.existingReplaced': '{count} já cá estão, serão substituídos',
    'settings.backup.existingSkipped': '{count} já cá estão, serão ignorados',
    'settings.backup.trustedKeys': 'Chaves de confiança',
    'settings.backup.hostWord_one': 'anfitrião',
    'settings.backup.hostWord_other': 'anfitriões',
    'settings.backup.overwrite': 'Substituir os itens que já cá estão',
    'settings.backup.overwriteDesc': 'Compara pelo id do registo, não pelo nome. Deixe isto '
        + 'desligado para acrescentar só o que falta; ligue-o para pôr esta máquina igual à cópia, '
        + 'descartando as alterações locais nesses registos.',
    'settings.backup.overwriteWarning': 'As alterações locais nos registos correspondentes '
        + 'perder-se-ão.',
    'settings.backup.restore': 'Restaurar',
    'settings.backup.restoring': 'A restaurar…',
    'settings.backup.restoreFailed': 'O restauro não terminou',
    'settings.backup.restored_one': 'Restaurado {count} item novo',
    'settings.backup.restored_other': 'Restaurados {count} itens novos',
    'settings.backup.restoredAndReplaced_one': 'Restaurado {count} item novo, substituídos {replaced}',
    'settings.backup.restoredAndReplaced_other': 'Restaurados {count} itens novos, substituídos '
        + '{replaced}',
    'settings.backup.duplicateKeys_one': '{count} anfitrião passou a confiar em mais do que uma '
        + 'chave do mesmo tipo. Veja Segurança e depois Anfitriões conhecidos.',
    'settings.backup.duplicateKeys_other': '{count} anfitriões passaram a confiar em mais do que '
        + 'uma chave do mesmo tipo. Veja Segurança e depois Anfitriões conhecidos.',

    /* ---- Settings: About ---- */
    'settings.about.title': 'Acerca',
    'settings.about.version': 'Versão {version}',
    'settings.about.updates': 'Atualizações',
    'settings.about.checking': 'A procurar atualizações…',
    'settings.about.checkingShort': 'A verificar…',
    'settings.about.checkNow': 'Procurar atualizações',
    'settings.about.disabled': 'A procura de atualizações está desligada nesta instalação.',
    'settings.about.ready': 'A versão {version} está pronta a instalar. Reinicie para terminar.',
    'settings.about.downloading': 'A transferir a atualização…',
    'settings.about.downloadingVersion': 'A transferir a versão {version}…',
    'settings.about.available': 'A versão {version} está disponível.',
    'settings.about.availableToDownload': 'A versão {version} está disponível para transferir.',
    'settings.about.upToDate': 'Atualizado. Última verificação {when}.',
    'settings.about.neverChecked': 'Ainda não verificado.',
    'settings.about.restartToUpdate': 'Reiniciar para atualizar',
    'settings.about.download': 'Transferir {version}',
    'settings.about.noChecksLeft': 'Não restam verificações nesta hora.',
    'settings.about.noChecksUntil': 'Não restam verificações nesta hora, até {when}.',
    'settings.about.checksLeft_one': 'Resta {count} de {limit} verificações nesta hora.',
    'settings.about.checksLeft_other': 'Restam {count} de {limit} verificações nesta hora.',
    'settings.about.noteInstall': 'As atualizações são transferidas em segundo plano e instaladas '
        + 'quando sai. Verificar pergunta ao GitHub qual a versão mais recente e não envia nada '
        + 'sobre si ou sobre a sua máquina.',
    'settings.about.noteNotify': 'As atualizações não são instaladas automaticamente. A '
        + 'transferência abre no seu navegador, onde o sistema a pode verificar. Verificar '
        + 'pergunta ao GitHub qual a versão mais recente e não envia nada sobre si ou sobre a sua '
        + 'máquina.',
};
