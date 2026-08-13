/**
 * Русский (Russian).
 *
 * Four plural forms: `_one` (1, 21, 31…), `_few` (2 to 4, 22 to 24…), `_many`
 * (0, 5 to 20…) and `_other`, which Intl.PluralRules picks between. Anything
 * missing here falls back to en.js.
 */
export default {
    /* ---- Shared words ---- */
    'common.allFiles': 'Все файлы',
    'common.apply': 'Применить',
    'common.cancel': 'Отмена',
    'common.change': 'Изменить',
    'common.changeEllipsis': 'Изменить…',
    'common.clear': 'Очистить',
    'common.close': 'Закрыть',
    'common.filter': 'Фильтр',
    'common.filtered': 'Отфильтровано.',
    'common.keepCurrentColors': 'Ничего (оставить текущие цвета)',
    'common.left': 'Слева',
    'common.loading': 'Загрузка…',
    'common.noFilterMatches': 'Ничего не подходит под эти фильтры.',
    'common.noMatches': 'Ничего не найдено по запросу «{query}»',
    'common.noMatchesTitle': 'Ничего не найдено',
    'common.off': 'Выключено',
    'common.remove': 'Удалить',
    'common.reset': 'Сбросить',
    'common.right': 'Справа',
    'common.save': 'Сохранить',
    'common.saveAndApply': 'Сохранить и применить',
    'common.startFrom': 'Взять за основу',
    'common.working': 'Выполняется…',

    /* ---- Sidebar ---- */
    'nav.hosts': 'Хосты',
    'nav.keychain': 'Ключи',
    'nav.proxies': 'Прокси',
    'nav.snippets': 'Сниппеты',
    'nav.logs': 'Журнал',
    'nav.settings': 'Настройки',

    /* ---- Hosts ---- */
    'hosts.count_one': '{count} хост',
    'hosts.count_few': '{count} хоста',
    'hosts.count_many': '{count} хостов',
    'hosts.count_other': '{count} хоста',
    'hosts.folderCount_one': '{count} папка',
    'hosts.folderCount_few': '{count} папки',
    'hosts.folderCount_many': '{count} папок',
    'hosts.folderCount_other': '{count} папки',
    'hosts.empty': 'Хостов пока нет',
    'hosts.emptyNote': 'Добавьте сервер, чтобы начать.',
    'hosts.emptyFolder': 'Здесь пока пусто',
    'hosts.layout': 'Вид карточек',
    'hosts.newFolder': 'Новая папка',
    'hosts.newHost': 'Новый хост',
    'hosts.search': 'Поиск по хостам',
    'hosts.viewGrid': 'Сетка',
    'hosts.viewList': 'Список',

    /* ---- Keychain ---- */
    'keychain.count_one': '{count} ключ',
    'keychain.count_few': '{count} ключа',
    'keychain.count_many': '{count} ключей',
    'keychain.count_other': '{count} ключа',
    'keychain.empty': 'Ключей пока нет',
    'keychain.emptyNote': 'Создайте или импортируйте ключ, чтобы начать.',
    'keychain.helloAdd': 'Добавить ключ Windows Hello, хранящийся в TPM этого ПК',
    'keychain.helloWaiting': 'Ожидание Windows Hello…',
    'keychain.import': 'Импортировать существующий ключ из файла или вставить текстом',
    'keychain.newKey': 'Новый ключ',
    'keychain.search': 'Поиск по ключам',

    /* ---- Proxies ---- */
    'proxies.empty': 'Прокси пока нет',
    'proxies.emptyNote': 'Добавьте прокси SOCKS или HTTP, и через него сможет подключаться любой '
        + 'хост: сеансы терминала, SFTP, проброс портов и удалённые рабочие столы.',
    'proxies.newProxy': 'Новый прокси',
    'proxies.search': 'Поиск по прокси',

    /* ---- Snippets ---- */
    'snippets.count_one': '{count} сниппет',
    'snippets.count_few': '{count} сниппета',
    'snippets.count_many': '{count} сниппетов',
    'snippets.count_other': '{count} сниппета',
    'snippets.empty': 'Сниппетов пока нет',
    'snippets.emptyNote': 'Сохраните команды, которые набираете заново на каждой машине.',
    'snippets.newPackage': 'Новый пакет',
    'snippets.newSnippet': 'Новый сниппет',
    'snippets.nothingShown': 'Ничего не показано',
    'snippets.search': 'Поиск по сниппетам',
    'snippets.showing': 'Показано: {kind}',
    'snippets.kind.all': 'Всё',
    'snippets.kind.command': 'Только команды',
    'snippets.kind.package': 'Только пакеты',

    /* ---- Logs ---- */
    'logs.blurbStart': 'Каждое установленное соединение и каждая изменённая запись на этой машине, '
        + 'сначала самые новые. Записывается вместе с учётной записью ОС, под которой выполнен вход',
    'logs.blurbEnd': ', и отмечается в строке только тогда, когда это был кто-то другой. Пароли и '
        + 'содержимое ключей не записываются никогда.',
    'logs.categoryConnection': 'Соединения',
    'logs.categoryData': 'Изменения',
    'logs.categoryFiles': 'Файлы',
    'logs.categorySecurity': 'Безопасность',
    'logs.empty': 'Пока ничего не записано',
    'logs.emptyNote': 'Соединения и изменения появятся здесь по мере того, как вы их совершаете.',
    'logs.export': 'Экспорт в JSON',
    'logs.filterAll': 'Все',
    'logs.filterAria': 'Фильтровать журнал действий',
    'logs.noMatches': 'Ничего не подходит под эти фильтры',
    'logs.noMatchesNote': 'Попробуйте другую категорию или очистите поле фильтра.',
    'logs.problemsOnly': 'Только проблемы',
    'logs.reading': 'Чтение журнала…',
    'logs.refresh': 'Обновить',

    /* ---- New session tab ---- */
    'newTab.title': 'Новый сеанс',
    'newTab.subtitle': 'Выберите хост или введите адрес, чтобы подключиться напрямую.',
    'newTab.searchPlaceholder': 'Найдите хост или введите адрес…',
    'newTab.recent': 'Недавние',
    'newTab.allHosts': 'Все хосты',
    'newTab.notSaved': 'Не сохранено',
    'newTab.notSavedNote': 'Не сохранено. Данные для входа будут запрошены при подключении.',
    'newTab.connectTo': 'Подключиться к',
    'newTab.hintNavigate': 'перемещение',
    'newTab.hintConnect': 'подключиться',
    'newTab.hintClose': 'закрыть вкладку',

    /* ---- Title bar ---- */
    'titleBar.reload': 'Перезагрузить',
    'titleBar.devTools': 'Инструменты разработчика',
    'titleBar.minimize': 'Свернуть',
    'titleBar.maximize': 'Развернуть',
    'titleBar.exit': 'Выход',
    'titleBar.rename': 'Переименовать…',
    'titleBar.renameAria': 'Переименовать {name}',
    'titleBar.renameGroup': 'Переименовать группу…',
    'titleBar.renameGroupAria': 'Переименовать группу {name}',
    'titleBar.useHostName': 'Снова использовать имя хоста',
    'titleBar.colour': 'Цвет',
    'titleBar.removeFromGroup': 'Убрать из группы',
    'titleBar.newGroup': 'Новая группа из этой вкладки',
    'titleBar.moveToGroup': 'Переместить в «{group}»',
    'titleBar.duplicate': 'Дублировать',
    'titleBar.reconnect': 'Переподключиться',
    'titleBar.reconnectAll': 'Переподключить все',
    'titleBar.disconnect': 'Отключиться',
    'titleBar.disconnectAll': 'Отключить все',
    'titleBar.closeTab': 'Закрыть вкладку',
    'titleBar.closeOthers': 'Закрыть другие',
    'titleBar.closeRight': 'Закрыть вкладки справа',
    'titleBar.ungroup': 'Разгруппировать',
    'titleBar.closeGroupTabs_one': 'Закрыть вкладку',
    'titleBar.closeGroupTabs_few': 'Закрыть все {count} вкладки',
    'titleBar.closeGroupTabs_many': 'Закрыть все {count} вкладок',
    'titleBar.closeGroupTabs_other': 'Закрыть все {count} вкладки',

    /* ---- Monitoring vocabulary ---- */
    'monitor.every30s': '30 с',
    'monitor.every1min': '1 мин',
    'monitor.every5min': '5 мин',
    'monitor.every15min': '15 мин',
    'monitor.wait5s': '5 с',
    'monitor.wait10s': '10 с',
    'monitor.wait20s': '20 с',
    'monitor.wait30s': '30 с',
    'monitor.onceFailed': 'Один раз',
    'monitor.twiceFailed': 'Два раза',
    'monitor.thriceFailed': '3 раза',
    'monitor.stateOnline': 'Отвечает',
    'monitor.stateOffline': 'Не отвечает',
    'monitor.stateProblem': 'Проверка невозможна',
    'monitor.stateUnknown': 'Ещё не проверялся',
    'monitor.unsupportedSerial': 'У последовательной консоли нет сетевого адреса, который можно '
        + 'было бы проверить.',
    'monitor.unsupportedJump': 'Этот хост доступен через промежуточный хост, поэтому с этой машины '
        + 'до него нет маршрута для проверки. Наблюдайте вместо него за промежуточным хостом.',
    'monitor.justNow': 'только что',
    'monitor.minutesAgo': '{count} мин назад',
    'monitor.hoursAgo': '{count} ч назад',
    'monitor.daysAgo': '{count} дн назад',
    'monitor.notAnswering': 'не отвечает',
    'monitor.describeOffline': '{reason}, с {when}',
    'monitor.describeOnline': 'ответил, проверен {when}',
    'monitor.describeOnlineLatency': 'ответил за {latency} мс, проверен {when}',
    'monitor.describeUnknown': 'ещё не проверялся',

    /* ---- App palette editor ---- */
    'appColors.subtitle': 'Шесть поверхностей, из которых собрано приложение. Выберите цвет окна, и '
        + 'остальное подстроится, либо задайте каждый уровень сами.',
    'appColors.surfaces': 'Поверхности',
    'appColors.derive': 'Построить из одного цвета',
    'appColors.deriveHint': 'Перезаписывает все шесть уровней, сохраняя принятые в приложении '
        + 'расстояния между ними',
    'appColors.base': 'Окно',
    'appColors.baseHint': 'То, на чём лежит вся оболочка',
    'appColors.raised': 'Панели',
    'appColors.raisedHint': 'Карточки, диалоги, боковая панель',
    'appColors.control': 'Элементы управления',
    'appColors.controlHint': 'Кнопки, поля ввода и их границы',
    'appColors.hover': 'Наведение',
    'appColors.hoverHint': 'Элемент под указателем',
    'appColors.active': 'Нажатие',
    'appColors.activeHint': 'Элемент в момент использования, а также линии',
    'appColors.muted': 'Второстепенный текст',
    'appColors.mutedHint': 'Вспомогательные подписи и подсказки в полях',

    /* ---- Terminal palette editor ---- */
    'termColors.title': 'Своя тема терминала',
    'termColors.subtitle': 'Выберите каждый цвет сами или возьмите встроенную тему за основу и '
        + 'измените то, что нужно.',
    'termColors.groupBase': 'Основные',
    'termColors.groupAnsi': 'Цвета ANSI',
    'termColors.background': 'Фон',
    'termColors.foreground': 'Текст',
    'termColors.cursor': 'Курсор',
    'termColors.selection': 'Выделение',
    'termColors.black': 'Чёрный',
    'termColors.red': 'Красный',
    'termColors.green': 'Зелёный',
    'termColors.yellow': 'Жёлтый',
    'termColors.blue': 'Синий',
    'termColors.magenta': 'Пурпурный',
    'termColors.cyan': 'Голубой',
    'termColors.white': 'Белый',

    /* ---- OpenSSH import ---- */
    'import.title': 'Из OpenSSH',
    'import.desc': 'Читает ~/.ssh/config и ~/.ssh/known_hosts и переносит сюда хосты, их проброс '
        + 'портов и доверенные ключи.',
    'import.nothingFound': 'В {dir} ничего не найдено. Файл всё равно можно выбрать вручную.',
    'import.scan': 'Просмотреть ~/.ssh',
    'import.scanning': 'Поиск…',
    'import.scanFailed': 'Не удалось прочитать конфигурацию SSH: {reason}',
    'import.chooseConfigTitle': 'Выберите файл конфигурации SSH',
    'import.trustedKeys': 'Доверенные ключи хостов',
    'import.statusPresent': 'уже добавлено',
    'import.statusConflict': 'отличается от сохранённого ключа',
    'import.selectedOf': 'Выбрано {selected} из {count}',
    'import.keyNote': 'ключ {name}',
    'import.keyNoteState': 'ключ {name} ({state})',
    'import.included': 'ещё {count} включённых файлов',
    'import.nothingToImport': 'В этих файлах нечего импортировать.',
    'import.copyKeys': 'Скопировать закрытые ключи, на которые ссылаются эти хосты',
    'import.copyKeysDesc': 'Каждый IdentityFile считывается в хранилище ключей и шифруется '
        + 'хранилищем ОС. Без этого импортированные хосты будут использовать ваш SSH-агент.',
    'import.importing': 'Импорт…',
    'import.importSelected': 'Импортировать выбранное ({count})',
    'import.nothingSelected': 'Ничего не выбрано',
    'import.imported': 'Импортировано: {what}',
    'import.nothingNew': 'Импортировать нечего',
    'import.failed': 'Импорт не удался: {reason}',
    'import.hostKeyCount_one': '{count} ключ хоста',
    'import.hostKeyCount_few': '{count} ключа хостов',
    'import.hostKeyCount_many': '{count} ключей хостов',
    'import.hostKeyCount_other': '{count} ключа хостов',
    'import.report': 'Импортировано: хостов {hosts}, ключей {keys}, ключей хостов {hostKeys}.',
    'import.reportSkipped': 'Уже было: {count}.',
    'import.reportRelayed': 'Настроено на подключение через промежуточный хост: {count}.',
    'import.skipHashed': '{count} с хешированием',
    'import.skipPatterns': '{count} с подстановочными знаками',
    'import.skipMarkers': '{count} сертификатов или отозванных',
    'import.skipMalformed': '{count} нечитаемых',
    'import.skipped': 'пропущено: {what}',

    /* ---- Import from other apps ---- */
    'appImport.title': 'Из других программ',
    'appImport.desc': 'Переносятся хосты, проброс портов, папки, а также настройки '
        + 'последовательного порта и удалённого рабочего стола. Пароли остаются на месте: каждая '
        + 'программа шифрует их по-своему.',
    'appImport.checking': 'Проверка…',
    'appImport.notFound': 'Не найдено',
    'appImport.sessionCount_one': '{count} сохранённый сеанс',
    'appImport.sessionCount_few': '{count} сохранённых сеанса',
    'appImport.sessionCount_many': '{count} сохранённых сеансов',
    'appImport.sessionCount_other': '{count} сохранённых сеанса',
    'appImport.import': 'Импортировать',
    'appImport.chooseFile': 'Выбрать файл MobaXterm…',
    'appImport.choosePortable': 'Портативная установка? Выберите файл MobaXterm…',
    'appImport.chooseFileHint': 'Портативный MobaXterm.ini или экспорт .mxtsessions',
    'appImport.chooseFileTitle': 'Выберите файл MobaXterm.ini или .mxtsessions',
    'appImport.fileKind': 'Сеансы MobaXterm',
    'appImport.scanFailed': 'Не удалось прочитать сеансы {source}: {reason}',
    'appImport.sessionsOf': 'Сеансы {app}',
    'appImport.nothingIn': 'В {app} нечего импортировать.',
    'appImport.inFolder': 'в {folder}',
    'appImport.keyEncrypted': 'защищён парольной фразой',
    'appImport.keyNeedsConversion': 'требует преобразования',
    'appImport.keyUnreadable': 'нечитаем',
    'appImport.copyKeysDesc': 'Каждый файл ключа считывается в хранилище ключей и шифруется '
        + 'хранилищем ОС. Без этого импортированные хосты будут использовать ваш SSH-агент.',
    'appImport.report': 'Импортировано хостов: {hosts}',

    /* ---- Settings navigation ---- */
    'settings.nav.aria': 'Категории настроек',
    'settings.nav.general': 'Общие',
    'settings.nav.appearance': 'Оформление',
    'settings.nav.terminal': 'Терминал',
    'settings.nav.assistant': 'Ассистент',
    'settings.nav.monitoring': 'Мониторинг',
    'settings.nav.logging': 'Журналирование',
    'settings.nav.security': 'Безопасность',
    'settings.nav.account': 'Учётная запись',
    'settings.nav.backup': 'Резервные копии',
    'settings.nav.about': 'О программе',

    /* ---- Settings: General ---- */
    'settings.general.title': 'Общие',
    'settings.general.desc': 'Как приложение ведёт себя при запуске.',
    'settings.general.language': 'Язык',
    'settings.general.languageDesc': 'Язык, на котором показывается текст самого приложения. Вывод '
        + 'терминала и всё, что печатают ваши серверы, остаётся ровно таким, каким приходит.',
    'settings.general.languageChanged': 'Язык изменён на {language}',
    'settings.general.startup': 'Запускать при входе',
    'settings.general.startupDesc': 'Открывать CloudTerm автоматически при входе в этот компьютер',
    'settings.general.startupOn': 'CloudTerm будет открываться при входе в систему',
    'settings.general.startupOff': 'CloudTerm больше не будет открываться при входе в систему',
    'settings.general.startupFailed': 'Не удалось изменить эту настройку',
    'settings.general.startupUnknown': 'Не удалось узнать, запускается ли приложение вместе с системой',
    'settings.general.restore': 'Восстанавливать сеансы',
    'settings.general.restoreDesc': 'Снова открывать вкладки, которые были открыты при закрытии '
        + 'приложения, и подключаться к их хостам',

    /* ---- Settings: Appearance ---- */
    'settings.appearance.title': 'Оформление',
    'settings.appearance.desc': 'Как выглядит само приложение.',
    'settings.appearance.theme': 'Тема',
    'settings.appearance.themeDesc': 'Выберите тему интерфейса, которая вам больше нравится',
    'settings.appearance.themeCustomDesc': 'Приложение использует вашу собственную палитру. '
        + 'Выберите ниже палитру за основу или задайте каждый цвет сами.',
    'settings.appearance.theme.light': 'Светлая',
    'settings.appearance.theme.dark': 'Тёмная',
    'settings.appearance.theme.system': 'Как в системе',
    'settings.appearance.theme.custom': 'Своя',
    'settings.appearance.themeToast.light': 'светлую',
    'settings.appearance.themeToast.dark': 'тёмную',
    'settings.appearance.themeToast.system': 'системную',
    'settings.appearance.themeToast.custom': 'свою',
    'settings.appearance.themeChanged': 'Тема изменена на {theme}',
    'settings.appearance.appColors': 'Цвета приложения',
    'settings.appearance.appColorsDesc': 'Палитра, которую можно взять за основу. Из неё выводится '
        + 'каждая поверхность приложения.',
    'settings.appearance.appColorsChanged': 'Цвета приложения изменены на {palette}',
    'settings.appearance.yours': 'Ваши',
    'settings.appearance.customColors': 'Свои цвета',
    'settings.appearance.customColorsDesc': 'Задайте цвета окна, панелей, элементов управления и '
        + 'текста сами',
    'settings.appearance.editColors': 'Изменить цвета',
    'settings.appearance.colorsApplied': 'Цвета приложения применены',
    'settings.appearance.showLogo': 'Показывать логотип',
    'settings.appearance.showLogoDesc': 'Значок в заголовке окна. Если выключить, это место '
        + 'достанется полосе вкладок.',
    'settings.appearance.showLogoAria': 'Показывать логотип в заголовке окна',
    'settings.appearance.logoShown': 'Логотип показан',
    'settings.appearance.logoHidden': 'Логотип скрыт',
    'settings.appearance.customLogo': 'Свой логотип',
    'settings.appearance.customLogoSet': 'Ваше изображение вместо знака CloudBlast.',
    'settings.appearance.customLogoDesc': 'Используйте своё изображение вместо знака CloudBlast. '
        + 'PNG, JPG, GIF, WebP, SVG, BMP или ICO, до 512 КБ.',
    'settings.appearance.choosing': 'Выбор…',
    'settings.appearance.chooseImage': 'Выбрать изображение',
    'settings.appearance.logoUnreadable': 'Не удалось прочитать это изображение',
    'settings.appearance.logoSet': 'Логотип заменён на {name}',
    'settings.appearance.logoCleared': 'Возврат к знаку CloudBlast',
    'settings.appearance.position': 'Положение',
    'settings.appearance.positionDesc': 'С какого края заголовка стоит значок: рядом с кнопкой '
        + 'меню или со стороны кнопок окна.',
    'settings.appearance.positionAria': 'Положение логотипа',
    'settings.appearance.logoMovedLeft': 'Логотип перемещён влево',
    'settings.appearance.logoMovedRight': 'Логотип перемещён вправо',

    /* ---- Settings: Terminal ---- */
    'settings.terminal.title': 'Терминал',
    'settings.terminal.desc': 'Как выглядит оболочка внутри сеанса и что от него сохраняется.',
    'settings.terminal.font': 'Шрифт',
    'settings.terminal.fontAria': 'Шрифт терминала',
    'settings.terminal.fontDesc': 'В списке только те начертания, которые действительно есть на '
        + 'этой машине. JetBrains Mono поставляется вместе с приложением.',
    'settings.terminal.fontMissing': 'Этот шрифт больше не установлен на этой машине, поэтому '
        + 'терминал вернулся к JetBrains Mono.',
    'settings.terminal.fontBundled': 'в комплекте',
    'settings.terminal.fontNotInstalled': 'не установлен',
    'settings.terminal.size': 'Размер',
    'settings.terminal.sizeAria': 'Размер шрифта',
    'settings.terminal.sizeDesc': 'Применяется ко всем открытым сеансам. Каждый из них '
        + 'перестраивается и сообщает удалённой стороне новый размер окна.',
    'settings.terminal.weight': 'Насыщенность',
    'settings.terminal.weightAria': 'Насыщенность шрифта',
    'settings.terminal.weightDesc': 'Полужирный сохраняет контраст: он рисуется на 300 тяжелее '
        + 'того, что задано здесь.',
    'settings.terminal.lineHeight': 'Высота строки',
    'settings.terminal.lineHeightAria': 'Высота строки',
    'settings.terminal.lineHeightDesc': 'Множитель от размера шрифта. Более высокие строки стоят '
        + 'строк экрана, и удалённой стороне об этом сообщается.',
    'settings.terminal.letterSpacing': 'Межбуквенный интервал',
    'settings.terminal.letterSpacingAria': 'Межбуквенный интервал',
    'settings.terminal.letterSpacingDesc': 'Добавляется к каждой ячейке. Отрицательное значение '
        + 'поджимает шрифт, который для терминала набирается слишком свободно.',
    'settings.terminal.ligatures': 'Лигатуры',
    'settings.terminal.ligaturesDesc': 'Рисует пары вроде -> и != одним знаком. Отключает отрисовку '
        + 'через GPU, которая их не умеет, поэтому очень нагруженный сеанс может прокручиваться '
        + 'менее плавно.',
    'settings.terminal.ligaturesNone': 'У шрифта {font} нет лигатур, поэтому эта настройка ничего '
        + 'не изменит. Они есть у JetBrains Mono, Cascadia Code и Fira Code.',
    'settings.terminal.thisFont': 'Этот шрифт',
    'settings.terminal.cursor': 'Курсор',
    'settings.terminal.cursorAria': 'Вид курсора',
    'settings.terminal.cursorDesc': 'Как выглядит курсор там, где оболочка ждёт ввода.',
    'settings.terminal.cursor.bar': 'Вертикальная черта',
    'settings.terminal.cursor.block': 'Блок',
    'settings.terminal.cursor.underline': 'Подчёркивание',
    'settings.terminal.blink': 'Мигание курсора',
    'settings.terminal.scrollback': 'Буфер прокрутки',
    'settings.terminal.scrollbackAria': 'Строк в буфере прокрутки',
    'settings.terminal.scrollbackDesc': 'Сколько строк хранится выше верхнего края окна, для '
        + 'каждого сеанса. Поиск по буферу просматривает их все, и каждая строка занимает память в '
        + 'этом окне, а не на сервере.',
    'settings.terminal.smoothScroll': 'Плавная прокрутка',
    'settings.terminal.smoothScrollAria': 'Длительность плавной прокрутки',
    'settings.terminal.smoothScrollDesc': 'Сколько времени требуется, чтобы прокрутка колёсиком '
        + 'мыши или жестом на трекпаде остановилась. Выключите, чтобы она сразу следовала за движением.',
    'settings.terminal.smoothScrollMs': '{value} мс',
    'settings.terminal.links': 'Открытие ссылок',
    'settings.terminal.linksDesc': 'Напечатанный в сеансе URL можно нажать, и он откроется в '
        + 'браузере. Требовать при этом {modifier} принято в редакторах: так щелчок, нацеленный на '
        + 'текст под ссылкой, не выбросит браузер на экран посреди работы.',
    'settings.terminal.link.click': 'Щелчок',
    'settings.terminal.link.modifier': '{modifier} + щелчок',
    'settings.terminal.reset': 'Вернуть значения по умолчанию',
    'settings.terminal.resetAlready': 'Всё, что выше, уже имеет значение по умолчанию.',
    'settings.terminal.resetDesc': 'Сбрасывает шрифт, интервалы, курсор, буфер прокрутки, плавную '
        + 'прокрутку и способ открытия ссылок. Цветовую схему не трогает.',
    'settings.terminal.resetDone': 'Набор терминала сброшен',
    'settings.terminal.colors': 'Цвета терминала',
    'settings.terminal.colorsDesc': 'Выберите цветовую схему для терминала или соберите свою',
    'settings.terminal.custom': 'Своя',
    'settings.terminal.customTheme': 'Своя тема',
    'settings.terminal.customThemeDesc': 'Задайте свои фон, текст, курсор и цвета ANSI',
    'settings.terminal.themeChanged': 'Тема терминала изменена на {theme}',
    'settings.terminal.customApplied': 'Своя тема терминала применена',

    /* ---- Settings: Assistant ---- */
    'settings.assistant.title': 'Ассистент',
    'settings.assistant.desc': 'Ассистент читает ваши терминалы и работает на ваших серверах через '
        + 'уже открытые вами соединения. Он никогда не видит сохранённые пароли и ключи.',
    'settings.assistant.loading': 'Загрузка настроек ассистента…',
    'settings.assistant.agent': 'Агент',
    'settings.assistant.agentDesc': 'Какой агент отвечает, используя копию, уже установленную на '
        + 'этой машине. Смена агента начинает новый разговор.',
    'settings.assistant.provider.claudeCode': 'Использует Claude Code, уже установленный на этой '
        + 'машине и выполнивший вход.',
    'settings.assistant.provider.codex': 'Использует Codex CLI, установленный на этой машине.',
    'settings.assistant.provider.opencode': 'Использует OpenCode CLI и провайдеров, настроенных на '
        + 'этой машине.',
    'settings.assistant.provider.unavailable': 'В этой сборке пока недоступно.',
    'settings.assistant.commandMode': 'Где выполняются команды',
    'settings.assistant.commandMode.terminal': 'В моём терминале',
    'settings.assistant.commandMode.background': 'Вне поля зрения',
    'settings.assistant.commandMode.terminal.note': 'Команды набираются в том сеансе, который вы '
        + 'видите, поэтому вы наблюдаете за их выполнением, а вывод остаётся в буфере прокрутки. '
        + 'Они попадают в историю этой оболочки, а ассистент читает результат с экрана вместо кода '
        + 'возврата.',
    'settings.assistant.commandMode.background.note': 'Команды выполняются в отдельном канале, '
        + 'который вы не видите. Так аккуратнее, и ассистент получает настоящий код возврата и '
        + 'чистый вывод, но о случившемся приходится верить ему на слово.',
    'settings.assistant.approval': 'Спрашивать перед запуском',
    'settings.assistant.approval.always': 'Любое действие',
    'settings.assistant.approval.writes': 'Только изменения',
    'settings.assistant.approval.never': 'Не спрашивать',
    'settings.assistant.approval.always.note': 'Каждый вызов инструмента ждёт вас, включая чтение '
        + 'файла или терминала. Надёжно, но долгий разбор превращается в множество нажатий.',
    'settings.assistant.approval.writes.note': 'Чтение выполняется свободно. Всё, что меняет '
        + 'систему, останавливается и показывает вам точную команду и хост, на котором она '
        + 'выполнилась бы. Это значение по умолчанию.',
    'settings.assistant.approval.never.note': 'Ничто не останавливается ради подтверждения, включая '
        + 'команды, которые удаляют данные или перезапускают службы. Разумно только для хостов, '
        + 'которые вы можете позволить себе сломать. Включение сначала запрашивает подтверждение.',
    'settings.assistant.approval.neverConfirmTitle': 'Отключить подтверждения?',
    'settings.assistant.approval.neverConfirmMessage': 'Режим «не спрашивать» запускает каждый '
        + 'инструмент без остановки — включая команды, которые удаляют данные или перезапускают '
        + 'службы на рабочих хостах. Заблокированные команды по-прежнему отклоняются.',
    'settings.assistant.localTools': 'Разрешить инструменты на этом компьютере',
    'settings.assistant.localToolsDesc': 'Позволяет ассистенту читать и записывать локальные файлы '
        + 'и выполнять локальные команды. По умолчанию выключено: панель нужна для управления '
        + 'серверами, а ваша собственная машина намного шире того, что для этого требуется.',
    'settings.assistant.allowList': 'Команды, которым подтверждение не нужно',
    'settings.assistant.allowListDesc': 'По одной в строке, сверяются по первым словам целиком. '
        + 'Команда с конвейером, перенаправлением, точкой с запятой, подстановкой или второй '
        + 'строкой запрашивается всегда, с чего бы она ни начиналась.',
    'settings.assistant.allowListNote': 'Действует, только пока подтверждение стоит на «{mode}».',
    'settings.assistant.blockList': 'Команды, которые запускать нельзя',
    'settings.assistant.blockListDesc': 'По одной в строке. Они отклоняются сразу, а не выносятся '
        + 'на подтверждение, в любом режиме, включая «Никогда», и неважно, выполняет ли их '
        + 'ассистент в своём канале или набирает в вашем терминале. Флаги учитываются: «rm -rf» '
        + 'останавливает также «rm -fr», «rm -r -f» и «sudo /bin/rm --recursive --force».',
    'settings.assistant.blockListEmpty': 'Очистите поле, чтобы ничего не блокировать.',
    'settings.assistant.blockListWarning': 'Это ограждение от ошибок, а не средство безопасности. В '
        + 'оболочке слишком много способов записать одну и ту же команду, чтобы любой список '
        + 'поймал их все, поэтому для важного оставляйте подтверждения включёнными.',
    'settings.assistant.saveList': 'Сохранить список',
    'settings.assistant.restoreDefaults': 'Вернуть значения по умолчанию',
    'settings.assistant.quickPrompts': 'Быстрые вопросы',
    'settings.assistant.quickPromptsDesc': 'Вопросы, которые панель предлагает кнопками в один '
        + 'щелчок, когда разговор пуст. По одному в строке. Изначально ничего не задано, потому что '
        + 'стоящие вопросы это те, которые вы сами задаёте своим машинам каждую неделю.',
    'settings.assistant.quickPromptsPlaceholder': 'Чем забит диск?\n'
        + 'Почему не прошло последнее развёртывание?',
    'settings.assistant.quickPromptsNote': 'До 12 штук. Нажатие подставляет вопрос в поле, а не '
        + 'отправляет его, так что сначала можно дописать.',
    'settings.assistant.savePrompts': 'Сохранить вопросы',
    'settings.assistant.steps': 'Шагов за ход',
    'settings.assistant.stepsDesc': 'Сколько вызовов инструментов может занять один вопрос, прежде '
        + 'чем ассистент остановится и отчитается. Идущий вникуда прогон завершается сам, а не '
        + 'тогда, когда вы это заметите.',
    'settings.assistant.lines': 'Сколько строк терминала он читает',
    'settings.assistant.linesDesc': 'Сколько недавнего вывода сеанса возвращает одно чтение. '
        + 'Больше значит больше контекста для работы и больший расход бюджета разговора.',
    'settings.assistant.signIn': 'Вход',
    'settings.assistant.theAgent': 'агент',
    'settings.assistant.accountOpencode': 'OpenCode использует провайдеров и учётные данные, уже '
        + 'настроенные в его CLI. Управляйте ими командой «opencode auth login»; ключи, сохранённые '
        + 'в CloudBlast, в OpenCode не передаются.',
    'settings.assistant.accountPlan': 'Вход выполнен через {agent} на этой машине, тариф {plan}. '
        + 'Расход идёт по этому тарифу, поэтому ключ здесь не нужен.',
    'settings.assistant.accountProvider': '{agent} на этой машине настроен на {provider}, который '
        + 'сам занимается своими учётными данными. Здесь ничего не требуется.',
    'settings.assistant.accountAgentKey': '{agent} на этой машине использует ключ API, поэтому '
        + 'расход считается по токенам.',
    'settings.assistant.accountStoredKey': 'Ключ сохранён здесь и будет использоваться. Очистите '
        + 'поле и сохраните, чтобы удалить его и вернуться ко входу через {agent}.',
    'settings.assistant.accountNone': 'Делать ничего не нужно, если вы уже вошли в {agent} на этой '
        + 'машине, а так обычно и бывает. Ключ нужен, только если вход не выполнен.',
    'settings.assistant.apiKey': 'Ключ API',
    'settings.assistant.keyStored': 'Ключ сохранён',
    'settings.assistant.keySaved': 'Ключ сохранён.',
    'settings.assistant.keyRemoved': 'Ключ удалён.',
    'settings.assistant.keyFailed': 'Не удалось сохранить этот ключ.',
    'settings.assistant.noSecureStore': 'В этой системе нет доступного защищённого хранилища, '
        + 'поэтому ключ здесь сохранить нельзя.',
    'settings.assistant.tools': 'Что он умеет',
    'settings.assistant.toolsDesc': 'Инструментов: {count}, из них только читают {readOnly}. '
        + 'Остальные подчиняются настройке подтверждения выше.',

    /* ---- Settings: Monitoring ---- */
    'settings.monitoring.title': 'Мониторинг',
    'settings.monitoring.desc': 'Проверяйте, доступны ли хосты, пока приложение открыто, и '
        + 'получайте уведомление, когда какой-то из них перестаёт отвечать. Нужны два '
        + 'переключателя: эта страница включает саму возможность, а каждый нужный хост включается '
        + 'в своём собственном редакторе.',
    'settings.monitoring.unreadable': 'Не удалось прочитать настройки мониторинга из приложения. '
        + 'Перезапустите CloudTerm и откройте эту страницу снова.',
    'settings.monitoring.saveFailed': 'Не удалось сохранить эту настройку',
    'settings.monitoring.checkFailed': 'Не удалось проверить хосты',
    'settings.monitoring.master': 'Следить за недоступностью хостов',
    'settings.monitoring.masterDesc': 'Главный переключатель. Хосты проверяются по одному, а не все '
        + 'сразу, поэтому сам по себе он ничего не проверяет: каждый нужный хост включается в '
        + 'своём редакторе, в разделе «Мониторинг».',
    'settings.monitoring.interval': 'Как часто',
    'settings.monitoring.intervalDesc': 'Каждый отслеживаемый хост проверяется с этим интервалом. '
        + 'Проверка это одно соединение, которое закрывается сразу после открытия, поэтому она '
        + 'дёшева даже при длинном списке.',
    'settings.monitoring.timeout': 'Сколько ждать',
    'settings.monitoring.timeoutDesc': 'Хост, не принявший соединение за это время, проверку не '
        + 'прошёл. Для машины по ту сторону VPN значение стоит увеличить.',
    'settings.monitoring.failures': 'Прежде чем считать недоступным',
    'settings.monitoring.failuresDesc': 'Сколько проверок подряд должно не пройти. По Wi-Fi '
        + 'оставьте два и больше: один потерянный пакет это не упавший сервер, а сообщения об этом '
        + 'раз в минуту как раз и приводят к тому, что уведомления перестают читать.',
    'settings.monitoring.notify': 'Уведомлять, когда хост становится недоступен',
    'settings.monitoring.notifyDesc': 'Одно уведомление на рабочем столе в момент, когда хост '
        + 'перестаёт отвечать. Выключите, чтобы состояния остались на карточках хостов и на '
        + 'колокольчике, но не отвлекали.',
    'settings.monitoring.notifyBack': 'И когда он вернётся',
    'settings.monitoring.notifyBackDesc': 'Второе уведомление, когда недоступный хост снова '
        + 'начинает отвечать, с указанием, сколько он отсутствовал.',
    'settings.monitoring.list': 'За чем ведётся наблюдение',
    'settings.monitoring.checkNow': 'Проверить сейчас',
    'settings.monitoring.checking': 'Проверка…',
    'settings.monitoring.noneWatched': 'Наблюдение включается для каждого хоста отдельно, в '
        + 'редакторе хоста.',
    'settings.monitoring.watched_one': '{count} хост.',
    'settings.monitoring.watched_few': '{count} хоста.',
    'settings.monitoring.watched_many': '{count} хостов.',
    'settings.monitoring.watched_other': '{count} хоста.',
    'settings.monitoring.watchedButOff_one': 'Настроен {count} хост, но пока переключатель выше '
        + 'выключен, его никто не проверяет.',
    'settings.monitoring.watchedButOff_few': 'Настроено {count} хоста, но пока переключатель выше '
        + 'выключен, их никто не проверяет.',
    'settings.monitoring.watchedButOff_many': 'Настроено {count} хостов, но пока переключатель выше '
        + 'выключен, их никто не проверяет.',
    'settings.monitoring.watchedButOff_other': 'Настроено {count} хоста, но пока переключатель выше '
        + 'выключен, их никто не проверяет.',
    'settings.monitoring.watchedWithOffline_one': '{count} хост, не отвечает: {offline}.',
    'settings.monitoring.watchedWithOffline_few': '{count} хоста, не отвечает: {offline}.',
    'settings.monitoring.watchedWithOffline_many': '{count} хостов, не отвечает: {offline}.',
    'settings.monitoring.watchedWithOffline_other': '{count} хоста, не отвечает: {offline}.',
    'settings.monitoring.emptyList': 'Пока ни за одним хостом не ведётся наблюдение.',
    'settings.monitoring.emptyListHow': 'Откройте хост на странице «Хосты», найдите «Мониторинг» в '
        + 'разделе «Дополнительно» и включите «Наблюдать за этим хостом».',
    'settings.monitoring.noNetwork': 'У этой машины нет сетевого подключения, поэтому ничего не '
        + 'проверяется и ни один хост не отмечен как недоступный.',
    'settings.monitoring.allFailed': 'Все хосты не прошли последнюю проверку одновременно, а это '
        + 'обычно означает проблему на этой машине, а не на всех них. Те результаты отброшены, и '
        + 'ничего сообщено не было.',
    'settings.monitoring.lastChecked': 'Последняя проверка: {when}.',

    /* ---- Settings: Logging ---- */
    'settings.logging.title': 'Журналирование',
    'settings.logging.desc': 'Записывайте в файл то, что показал каждый сеанс, и решайте, какие '
        + 'сеансы записываются и как долго хранятся файлы.',
    'settings.logging.saveFailed': 'Не удалось сохранить эту настройку',
    'settings.logging.folderFailed': 'Не удалось использовать эту папку',
    'settings.logging.folderChanged': 'Журналы сеансов теперь будут сохраняться туда',
    'settings.logging.openFailed': 'Не удалось открыть эту папку',
    'settings.logging.revealFailed': 'Не удалось найти этот журнал',
    'settings.logging.recordAll': 'Записывать каждый сеанс',
    'settings.logging.recordAllDesc': 'Записывает в файл то, что печатает сервер, для каждого '
        + 'сеанса с момента его открытия. Отдельный сеанс всегда можно записать из его собственного '
        + 'заголовка, не включая эту настройку.',
    'settings.logging.whichSessions': 'Какие сеансы',
    'settings.logging.whichSessionsDesc': 'Какие виды сеансов записывает переключатель выше. Запись '
        + 'отдельного сеанса из его заголовка этот список не учитывает.',
    'settings.logging.format': 'Что записывать',
    'settings.logging.formatDesc': '«Читаемо» убирает коды цвета и курсора, именно это и делает '
        + 'журнал пригодным для grep. «Дословно» сохраняет каждый байт, чтобы позже проиграть его '
        + 'через терминал.',
    'settings.logging.formatPlain': 'Читаемо',
    'settings.logging.formatRaw': 'Дословно',
    'settings.logging.timestamps': 'Помечать каждую строку временем',
    'settings.logging.timestampsDesc': 'Ставит перед каждой строкой местное время её появления.',
    'settings.logging.timestampsUnavailable': 'Недоступно для дословных журналов: метка времени '
        + 'посреди управляющей последовательности испортила бы её.',
    'settings.logging.retention': 'Сколько их хранить',
    'settings.logging.retentionDesc': 'Более старые записи удаляются при запуске и по мере открытия '
        + 'сеансов. Ту, которая ещё пишется, не трогают никогда, сколько бы ей ни было времени.',
    'settings.logging.forever': 'Бессрочно',
    'settings.logging.days_one': '{count} день',
    'settings.logging.days_few': '{count} дня',
    'settings.logging.days_many': '{count} дней',
    'settings.logging.days_other': '{count} дня',
    'settings.logging.cap': 'Ограничить размер папки',
    'settings.logging.capDesc': 'Как только папка превысит этот размер, сначала удаляются самые '
        + 'старые записи, пока всё снова не поместится.',
    'settings.logging.noCap': 'Без ограничения',
    'settings.logging.folder': 'Куда они попадают',
    'settings.logging.folderDesc': 'В журналах остаётся всё, что было на экране, а для сеанса, в '
        + 'котором запускали менеджер паролей или печатали токен, это не менее чувствительно, чем '
        + 'сами учётные данные. Держите их там же, где держали бы их.',
    'settings.logging.openFolder': 'Открыть папку',
    'settings.logging.defaultFolder': 'Вернуться к папке по умолчанию',
    'settings.logging.showInFolder': 'Показать в папке',

    /* ---- Settings: Security ---- */
    'settings.security.title': 'Безопасность',
    'settings.security.desc': 'Кто может открыть это приложение и каким серверам оно доверяет.',

    'settings.lock.title': 'Пароль на открытие',
    'settings.lock.badgeOn': 'вкл',
    'settings.lock.descOn': 'Запрашивается каждый раз при открытии приложения. Сохранённые пароли, '
        + 'ключи и парольные фразы зашифрованы им, поэтому без него файл хранилища прочитать нельзя.',
    'settings.lock.descOff': 'Требовать пароль для открытия приложения и шифровать им сохранённые '
        + 'пароли, ключи и парольные фразы.',
    'settings.lock.warnOn': 'Восстановить его невозможно. Если вы забудете этот пароль, сохранённые '
        + 'учётные данные прочитать уже не удастся.',
    'settings.lock.warnOff': 'Без него учётные данные защищены только хранилищем ОС, то есть их '
        + 'сможет прочитать любой, кто вошёл в систему под вашей учётной записью.',
    'settings.lock.lockNow': 'Заблокировать сейчас',
    'settings.lock.setPassword': 'Задать пароль',
    'settings.lock.changePassword': 'Изменить пароль',
    'settings.lock.removePassword': 'Удалить пароль',
    'settings.lock.currentPassword': 'Текущий пароль',
    'settings.lock.password': 'Пароль',
    'settings.lock.newPassword': 'Новый пароль',
    'settings.lock.confirmPassword': 'Подтвердите пароль',
    'settings.lock.mismatch': 'Пароли не совпадают',
    'settings.lock.failed': 'Не получилось',
    'settings.lock.passwordSet': 'Пароль на открытие задан',
    'settings.lock.passwordChanged': 'Пароль изменён',
    'settings.lock.passwordRemoved': 'Пароль на открытие удалён',
    'settings.lock.acknowledge': 'Я понимаю, что этот пароль нельзя восстановить',
    'settings.lock.acknowledgeDesc': 'Сохранённые пароли, ключи и парольные фразы зашифрованы им. '
        + 'Забудете его, и прочитать их не сможет ни это приложение, ни что-либо ещё.',
    'settings.lock.confirmTitle': 'Заблокировать приложение сейчас?',
    'settings.lock.confirmMessage': 'Все открытые сеансы будут отключены, а чтобы вернуться, '
        + 'понадобится пароль.',
    'settings.lock.confirmAction': 'Заблокировать',

    'settings.knownHosts.title': 'Известные хосты',
    'settings.knownHosts.desc': 'Ключи серверов, которым вы доверились. Забудьте ключ, чтобы про '
        + 'него спросили снова; это нужно, если сервер действительно пересоздавали.',
    'settings.knownHosts.unknownType': 'неизвестно',
    'settings.knownHosts.copy': 'Скопировать отпечаток',
    'settings.knownHosts.copied': 'Отпечаток скопирован',
    'settings.knownHosts.forget': 'Забыть',
    'settings.knownHosts.forgetKey': 'Забыть этот ключ',
    'settings.knownHosts.keyCount_one': '{count} ключ',
    'settings.knownHosts.keyCount_few': '{count} ключа',
    'settings.knownHosts.keyCount_many': '{count} ключей',
    'settings.knownHosts.keyCount_other': '{count} ключа',
    'settings.knownHosts.empty': 'Пока нет доверенных ключей хостов',
    'settings.knownHosts.emptyNote': 'При первом подключении к серверу его ключ будет записан здесь.',
    'settings.knownHosts.confirmTitle': 'Забыть этот ключ хоста?',
    'settings.knownHosts.confirmMessage': 'При следующем подключении {host} будет считаться новым '
        + 'хостом, и вас снова попросят подтвердить его ключ.',
    'settings.knownHosts.forgotHost': '{host} забыт',
    'settings.knownHosts.forgotKey': 'Ключ {type} для {host} забыт',

    /* ---- Settings: Account ---- */
    'settings.account.title': 'Учётная запись',
    'settings.account.fallbackName': 'Учётная запись CloudBlast',
    'settings.account.yourAccount': 'вашей учётной записи CloudBlast',
    'settings.account.connectedAs': 'Подключено как {account}',
    'settings.account.disconnect': 'Отключить',
    'settings.account.disconnecting': 'Отключение…',
    'settings.account.disconnected': 'Учётная запись отключена',
    'settings.account.disconnectedLocally': 'Выход на этом устройстве выполнен, но связаться с '
        + 'консолью и отозвать доступ не удалось. Удалите устройство в разделе «Настройки → API».',
    'settings.account.connect': 'Подключите свою учётную запись',
    'settings.account.connectAction': 'Подключить',
    'settings.account.connectDesc': 'Синхронизируйте свои серверы и сохраните свою конфигурацию.',
    'settings.account.unlockFirst': 'Сначала разблокируйте приложение.',
    'settings.account.waitingForBrowser': 'Ожидание браузера…',
    'settings.account.syncServers': 'Синхронизировать мои серверы',
    'settings.account.syncServersDesc': 'Ваши серверы CloudBlast появятся в разделе «Хосты», готовые '
        + 'к подключению.',
    'settings.account.syncOn': 'Ваши серверы CloudBlast синхронизируются в «Хосты»',
    'settings.account.syncOff': 'Синхронизация выключена. Уже добавленные хосты остаются на месте.',
    'settings.account.syncNow': 'Синхронизировать',
    'settings.account.syncing': 'Синхронизация…',
    'settings.account.syncedAgo': 'Синхронизировано {when}',
    'settings.account.notSyncedYet': 'Ещё не синхронизировано',
    'settings.account.serverCount_one': '{count} сервер',
    'settings.account.serverCount_few': '{count} сервера',
    'settings.account.serverCount_many': '{count} серверов',
    'settings.account.serverCount_other': '{count} сервера',
    'settings.account.serversSynced_one': 'Синхронизирован {count} сервер',
    'settings.account.serversSynced_few': 'Синхронизировано {count} сервера',
    'settings.account.serversSynced_many': 'Синхронизировано {count} серверов',
    'settings.account.serversSynced_other': 'Синхронизировано {count} сервера',
    'settings.account.noServers': 'В этой учётной записи пока нет серверов',
    'settings.account.cloudBackup': 'Резервная копия в облаке',
    'settings.account.cloudBackupDesc': 'Ваши хосты, папки, ключи и настройки, сохранённые в учётной '
        + 'записи для ваших других устройств.',
    'settings.account.backupOn': 'Резервное копирование в облако включено',
    'settings.account.backupOff': 'Резервное копирование в облако выключено. То, что уже сохранено, '
        + 'останется, пока вы это не замените.',
    'settings.account.backedUp': 'Сохранено в вашей учётной записи CloudBlast',
    'settings.account.saveNow': 'Сохранить сейчас',
    'settings.account.saving': 'Сохранение…',
    'settings.account.savedAgo': 'Сохранено {when}',
    'settings.account.notSavedYet': 'Ещё не сохранено',
    'settings.account.justNow': 'только что',
    'settings.account.minutesAgo': '{count} мин назад',
    'settings.account.hoursAgo': '{count} ч назад',
    'settings.account.daysAgo': '{count} дн назад',

    /* ---- Settings: Backup ---- */
    'settings.backup.title': 'Резервные копии',
    'settings.backup.desc': 'Перенесите готовую конфигурацию сюда или заберите копию с собой.',
    'settings.backup.exportTitle': 'Создать резервную копию',
    'settings.backup.exportDesc': 'Записывает каждый хост, папку, ключ SSH, сниппет, проброс порта '
        + 'и доверенный ключ хоста в один зашифрованный файл, защищённый парольной фразой, которую '
        + 'вы задаёте здесь.',
    'settings.backup.exportNote': 'Эта парольная фраза не связана с паролем на открытие, поэтому '
        + 'файл откроется и на машине, которая эту никогда не видела.',
    'settings.backup.create': 'Создать копию',
    'settings.backup.passphrase': 'Парольная фраза копии',
    'settings.backup.confirmPassphrase': 'Подтвердите парольную фразу',
    'settings.backup.tooShort': 'Используйте не менее {count} символов',
    'settings.backup.mismatch': 'Парольные фразы не совпадают',
    'settings.backup.acknowledge': 'Я понимаю, что этот файл содержит мои сохранённые учётные данные',
    'settings.backup.acknowledgeDesc': 'Любой, у кого есть и файл, и эта парольная фраза, сможет '
        + 'прочитать в нём каждый сохранённый пароль, закрытый ключ и парольную фразу. Держите его '
        + 'там же, где держали бы сами учётные данные.',
    'settings.backup.chooseLocation': 'Выбрать расположение…',
    'settings.backup.exportFailed': 'Не удалось записать резервную копию',
    'settings.backup.exported': 'Копия сохранена: {hosts}, {keys}, {snippets}',
    'settings.backup.restoreTitle': 'Восстановить из копии',
    'settings.backup.restoreDesc': 'Читает файл .cbbackup и добавляет то, что в нём есть. Вы '
        + 'увидите его содержимое до того, как что-либо изменится.',
    'settings.backup.restoreNote': 'То, что здесь уже есть, по умолчанию не трогается, поэтому '
        + 'восстанавливать дважды безопасно.',
    'settings.backup.chooseFile': 'Выбрать файл…',
    'settings.backup.openTitle': 'Открыть зашифрованную копию',
    'settings.backup.fileKind': 'Копия CloudBlast',
    'settings.backup.pickerFailed': 'Не удалось открыть выбор файла',
    'settings.backup.file': 'Файл',
    'settings.backup.open': 'Открыть копию',
    'settings.backup.opening': 'Открытие…',
    'settings.backup.openFailed': 'Не удалось открыть эту копию',
    'settings.backup.from': 'Копия от {when}',
    'settings.backup.unknownDate': 'неизвестной даты',
    'settings.backup.appVersion': 'приложение {version}',
    'settings.backup.emptyFile': 'Эта копия пуста.',
    'settings.backup.folders': 'Папки',
    'settings.backup.keys': 'Ключи SSH',
    'settings.backup.newCount': 'новых: {count}',
    'settings.backup.existingReplaced': 'уже здесь: {count}, будут заменены',
    'settings.backup.existingSkipped': 'уже здесь: {count}, будут пропущены',
    'settings.backup.trustedKeys': 'Доверенные ключи',
    'settings.backup.hostWord_one': 'хост',
    'settings.backup.hostWord_few': 'хоста',
    'settings.backup.hostWord_many': 'хостов',
    'settings.backup.hostWord_other': 'хоста',
    'settings.backup.overwrite': 'Заменять записи, которые уже здесь есть',
    'settings.backup.overwriteDesc': 'Сопоставление идёт по id записи, а не по имени. Оставьте '
        + 'выключенным, чтобы добавить только недостающее; включите, чтобы привести эту машину в '
        + 'соответствие с копией, отбросив локальные правки этих записей.',
    'settings.backup.overwriteWarning': 'Локальные изменения в соответствующих записях будут потеряны.',
    'settings.backup.restore': 'Восстановить',
    'settings.backup.restoring': 'Восстановление…',
    'settings.backup.restoreFailed': 'Восстановление не завершилось',
    'settings.backup.restored_one': 'Восстановлен {count} новый элемент',
    'settings.backup.restored_few': 'Восстановлено {count} новых элемента',
    'settings.backup.restored_many': 'Восстановлено {count} новых элементов',
    'settings.backup.restored_other': 'Восстановлено {count} новых элемента',
    'settings.backup.restoredAndReplaced_one': 'Восстановлен {count} новый элемент, заменено '
        + '{replaced}',
    'settings.backup.restoredAndReplaced_few': 'Восстановлено {count} новых элемента, заменено '
        + '{replaced}',
    'settings.backup.restoredAndReplaced_many': 'Восстановлено {count} новых элементов, заменено '
        + '{replaced}',
    'settings.backup.restoredAndReplaced_other': 'Восстановлено {count} новых элемента, заменено '
        + '{replaced}',
    'settings.backup.duplicateKeys_one': '{count} хост теперь доверяет более чем одному ключу '
        + 'одного типа. Загляните в «Безопасность», раздел «Известные хосты».',
    'settings.backup.duplicateKeys_few': '{count} хоста теперь доверяют более чем одному ключу '
        + 'одного типа. Загляните в «Безопасность», раздел «Известные хосты».',
    'settings.backup.duplicateKeys_many': '{count} хостов теперь доверяют более чем одному ключу '
        + 'одного типа. Загляните в «Безопасность», раздел «Известные хосты».',
    'settings.backup.duplicateKeys_other': '{count} хоста теперь доверяют более чем одному ключу '
        + 'одного типа. Загляните в «Безопасность», раздел «Известные хосты».',

    /* ---- Settings: About ---- */
    'settings.about.title': 'О программе',
    'settings.about.version': 'Версия {version}',
    'settings.about.updates': 'Обновления',
    'settings.about.checking': 'Проверка обновлений…',
    'settings.about.checkingShort': 'Проверка…',
    'settings.about.checkNow': 'Проверить обновления',
    'settings.about.disabled': 'Для этой установки проверка обновлений отключена.',
    'settings.about.ready': 'Версия {version} готова к установке. Перезапустите, чтобы завершить.',
    'settings.about.downloading': 'Загрузка обновления…',
    'settings.about.downloadingVersion': 'Загрузка версии {version}…',
    'settings.about.available': 'Доступна версия {version}.',
    'settings.about.availableToDownload': 'Версия {version} доступна для загрузки.',
    'settings.about.upToDate': 'Установлена последняя версия. Последняя проверка: {when}.',
    'settings.about.neverChecked': 'Проверок ещё не было.',
    'settings.about.restartToUpdate': 'Перезапустить и обновить',
    'settings.about.download': 'Загрузить {version}',
    'settings.about.noChecksLeft': 'Проверки на этот час исчерпаны.',
    'settings.about.noChecksUntil': 'Проверки на этот час исчерпаны, до {when}.',
    'settings.about.checksLeft_one': 'Осталась {count} проверка из {limit} в этот час.',
    'settings.about.checksLeft_few': 'Осталось {count} проверки из {limit} в этот час.',
    'settings.about.checksLeft_many': 'Осталось {count} проверок из {limit} в этот час.',
    'settings.about.checksLeft_other': 'Осталось {count} проверки из {limit} в этот час.',
    'settings.about.noteInstall': 'Обновления загружаются в фоне и устанавливаются при выходе. '
        + 'Проверка запрашивает у GitHub последний выпуск и не отправляет ничего о вас или вашей '
        + 'машине.',
    'settings.about.noteNotify': 'Обновления не устанавливаются автоматически. Загрузка открывается '
        + 'в вашем браузере, где система может её проверить. Проверка запрашивает у GitHub '
        + 'последний выпуск и не отправляет ничего о вас или вашей машине.',

    /* ---- More shared words ---- */
    'common.add': 'Добавить',
    'common.copy': 'Копировать',
    'common.delete': 'Удалить',
    'common.deleteNamed': 'Удалить {name}',
    'common.edit': 'Изменить',
    'common.rename': 'Переименовать',

    /* ---- Hosts ---- */
    'hosts.rootLabel': 'Все хосты',
    'hosts.unnamed': 'Хост без имени',
    'hosts.noPort': 'Нет порта',
    'hosts.connected': 'Подключено',
    'hosts.viaProxy': 'через прокси',
    'hosts.tunnelCount_one': '{count} туннель',
    'hosts.tunnelCount_few': '{count} туннеля',
    'hosts.tunnelCount_many': '{count} туннелей',
    'hosts.tunnelCount_other': '{count} туннеля',
    'hosts.itemCount_one': '{count} элемент',
    'hosts.itemCount_few': '{count} элемента',
    'hosts.itemCount_many': '{count} элементов',
    'hosts.itemCount_other': '{count} элемента',
    'hosts.selectedCount': 'Выбрано: {count}',
    'hosts.folderEmpty': 'Пусто',
    'hosts.folderActions': 'Действия с папкой',
    'hosts.syncedBadge': 'Синхронизировано',
    'hosts.syncedAccount': 'Синхронизировано из вашей учётной записи CloudBlast',
    'hosts.syncedProject': 'Проект в вашей учётной записи CloudBlast. Синхронизация сохраняет его '
        + 'имя и его место',
    'hosts.upOneLevel': 'На уровень выше',
    'hosts.dragHint': 'Перетащите карточку на папку, чтобы убрать её туда · Растяните рамку, чтобы '
        + 'выбрать несколько',
    'hosts.dragHintFiltered': 'Растяните рамку по карточкам, чтобы выбрать несколько',

    'hosts.open': 'Открыть',
    'hosts.editHost': 'Изменить хост',
    'hosts.connectVia': 'Подключиться по {protocol}',
    'hosts.openIpmi': 'Открыть IPMI',
    'hosts.notSetUp': 'не настроено',
    'hosts.moveToFolder': 'Переместить в папку…',
    'hosts.keepsContents': 'содержимое останется',
    'hosts.move': 'Переместить',
    'hosts.tag': 'Метка',
    'hosts.tags': 'Метки…',
    'hosts.moveMany': 'Переместить {what}…',
    'hosts.groupIntoFolder': 'Собрать в папку…',
    'hosts.clearSelection': 'Снять выделение',

    'hosts.deleteHostTitle': 'Удалить этот хост?',
    'hosts.deleteHostMessage': '«{name}» и сохранённые для него учётные данные будут удалены. Уже '
        + 'открытые сеансы останутся подключёнными.',
    'hosts.deleteHost': 'Удалить хост',
    'hosts.deleteFolderTitle': 'Удалить эту папку?',
    'hosts.deleteFolderMessage': '«{name}» будет удалена. Всё, что внутри, поднимется на уровень '
        + 'выше, а не удалится.',
    'hosts.deleteFolder': 'Удалить папку',
    'hosts.deleted': '«{name}» удалён',
    'hosts.deleteManyTitle': 'Удалить {what}?',
    'hosts.deleteMany': 'Удалить {what}',
    'hosts.deletedMany': 'Удалено: {what}',
    'hosts.deleteManyHostsNote': 'Хосты удаляются вместе с сохранёнными учётными данными, а уже '
        + 'открытые сеансы остаются подключёнными.',
    'hosts.deleteManyFoldersNote': 'Папки удаляются, но всё, что внутри, поднимается на уровень '
        + 'выше, а не удаляется.',
    'hosts.deleteFailed': 'Не удалось удалить: {reason}',

    'hosts.moved': 'Перемещено: {what}',
    'hosts.movedSome': 'Перемещено {count} из {of}; остальное туда попасть не смогло',
    'hosts.movedTo': '{what} перемещено в {where}',
    'hosts.movedSomeTo': 'Перемещено {count} из {of} в {where}',
    'hosts.movedInto': '{what} перемещено в «{name}»',
    'hosts.nothingToMove': 'Перемещать нечего: всё уже там',
    'hosts.folderInsideItself': 'Папку нельзя переместить внутрь неё самой.',
    'hosts.moveTitle': 'Переместить элементов: {count}',
    'hosts.moveSubtitle': 'Выберите папку, в которую они пойдут.',
    'hosts.findFolder': 'Найти папку…',
    'hosts.noFolderMatches': 'Нет папок по запросу «{query}».',
    'hosts.alreadyHere': 'уже здесь',
    'hosts.insideSelection': 'внутри выделения',

    'hosts.editFolder': 'Изменить папку',
    'hosts.saveFolder': 'Сохранить папку',
    'hosts.createFolder': 'Создать папку',
    'hosts.creating': 'Создание…',
    'hosts.folderName': 'Название папки',
    'hosts.folderNamePlaceholder': 'например, Серверы AWS',
    'hosts.folderSubtitle': 'Папки группируют хосты. Удаление папки сохраняет всё, что было внутри.',
    'hosts.folderCreateFailed': 'Не удалось создать эту папку',
    'hosts.folderCreateFailedWhy': 'Не удалось создать эту папку: {reason}',
    'hosts.groupTitle': 'Новая папка из выделенного',
    'hosts.groupSubtitle': '{what} будет перемещено в неё, внутри {parent}.',

    'hosts.sort': 'Сортировка',
    'hosts.sortLabel': 'Сортировка: {sort}',
    'hosts.sortNameAsc': 'Имя А-Я',
    'hosts.sortNameDesc': 'Имя Я-А',
    'hosts.sortRecent': 'Недавно использованные',
    'hosts.sortManual': 'Вручную',
    'hosts.filterByTag': 'Фильтр по метке',
    'hosts.filteredByTags_one': 'фильтр по {count} метке',
    'hosts.filteredByTags_few': 'фильтр по {count} меткам',
    'hosts.filteredByTags_many': 'фильтр по {count} меткам',
    'hosts.filteredByTags_other': 'фильтр по {count} меткам',
    'hosts.filterBy': 'Фильтровать по «{tag}»',
    'hosts.stopFilteringBy': 'Не фильтровать по «{tag}»',
    'hosts.searchTags': 'Поиск по меткам',
    'hosts.searchTagsPlaceholder': 'Поиск среди {count} меток…',
    'hosts.noTagMatches': 'Нет меток по запросу «{query}»',
    'hosts.tagMode.all': 'все',
    'hosts.tagMode.any': 'любая',
    'hosts.tagModeAllHint': 'Хосты со всеми выбранными метками',
    'hosts.tagModeAnyHint': 'Хосты хотя бы с одной выбранной меткой',

    'hosts.tagTitle': 'Метки для хостов',
    'hosts.tagSubtitle': 'Выбрано: {what}. Метки в промежуточном состоянии стоят у части из них и '
        + 'останутся такими, пока вы их не тронете.',
    'hosts.applying': 'Применение…',
    'hosts.newTag': 'Новая метка',
    'hosts.newTagPlaceholder': 'Новая метка…',
    'hosts.noTagsYet': 'Меток пока нет. Введите одну выше, чтобы начать.',
    'hosts.tagWillAdd': 'будет добавлена',
    'hosts.tagWillRemove': 'будет убрана',
    'hosts.tagOnAll': 'у всех',
    'hosts.tagOnSome': 'у {on} из {total}',

    /* ---- Protocols ---- */
    'protocol.serial': 'Последовательный порт',
    'protocol.desktop': 'Рабочий стол',
    'protocol.ssh.summary': 'Шифрованная оболочка и всё, что на ней построено',
    'protocol.ssh.detail': 'Файлы, проброс портов и удалённый рабочий стол это каналы одного '
        + 'соединения SSH, поэтому они предлагаются только здесь.',
    'protocol.telnet.summary': 'Обычный сокет к устройству без SSH',
    'protocol.telnet.detail': 'Отправляет всё, включая пароли, в открытом виде. Для консольного '
        + 'сервера, PDU или коммутатора, на котором никогда не было демона SSH.',
    'protocol.serial.summary': 'Консольный кабель на этой машине',
    'protocol.serial.detail': 'Сети нет вовсе. Настройки должны точно совпадать с устройством: '
        + 'неверная скорость печатает мусор, а не сообщает об ошибке.',
    'protocol.desktop.summary': 'RDP или VNC, без оболочки за ними',
    'protocol.desktop.detail': 'Открывается сразу в удалённом рабочем столе и никогда не набирает '
        + 'SSH. Для машины с Windows, на которой обычно нет сервера SSH.',
    'protocol.ipmi.summary': 'Сервисный процессор, и ничего за ним',
    'protocol.ipmi.detail': 'Открывает собственный веб-интерфейс BMC и никогда не обращается к '
        + 'самой машине. Для платы iDRAC, iLO или Supermicro перед хостом, к которому у этого '
        + 'приложения нет сеанса.',

    /* ---- Serial ---- */
    'serial.port': 'Последовательный порт',
    'serial.selectPort': 'Выберите порт…',
    'serial.rescan': 'Искать порты снова',
    'serial.noPorts': 'Последовательные порты не найдены. Подключите переходник и повторите поиск.',
    'serial.portMissing': '{path} сейчас не подключён. Он сохранён на хосте и снова заработает, '
        + 'когда кабель вернётся на место.',
    'serial.baudRate': 'Скорость',
    'serial.dataBits': 'Биты данных',
    'serial.stopBits': 'Стоп-биты',
    'serial.parity': 'Чётность',
    'serial.parityNone': 'Нет',
    'serial.parityEven': 'Чётная',
    'serial.parityOdd': 'Нечётная',
    'serial.parityMark': 'Mark',
    'serial.paritySpace': 'Space',
    'serial.flowControl': 'Управление потоком',
    'serial.flowNone': 'Нет',
    'serial.flowHardware': 'Аппаратное (RTS/CTS)',
    'serial.flowSoftware': 'Программное (XON/XOFF)',
    'serial.enterSends': 'Enter отправляет',
    'serial.enterSendsHint': 'Ни один протокол на это не отвечает. Устройство с неверным значением '
        + 'выглядит мёртвым: приглашение просто не возвращается.',
    'serial.newlineCrHint': 'Сетевое оборудование, большинство консолей',
    'serial.newlineLfHint': 'Linux getty',
    'serial.newlineCrLfHint': 'Некоторые встраиваемые мониторы',
    'serial.localEcho': 'Показывать то, что я набираю',
    'serial.localEchoHint': 'Включите для устройства, которое не возвращает эхо. Без этого панель '
        + 'остаётся пустой, пока вы печатаете, и это выглядит как мёртвый порт, а не как тихий.',
    'serial.dtr': 'Поднимать DTR при открытии',
    'serial.dtrHint': 'По умолчанию включено, чего и ждёт большинство устройств. Выключите для '
        + 'платы, у которой DTR заведён на сброс, иначе она будет перезагружаться при каждом '
        + 'открытии порта.',
    'serial.rts': 'Поднимать RTS при открытии',
    'serial.rtsHint': 'По умолчанию включено. У некоторых переходников RTS заведён на сброс или '
        + 'загрузку.',
    'serial.rtsIgnored': 'Игнорируется при включённом аппаратном управлении потоком: тогда RTS '
        + 'принадлежит драйверу.',
    'serial.noWindowSize': 'Последовательная линия не передаёт ни размер окна, ни тип терминала, '
        + 'поэтому устройство считает его 80×24, каким бы большим ни была панель.',

    /* ---- Port forwarding ---- */
    'tunnel.heading': 'Проброс портов',
    'tunnel.headingNote': 'Туннели работают поверх соединения этого сеанса и останавливаются при '
        + 'его закрытии.',
    'tunnel.local': 'Локальный',
    'tunnel.remote': 'Удалённый',
    'tunnel.dynamic': 'Динамический',
    'tunnel.local.summary': 'Достать удалённую службу с этой машины',
    'tunnel.local.detail': 'Открывает порт здесь. Всё, что к нему подключается, выходит на сервере, '
        + 'который затем набирает адрес назначения.',
    'tunnel.remote.summary': 'Открыть локальную службу на сервере',
    'tunnel.remote.detail': 'Открывает порт на сервере. Принятые им соединения набираются с этой '
        + 'машины.',
    'tunnel.dynamic.summary': 'Прокси SOCKS5 через сервер',
    'tunnel.dynamic.detail': 'Открывает прокси SOCKS5 здесь. Каждое соединение само называет своё '
        + 'назначение, которое набирает сервер.',
    'tunnel.newTitle': 'Новый проброс порта',
    'tunnel.editTitle': 'Изменить проброс порта',
    'tunnel.add': 'Добавить проброс',
    'tunnel.added': 'Проброс добавлен',
    'tunnel.updated': 'Проброс обновлён',
    'tunnel.removed': 'Проброс удалён',
    'tunnel.removeTitle': 'Удалить этот проброс порта?',
    'tunnel.removeMessage': '{tunnel} будет остановлен и удалён с {host}.',
    'tunnel.label': 'Подпись',
    'tunnel.labelHint': 'Необязательно, показывается вместо адресов',
    'tunnel.labelPlaceholder': 'например, Боевая база данных',
    'tunnel.listenAddress': 'Адрес прослушивания',
    'tunnel.listenPort': 'Порт прослушивания',
    'tunnel.bindAddress': 'Адрес привязки на сервере',
    'tunnel.bindAddressHint': 'Для всего, кроме loopback, нужен «GatewayPorts yes»',
    'tunnel.remotePort': 'Удалённый порт',
    'tunnel.autoPort': '0 = автоматически',
    'tunnel.destHost': 'Хост назначения',
    'tunnel.destHostLocalHint': 'Разрешается с этой машины',
    'tunnel.destHostRemoteHint': 'Разрешается с сервера, поэтому его внутренние имена работают',
    'tunnel.destPort': 'Порт назначения',
    'tunnel.autoStart': 'Запускать вместе с подключением',
    'tunnel.autoStartHint': 'Поднимается всякий раз, когда этот хост подключается, в том числе '
        + 'после переподключения.',
    'tunnel.autoBadge': 'авто',
    'tunnel.exposedWarning': 'Любой, кто дотянется до этой машины по сети, сможет пользоваться этим '
        + 'пробросом. Используйте 127.0.0.1, если не собираетесь делиться им намеренно.',
    'tunnel.badRemotePort': 'Удалённый порт должен быть от 0 до 65535',
    'tunnel.badListenPort': 'Порт прослушивания должен быть от 1 до 65535',
    'tunnel.destHostRequired': 'Нужно указать хост назначения',
    'tunnel.badDestPort': 'Порт назначения должен быть от 1 до 65535',
    'tunnel.anywhere': 'куда угодно',
    'tunnel.serverWord': 'сервер',
    'tunnel.usageLocal': 'Подключайтесь к {where}',
    'tunnel.usageRemote': 'На сервере: {where}',
    'tunnel.usageDynamic': 'Прокси SOCKS5 на {where}',
    'tunnel.stateActive': 'Активен',
    'tunnel.stateStarting': 'Запускается…',
    'tunnel.stateStopped': 'Остановлен',
    'tunnel.stateFailed': 'Сбой',
    'tunnel.start': 'Запустить',
    'tunnel.stop': 'Остановить',
    'tunnel.startAll': 'Запустить все',
    'tunnel.stopAll': 'Остановить все',
    'tunnel.connections': 'соед.',
    'tunnel.copyAddress': 'Скопировать адрес',
    'tunnel.addressCopied': 'Адрес скопирован',
    'tunnel.lastError': 'последняя ошибка: {error}',
    'tunnel.sessionDown': 'Сеанс не подключён. Пробросы запустятся снова при переподключении.',
    'tunnel.empty': 'Пробросов портов пока нет',
    'tunnel.emptyNote': 'Пробросьте порт, чтобы достать базу данных или внутреннюю панель через '
        + 'этот сервер, либо откройте прокси SOCKS, чтобы ходить в сеть из него.',
    'tunnel.editorEmpty': 'Пробросьте порт, чтобы достать базу данных или внутреннюю службу через '
        + 'этот хост, либо откройте прокси SOCKS, чтобы ходить в сеть из него.',

    /* ---- Assistant panel ---- */
    'assistant.title': 'ИИ-ассистент',
    'assistant.welcome': 'Займёмся вашими серверами',
    'assistant.welcomeNote': 'Он читает этот терминал, выполняет команды в отдельном канале и может '
        + 'работать со всеми сохранёнными хостами.',
    'assistant.createQuickPrompts': 'Создать быстрые вопросы',
    'assistant.newConversation': 'Новый разговор',
    'assistant.chats': 'Разговоры',
    'assistant.chatHistory': 'История разговоров',
    'assistant.working': 'Работает',
    'assistant.send': 'Отправить',
    'assistant.stop': 'Остановить',
    'assistant.askAbout': 'Спросите про {about}',
    'assistant.costHint': 'Оценка стоимости этого разговора, оплата по токенам',

    'assistant.currentSession': 'Текущий сеанс',
    'assistant.nothingConnected': 'Ничего не подключено',
    'assistant.noSessionOpen': 'Нет открытых сеансов',
    'assistant.yourServers': 'ваши серверы',
    'assistant.anyHost': 'любой хост',
    'assistant.closedSession': 'закрытый сеанс',
    'assistant.savedHost': 'сохранённый хост',
    'assistant.savedHosts': 'Сохранённые хосты',
    'assistant.openSessions': 'Открытые сеансы',
    'assistant.allHostsHint': 'Все сохранённые хосты и открытые сеансы',
    'assistant.serverCount': 'серверов: {count}',
    'assistant.sessionsOpen_one': 'открыт {count} сеанс',
    'assistant.sessionsOpen_few': 'открыто {count} сеанса',
    'assistant.sessionsOpen_many': 'открыто {count} сеансов',
    'assistant.sessionsOpen_other': 'открыто {count} сеанса',
    'assistant.notConnected': 'Не подключён',
    'assistant.searchScope': 'Поиск серверов',
    'assistant.searchScopeAria': 'Поиск сеансов и хостов',

    'assistant.model': 'Модель',
    'assistant.modelAndEffort': 'Модель и усилие',
    'assistant.readingModels': 'Читаем список моделей…',
    'assistant.noModels': 'Моделей не сообщено. Попробуйте снова',
    'assistant.notInRuntimeList': 'Нет в списке этого рантайма',
    'assistant.agentDefault': 'По умолчанию для {agent}',
    'assistant.agentDefaultHint': 'То, что использует установленный у вас {agent}',
    'assistant.effort': 'Усилие',
    'assistant.effortLow': 'Низкое',
    'assistant.effortMedium': 'Среднее',
    'assistant.effortHigh': 'Высокое',
    'assistant.effortXHigh': 'Очень высокое',
    'assistant.effortMax': 'Максимум',
    'assistant.effortUltra': 'Ультра',

    'assistant.approvalsLabel': 'Подтверждения: {mode}',
    'assistant.approvalAlways': 'Спрашивать каждый раз',
    'assistant.approvalAlwaysHint': 'Каждый вызов инструмента ждёт вас',
    'assistant.approvalWrites': 'Спрашивать перед изменениями',
    'assistant.approvalWritesHint': 'Чтение выполняется свободно',
    'assistant.approvalNever': 'Режим Yolo',
    'assistant.approvalNeverHint': 'Ничто не останавливается, включая удаление',

    'assistant.didListHosts': 'Перечислил хосты',
    'assistant.didListSessions': 'Перечислил сеансы',
    'assistant.didReadTerminal': 'Прочитал терминал',
    'assistant.didRun': 'Выполнил',
    'assistant.didType': 'Набрал',
    'assistant.didList': 'Перечислил',
    'assistant.didRead': 'Прочитал',
    'assistant.didWrite': 'Записал',
    'assistant.didConnect': 'Подключился к',
    'assistant.didDisconnect': 'Закрыл сеанс',
    'assistant.lastLines': 'последние {count} строк',
    'assistant.recentOutput': 'недавний вывод',
    'assistant.matching': 'по запросу "{query}"',

    'assistant.askRunCommand': 'Выполнить команду',
    'assistant.askSendInput': 'Набрать в терминале',
    'assistant.askWriteFile': 'Перезаписать файл',
    'assistant.askConnectHost': 'Открыть соединение',
    'assistant.askDisconnect': 'Закрыть сеанс',
    'assistant.askReadTerminal': 'Прочитать терминал',
    'assistant.askReadFile': 'Прочитать файл',
    'assistant.askListDirectory': 'Показать каталог',
    'assistant.askListHosts': 'Показать сохранённые хосты',
    'assistant.askListSessions': 'Показать открытые сеансы',
    'assistant.askRunLocally': 'Выполнить {tool} локально',
    'assistant.onHost': 'на {host}',
    'assistant.allow': 'Разрешить',
    'assistant.decline': 'Отклонить',
    'assistant.somethingElse': 'Что-нибудь другое…',
    'assistant.insteadPlaceholder': 'Что ему стоит сделать вместо этого?',
    'assistant.copyCommand': 'Скопировать команду',
    'assistant.localWarning': 'Это выполняется на вашем компьютере, а не на сервере.',
    'assistant.allowed': 'Разрешено',
    'assistant.declined': 'Отклонено',
    'assistant.timedOut': 'Истекло время',
};
