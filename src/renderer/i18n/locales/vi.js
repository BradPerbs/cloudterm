/**
 * Tiếng Việt (Vietnamese).
 *
 * Vietnamese has one plural form, so every counted string is stored as `_other`
 * alone. Anything missing here falls back to en.js.
 */
export default {
    /* ---- Shared words ---- */
    'common.allFiles': 'Tất cả tệp',
    'common.apply': 'Áp dụng',
    'common.cancel': 'Huỷ',
    'common.change': 'Đổi',
    'common.changeEllipsis': 'Đổi…',
    'common.clear': 'Xoá bộ lọc',
    'common.close': 'Đóng',
    'common.filter': 'Lọc',
    'common.filtered': 'Đã lọc.',
    'common.keepCurrentColors': 'Không dùng mẫu nào (giữ màu hiện tại)',
    'common.left': 'Trái',
    'common.loading': 'Đang tải…',
    'common.noFilterMatches': 'Không có gì khớp với các bộ lọc đó.',
    'common.noMatches': 'Không có gì khớp với “{query}”',
    'common.noMatchesTitle': 'Không có kết quả',
    'common.off': 'Tắt',
    'common.remove': 'Gỡ bỏ',
    'common.reset': 'Đặt lại',
    'common.right': 'Phải',
    'common.save': 'Lưu',
    'common.saveAndApply': 'Lưu và áp dụng',
    'common.startFrom': 'Bắt đầu từ',
    'common.working': 'Đang xử lý…',

    /* ---- Sidebar ---- */
    'nav.hosts': 'Máy chủ',
    'nav.keychain': 'Kho khoá',
    'nav.proxies': 'Proxy',
    'nav.snippets': 'Đoạn lệnh',
    'nav.logs': 'Nhật ký',
    'nav.settings': 'Cài đặt',

    /* ---- Hosts ---- */
    'hosts.count_other': '{count} máy chủ',
    'hosts.folderCount_other': '{count} thư mục',
    'hosts.empty': 'Chưa có máy chủ nào',
    'hosts.emptyNote': 'Thêm một máy chủ để bắt đầu.',
    'hosts.emptyFolder': 'Ở đây chưa có gì',
    'hosts.layout': 'Bố cục thẻ',
    'hosts.newFolder': 'Thư mục mới',
    'hosts.newHost': 'Máy chủ mới',
    'hosts.search': 'Tìm máy chủ',
    'hosts.viewGrid': 'Lưới',
    'hosts.viewList': 'Danh sách',

    /* ---- Keychain ---- */
    'keychain.count_other': '{count} khoá',
    'keychain.empty': 'Chưa có khoá nào',
    'keychain.emptyNote': 'Tạo mới hoặc nhập một khoá để bắt đầu.',
    'keychain.helloAdd': 'Thêm khoá Windows Hello, lưu trong TPM của máy này',
    'keychain.helloWaiting': 'Đang chờ Windows Hello…',
    'keychain.import': 'Nhập khoá có sẵn, từ tệp hoặc dán vào',
    'keychain.newKey': 'Khoá mới',
    'keychain.search': 'Tìm khoá',

    /* ---- Proxies ---- */
    'proxies.empty': 'Chưa có proxy nào',
    'proxies.emptyNote': 'Thêm một proxy SOCKS hoặc HTTP và mọi máy chủ đều có thể kết nối qua nó: '
        + 'phiên terminal, SFTP, chuyển tiếp cổng và cả máy tính từ xa.',
    'proxies.newProxy': 'Proxy mới',
    'proxies.search': 'Tìm proxy',

    /* ---- Snippets ---- */
    'snippets.count_other': '{count} đoạn lệnh',
    'snippets.empty': 'Chưa có đoạn lệnh nào',
    'snippets.emptyNote': 'Lưu lại những lệnh bạn phải gõ đi gõ lại trên mọi máy.',
    'snippets.newPackage': 'Gói mới',
    'snippets.newSnippet': 'Đoạn lệnh mới',
    'snippets.nothingShown': 'Không hiển thị gì',
    'snippets.search': 'Tìm đoạn lệnh',
    'snippets.showing': 'Đang hiển thị: {kind}',
    'snippets.kind.all': 'Tất cả',
    'snippets.kind.command': 'Chỉ lệnh',
    'snippets.kind.package': 'Chỉ gói',

    /* ---- Logs ---- */
    'logs.blurbStart': 'Mọi kết nối đã tạo và mọi bản ghi đã thay đổi trên máy này, mới nhất '
        + 'trước. Được ghi kèm tài khoản hệ điều hành đang đăng nhập',
    'logs.blurbEnd': ', và chỉ đánh dấu trên dòng khi đó là người khác. Mật khẩu và nội dung khoá '
        + 'không bao giờ được ghi lại.',
    'logs.categoryConnection': 'Kết nối',
    'logs.categoryData': 'Thay đổi',
    'logs.categoryFiles': 'Tệp',
    'logs.categorySecurity': 'Bảo mật',
    'logs.empty': 'Chưa ghi nhận gì',
    'logs.emptyNote': 'Kết nối và thay đổi sẽ xuất hiện ở đây khi bạn thực hiện chúng.',
    'logs.export': 'Xuất ra JSON',
    'logs.filterAll': 'Tất cả',
    'logs.filterAria': 'Lọc nhật ký hoạt động',
    'logs.noMatches': 'Không có gì khớp với các bộ lọc đó',
    'logs.noMatchesNote': 'Thử một danh mục khác, hoặc xoá nội dung ô lọc.',
    'logs.problemsOnly': 'Chỉ sự cố',
    'logs.reading': 'Đang đọc nhật ký…',
    'logs.refresh': 'Làm mới',

    /* ---- New session tab ---- */
    'newTab.title': 'Phiên mới',
    'newTab.subtitle': 'Chọn một máy chủ, hoặc gõ địa chỉ để kết nối thẳng tới nó.',
    'newTab.searchPlaceholder': 'Tìm máy chủ, hoặc gõ một địa chỉ…',
    'newTab.recent': 'Gần đây',
    'newTab.allHosts': 'Tất cả máy chủ',
    'newTab.notSaved': 'Chưa lưu',
    'newTab.notSavedNote': 'Chưa lưu. Thông tin đăng nhập sẽ được hỏi khi kết nối.',
    'newTab.connectTo': 'Kết nối tới',
    'newTab.hintNavigate': 'di chuyển',
    'newTab.hintConnect': 'kết nối',
    'newTab.hintClose': 'đóng thẻ',

    /* ---- Title bar ---- */
    'titleBar.reload': 'Tải lại',
    'titleBar.devTools': 'Công cụ nhà phát triển',
    'titleBar.minimize': 'Thu nhỏ',
    'titleBar.maximize': 'Phóng to',
    'titleBar.exit': 'Thoát',
    'titleBar.rename': 'Đổi tên…',
    'titleBar.renameAria': 'Đổi tên {name}',
    'titleBar.renameGroup': 'Đổi tên nhóm…',
    'titleBar.renameGroupAria': 'Đổi tên nhóm {name}',
    'titleBar.useHostName': 'Dùng lại tên máy chủ',
    'titleBar.colour': 'Màu',
    'titleBar.removeFromGroup': 'Bỏ khỏi nhóm',
    'titleBar.newGroup': 'Tạo nhóm mới từ thẻ này',
    'titleBar.moveToGroup': 'Chuyển sang “{group}”',
    'titleBar.duplicate': 'Nhân bản',
    'titleBar.reconnect': 'Kết nối lại',
    'titleBar.reconnectAll': 'Kết nối lại tất cả',
    'titleBar.disconnect': 'Ngắt kết nối',
    'titleBar.disconnectAll': 'Ngắt kết nối tất cả',
    'titleBar.closeTab': 'Đóng thẻ',
    'titleBar.closeOthers': 'Đóng các thẻ khác',
    'titleBar.closeRight': 'Đóng các thẻ bên phải',
    'titleBar.ungroup': 'Bỏ nhóm',
    'titleBar.closeGroupTabs_other': 'Đóng cả {count} thẻ',

    /* ---- Monitoring vocabulary ---- */
    'monitor.every30s': '30 giây',
    'monitor.every1min': '1 phút',
    'monitor.every5min': '5 phút',
    'monitor.every15min': '15 phút',
    'monitor.wait5s': '5 giây',
    'monitor.wait10s': '10 giây',
    'monitor.wait20s': '20 giây',
    'monitor.wait30s': '30 giây',
    'monitor.onceFailed': '1 lần',
    'monitor.twiceFailed': '2 lần',
    'monitor.thriceFailed': '3 lần',
    'monitor.stateOnline': 'Có phản hồi',
    'monitor.stateOffline': 'Không phản hồi',
    'monitor.stateProblem': 'Không kiểm tra được',
    'monitor.stateUnknown': 'Chưa kiểm tra',
    'monitor.unsupportedSerial': 'Cổng serial không có địa chỉ mạng nào để kiểm tra.',
    'monitor.unsupportedJump': 'Máy chủ này được truy cập qua một máy trung gian, nên từ máy này '
        + 'không có đường nào để kiểm tra. Hãy theo dõi máy trung gian đó thay vì máy này.',
    'monitor.justNow': 'vừa xong',
    'monitor.minutesAgo': '{count} phút trước',
    'monitor.hoursAgo': '{count} giờ trước',
    'monitor.daysAgo': '{count} ngày trước',
    'monitor.notAnswering': 'không phản hồi',
    'monitor.describeOffline': '{reason}, kể từ {when}',
    'monitor.describeOnline': 'đã phản hồi, kiểm tra {when}',
    'monitor.describeOnlineLatency': 'đã phản hồi trong {latency} ms, kiểm tra {when}',
    'monitor.describeUnknown': 'chưa kiểm tra',

    /* ---- App palette editor ---- */
    'appColors.subtitle': 'Sáu bề mặt tạo nên toàn bộ ứng dụng. Chọn màu cửa sổ rồi phần còn lại '
        + 'sẽ theo sau, hoặc tự đặt từng bậc.',
    'appColors.surfaces': 'Bề mặt',
    'appColors.derive': 'Dựng từ một màu',
    'appColors.deriveHint': 'Viết lại cả sáu bậc, vẫn giữ khoảng cách vốn có giữa chúng',
    'appColors.base': 'Cửa sổ',
    'appColors.baseHint': 'Nền của toàn bộ giao diện',
    'appColors.raised': 'Bảng',
    'appColors.raisedHint': 'Thẻ, hộp thoại, thanh bên',
    'appColors.control': 'Điều khiển',
    'appColors.controlHint': 'Nút, ô nhập và viền của chúng',
    'appColors.hover': 'Khi rê chuột',
    'appColors.hoverHint': 'Một điều khiển đang nằm dưới con trỏ',
    'appColors.active': 'Khi nhấn',
    'appColors.activeHint': 'Một điều khiển đang được dùng, và các đường kẻ',
    'appColors.muted': 'Chữ phụ',
    'appColors.mutedHint': 'Nhãn phụ và chữ gợi ý trong ô nhập',

    /* ---- Terminal palette editor ---- */
    'termColors.title': 'Chủ đề terminal tuỳ chỉnh',
    'termColors.subtitle': 'Tự chọn từng màu, hoặc bắt đầu từ một chủ đề có sẵn rồi sửa những gì '
        + 'bạn muốn.',
    'termColors.groupBase': 'Cơ bản',
    'termColors.groupAnsi': 'Màu ANSI',
    'termColors.background': 'Nền',
    'termColors.foreground': 'Chữ',
    'termColors.cursor': 'Con trỏ',
    'termColors.selection': 'Vùng chọn',
    'termColors.black': 'Đen',
    'termColors.red': 'Đỏ',
    'termColors.green': 'Lục',
    'termColors.yellow': 'Vàng',
    'termColors.blue': 'Lam',
    'termColors.magenta': 'Đỏ tươi',
    'termColors.cyan': 'Lục lam',
    'termColors.white': 'Trắng',

    /* ---- OpenSSH import ---- */
    'import.title': 'Từ OpenSSH',
    'import.desc': 'Đọc ~/.ssh/config và ~/.ssh/known_hosts rồi đưa các máy chủ, các cổng chuyển '
        + 'tiếp và các khoá đã tin cậy của chúng vào đây.',
    'import.nothingFound': 'Không tìm thấy gì trong {dir}. Bạn vẫn có thể tự chọn một tệp.',
    'import.scan': 'Quét ~/.ssh',
    'import.scanning': 'Đang quét…',
    'import.scanFailed': 'Không đọc được cấu hình SSH: {reason}',
    'import.chooseConfigTitle': 'Chọn một tệp cấu hình SSH',
    'import.trustedKeys': 'Khoá máy chủ đã tin cậy',
    'import.statusPresent': 'đã thêm rồi',
    'import.statusConflict': 'khác với khoá đã lưu',
    'import.selectedOf': 'Đã chọn {selected} trong {count}',
    'import.keyNote': 'khoá {name}',
    'import.keyNoteState': 'khoá {name} ({state})',
    'import.included': 'thêm {count} tệp được include',
    'import.nothingToImport': 'Không có gì để nhập từ các tệp này.',
    'import.copyKeys': 'Sao chép cả các khoá riêng tư mà những máy chủ này tham chiếu',
    'import.copyKeysDesc': 'Mỗi IdentityFile được đọc vào kho khoá và mã hoá bằng kho khoá của hệ '
        + 'điều hành. Không bật thì các máy chủ nhập vào sẽ dùng SSH agent của bạn.',
    'import.importing': 'Đang nhập…',
    'import.importSelected': 'Nhập {count} mục đã chọn',
    'import.nothingSelected': 'Chưa chọn gì',
    'import.imported': 'Đã nhập {what}',
    'import.nothingNew': 'Không có gì mới để nhập',
    'import.failed': 'Nhập thất bại: {reason}',
    'import.hostKeyCount_other': '{count} khoá máy chủ',
    'import.report': 'Đã nhập {hosts} máy chủ, {keys} khoá, {hostKeys} khoá máy chủ.',
    'import.reportSkipped': '{count} mục đã có sẵn.',
    'import.reportRelayed': '{count} mục được đặt kết nối qua máy trung gian.',
    'import.skipHashed': '{count} mục đã băm',
    'import.skipPatterns': '{count} mục có ký tự đại diện',
    'import.skipMarkers': '{count} mục là chứng chỉ hoặc đã thu hồi',
    'import.skipMalformed': '{count} mục không đọc được',
    'import.skipped': 'đã bỏ qua {what}',

    /* ---- Import from other apps ---- */
    'appImport.title': 'Từ ứng dụng khác',
    'appImport.desc': 'Máy chủ, cổng chuyển tiếp, thư mục và các thiết lập serial hoặc máy tính từ '
        + 'xa đều được chuyển sang. Mật khẩu thì không; mỗi ứng dụng mã hoá chúng theo cách riêng.',
    'appImport.checking': 'Đang kiểm tra…',
    'appImport.notFound': 'Không tìm thấy',
    'appImport.sessionCount_other': '{count} phiên đã lưu',
    'appImport.import': 'Nhập',
    'appImport.chooseFile': 'Chọn một tệp MobaXterm…',
    'appImport.choosePortable': 'Bản portable? Chọn một tệp MobaXterm…',
    'appImport.chooseFileHint': 'Một tệp MobaXterm.ini bản portable, hoặc một bản xuất .mxtsessions',
    'appImport.chooseFileTitle': 'Chọn tệp MobaXterm.ini hoặc .mxtsessions',
    'appImport.fileKind': 'Phiên MobaXterm',
    'appImport.scanFailed': 'Không đọc được các phiên của {source}: {reason}',
    'appImport.sessionsOf': 'Phiên của {app}',
    'appImport.nothingIn': 'Không có gì để nhập trong {app}.',
    'appImport.inFolder': 'trong {folder}',
    'appImport.keyEncrypted': 'có mật khẩu bảo vệ',
    'appImport.keyNeedsConversion': 'cần chuyển đổi',
    'appImport.keyUnreadable': 'không đọc được',
    'appImport.copyKeysDesc': 'Mỗi tệp khoá được đọc vào kho khoá và mã hoá bằng kho khoá của hệ '
        + 'điều hành. Không bật thì các máy chủ nhập vào sẽ dùng SSH agent của bạn.',
    'appImport.report': 'Đã nhập {hosts} máy chủ',

    /* ---- Settings navigation ---- */
    'settings.nav.aria': 'Danh mục cài đặt',
    'settings.nav.general': 'Chung',
    'settings.nav.appearance': 'Giao diện',
    'settings.nav.terminal': 'Terminal',
    'settings.nav.assistant': 'Trợ lý AI',
    'settings.nav.monitoring': 'Theo dõi',
    'settings.nav.logging': 'Ghi nhật ký',
    'settings.nav.security': 'Bảo mật',
    'settings.nav.account': 'Tài khoản',
    'settings.nav.backup': 'Sao lưu',
    'settings.nav.about': 'Giới thiệu',

    /* ---- Settings: General ---- */
    'settings.general.title': 'Chung',
    'settings.general.desc': 'Ứng dụng hoạt động thế nào khi khởi động.',
    'settings.general.language': 'Ngôn ngữ',
    'settings.general.languageDesc': 'Ngôn ngữ hiển thị cho phần chữ của chính ứng dụng. Kết quả '
        + 'từ terminal và mọi thứ máy chủ của bạn in ra đều được giữ nguyên.',
    'settings.general.languageChanged': 'Đã đổi ngôn ngữ sang {language}',
    'settings.general.startup': 'Khởi động cùng máy',
    'settings.general.startupDesc': 'Tự mở CloudTerm khi bạn đăng nhập vào máy tính này',
    'settings.general.startupOn': 'CloudTerm sẽ mở khi bạn đăng nhập',
    'settings.general.startupOff': 'CloudTerm sẽ không còn mở khi bạn đăng nhập',
    'settings.general.startupFailed': 'Không thể thay đổi mục này',
    'settings.general.startupUnknown': 'Không đọc được liệu ứng dụng có khởi động cùng máy hay không',
    'settings.general.restore': 'Khôi phục phiên',
    'settings.general.restoreDesc': 'Mở lại các thẻ đang mở lúc đóng ứng dụng và kết nối lại tới '
        + 'các máy chủ của chúng',

    /* ---- Settings: Appearance ---- */
    'settings.appearance.title': 'Giao diện',
    'settings.appearance.desc': 'Diện mạo của chính ứng dụng.',
    'settings.appearance.theme': 'Chủ đề',
    'settings.appearance.themeDesc': 'Chọn chủ đề giao diện bạn thích',
    'settings.appearance.themeCustomDesc': 'Ứng dụng đang dùng bảng màu riêng của bạn. Chọn một '
        + 'mẫu bên dưới để bắt đầu, hoặc tự đặt từng màu.',
    'settings.appearance.theme.light': 'Sáng',
    'settings.appearance.theme.dark': 'Tối',
    'settings.appearance.theme.system': 'Theo hệ thống',
    'settings.appearance.theme.custom': 'Tuỳ chỉnh',
    'settings.appearance.themeToast.light': 'Chế độ sáng',
    'settings.appearance.themeToast.dark': 'Chế độ tối',
    'settings.appearance.themeToast.system': 'Theo hệ thống',
    'settings.appearance.themeToast.custom': 'Tuỳ chỉnh',
    'settings.appearance.themeChanged': 'Đã đổi chủ đề sang {theme}',
    'settings.appearance.appColors': 'Màu ứng dụng',
    'settings.appearance.appColorsDesc': 'Một bảng màu để bắt đầu. Mọi bề mặt trong ứng dụng đều '
        + 'được dựng từ nó.',
    'settings.appearance.appColorsChanged': 'Đã đổi màu ứng dụng sang {palette}',
    'settings.appearance.yours': 'Của bạn',
    'settings.appearance.customColors': 'Màu tuỳ chỉnh',
    'settings.appearance.customColorsDesc': 'Tự đặt màu cho cửa sổ, bảng, điều khiển và chữ',
    'settings.appearance.editColors': 'Sửa màu',
    'settings.appearance.colorsApplied': 'Đã áp dụng màu ứng dụng',
    'settings.appearance.showLogo': 'Hiện logo',
    'settings.appearance.showLogoDesc': 'Biểu tượng trên thanh tiêu đề. Tắt đi thì chỗ đó dành cho '
        + 'dải thẻ.',
    'settings.appearance.showLogoAria': 'Hiện logo trên thanh tiêu đề',
    'settings.appearance.logoShown': 'Đã hiện logo',
    'settings.appearance.logoHidden': 'Đã ẩn logo',
    'settings.appearance.customLogo': 'Logo tuỳ chỉnh',
    'settings.appearance.customLogoSet': 'Ảnh của riêng bạn, thay cho biểu tượng CloudBlast.',
    'settings.appearance.customLogoDesc': 'Dùng ảnh của riêng bạn thay cho biểu tượng CloudBlast. '
        + 'PNG, JPG, GIF, WebP, SVG, BMP hoặc ICO, tối đa 512 KB.',
    'settings.appearance.choosing': 'Đang chọn…',
    'settings.appearance.chooseImage': 'Chọn ảnh',
    'settings.appearance.logoUnreadable': 'Không đọc được ảnh đó',
    'settings.appearance.logoSet': 'Đã đặt logo thành {name}',
    'settings.appearance.logoCleared': 'Đã quay lại biểu tượng CloudBlast',
    'settings.appearance.position': 'Vị trí',
    'settings.appearance.positionDesc': 'Biểu tượng nằm ở đầu nào của thanh tiêu đề: cạnh nút menu, '
        + 'hay phía các nút cửa sổ.',
    'settings.appearance.positionAria': 'Vị trí logo',
    'settings.appearance.logoMovedLeft': 'Đã chuyển logo sang trái',
    'settings.appearance.logoMovedRight': 'Đã chuyển logo sang phải',

    /* ---- Settings: Terminal ---- */
    'settings.terminal.title': 'Terminal',
    'settings.terminal.desc': 'Shell trông thế nào bên trong một phiên, và những gì được giữ lại.',
    'settings.terminal.font': 'Phông chữ',
    'settings.terminal.fontAria': 'Phông chữ terminal',
    'settings.terminal.fontDesc': 'Chỉ liệt kê những phông máy này thực sự có. JetBrains Mono đi '
        + 'kèm với ứng dụng.',
    'settings.terminal.fontMissing': 'Phông này không còn được cài trên máy, nên terminal đã quay '
        + 'về JetBrains Mono.',
    'settings.terminal.fontBundled': 'đi kèm',
    'settings.terminal.fontNotInstalled': 'chưa cài',
    'settings.terminal.size': 'Cỡ chữ',
    'settings.terminal.sizeAria': 'Cỡ chữ',
    'settings.terminal.sizeDesc': 'Áp dụng cho mọi phiên đang mở. Mỗi phiên sẽ dàn lại và báo kích '
        + 'thước cửa sổ mới cho máy ở xa.',
    'settings.terminal.weight': 'Độ đậm',
    'settings.terminal.weightAria': 'Độ đậm chữ',
    'settings.terminal.weightDesc': 'Chữ đậm vẫn giữ được độ tương phản: nó luôn nặng hơn giá trị '
        + 'đặt ở đây 300 đơn vị.',
    'settings.terminal.lineHeight': 'Chiều cao dòng',
    'settings.terminal.lineHeightAria': 'Chiều cao dòng',
    'settings.terminal.lineHeightDesc': 'Tính theo bội số của cỡ chữ. Dòng cao hơn thì số dòng ít '
        + 'đi, và điều đó được báo cho máy ở xa.',
    'settings.terminal.letterSpacing': 'Giãn chữ',
    'settings.terminal.letterSpacingAria': 'Giãn chữ',
    'settings.terminal.letterSpacingDesc': 'Cộng thêm vào mỗi ô ký tự. Giá trị âm sẽ siết lại một '
        + 'phông quá thưa so với terminal.',
    'settings.terminal.ligatures': 'Chữ ghép',
    'settings.terminal.ligaturesDesc': 'Vẽ các cặp như -> và != thành một ký tự. Việc này tắt kết '
        + 'xuất bằng GPU, vốn không vẽ được chúng, nên một phiên rất bận có thể cuộn kém mượt hơn.',
    'settings.terminal.ligaturesNone': '{font} không có chữ ghép, nên tuỳ chọn này sẽ không thay '
        + 'đổi gì. JetBrains Mono, Cascadia Code và Fira Code thì có.',
    'settings.terminal.thisFont': 'Phông này',
    'settings.terminal.cursor': 'Con trỏ',
    'settings.terminal.cursorAria': 'Kiểu con trỏ',
    'settings.terminal.cursorDesc': 'Con trỏ trông thế nào ở chỗ shell đang chờ.',
    'settings.terminal.cursor.bar': 'Vạch đứng',
    'settings.terminal.cursor.block': 'Khối',
    'settings.terminal.cursor.underline': 'Gạch chân',
    'settings.terminal.blink': 'Nháy con trỏ',
    'settings.terminal.scrollback': 'Bộ đệm cuộn',
    'settings.terminal.scrollbackAria': 'Số dòng trong bộ đệm cuộn',
    'settings.terminal.scrollbackDesc': 'Số dòng giữ lại phía trên đỉnh cửa sổ, cho mỗi phiên. Tìm '
        + 'trong bộ đệm cuộn sẽ tìm hết chỗ đó, và mỗi dòng tốn bộ nhớ của cửa sổ này chứ không '
        + 'phải của máy chủ.',
    'settings.terminal.smoothScroll': 'Cuộn mượt',
    'settings.terminal.smoothScrollAria': 'Thời lượng cuộn mượt',
    'settings.terminal.smoothScrollDesc': 'Thời gian để chuyển động cuộn bằng con lăn chuột hoặc '
        + 'bàn di chuột dừng hẳn. Tắt để cuộn theo thao tác ngay lập tức.',
    'settings.terminal.smoothScrollMs': '{value} ms',
    'settings.terminal.links': 'Mở liên kết',
    'settings.terminal.linksDesc': 'Một URL in ra trong phiên có thể bấm được và sẽ mở trong trình '
        + 'duyệt. Yêu cầu giữ thêm {modifier} là cách các trình soạn thảo vẫn làm: nó ngăn một cú '
        + 'bấm vốn nhắm vào chữ nằm dưới URL bật trình duyệt lên giữa phiên làm việc.',
    'settings.terminal.link.click': 'Bấm',
    'settings.terminal.link.modifier': '{modifier} + bấm',
    'settings.terminal.reset': 'Trở về mặc định',
    'settings.terminal.resetAlready': 'Mọi mục ở trên đều đang ở giá trị mặc định.',
    'settings.terminal.resetDesc': 'Đặt lại phông, khoảng cách, con trỏ, bộ đệm cuộn, độ mượt khi '
        + 'cuộn và cách bấm liên kết. Bảng màu được giữ nguyên.',
    'settings.terminal.resetDone': 'Đã đặt lại kiểu chữ của terminal',
    'settings.terminal.colors': 'Màu terminal',
    'settings.terminal.colorsDesc': 'Chọn một bảng màu cho terminal, hoặc tự dựng riêng',
    'settings.terminal.custom': 'Tuỳ chỉnh',
    'settings.terminal.customTheme': 'Chủ đề tuỳ chỉnh',
    'settings.terminal.customThemeDesc': 'Tự đặt màu nền, chữ, con trỏ và các màu ANSI',
    'settings.terminal.themeChanged': 'Đã đổi chủ đề terminal sang {theme}',
    'settings.terminal.customApplied': 'Đã áp dụng chủ đề terminal tuỳ chỉnh',

    /* ---- Settings: Assistant ---- */
    'settings.assistant.title': 'Trợ lý AI',
    'settings.assistant.desc': 'Trợ lý đọc các terminal của bạn và làm việc trên máy chủ thông qua '
        + 'những kết nối bạn đã mở sẵn. Nó không bao giờ thấy mật khẩu hay khoá đã lưu.',
    'settings.assistant.loading': 'Đang tải cài đặt trợ lý…',
    'settings.assistant.agent': 'Tác nhân',
    'settings.assistant.agentDesc': 'Những tác nhân lập trình nào sẽ trả lời: các bản đã cài trên '
        + 'máy này, hoặc một mô hình do chính bạn chạy. Bật bao nhiêu tuỳ số tài khoản hoặc khoá '
        + 'bạn có. Trình đơn mô hình trong cuộc trò chuyện liệt kê mô hình của tất cả chúng, và '
        + 'chọn một ở đó quyết định tác nhân nào trả lời tiếp theo.',
    'settings.assistant.provider.claudeCode': 'Tác nhân của Anthropic, bằng tài khoản của bạn.',
    'settings.assistant.provider.codex': 'Tác nhân của OpenAI, bằng tài khoản của bạn.',
    'settings.assistant.provider.opencode': 'Mã nguồn mở, với nhà cung cấp bạn cấu hình.',
    'settings.assistant.provider.grok': 'Tác nhân của xAI, bằng tài khoản của bạn.',
    'settings.assistant.provider.kimi': 'Tác nhân của Moonshot, bằng tài khoản của bạn.',
    'settings.assistant.provider.local': 'Mô hình của bạn: LM Studio, Ollama, vLLM.',
    'settings.assistant.provider.unavailable': 'Bản dựng này chưa có.',
    'settings.assistant.provider.keepOne': 'Phải giữ ít nhất một tác nhân được bật.',
    'settings.assistant.provider.checking': 'Đang tìm nó trên máy này…',
    'settings.assistant.provider.notFound': 'Không tìm thấy trên máy này. Hãy cài đặt rồi đánh dấu '
        + 'lại.',
    'settings.assistant.provider.notSignedIn': 'Đã cài nhưng chưa đăng nhập. Hãy đăng nhập trong '
        + 'terminal rồi đánh dấu lại.',
    'settings.assistant.provider.noServer': 'Không có gì phản hồi tại địa chỉ bên dưới. Hãy khởi '
        + 'động máy chủ mô hình rồi đánh dấu lại.',
    'settings.assistant.provider.checkFailed': 'Không hoàn tất được việc kiểm tra. Thử lại.',
    'settings.assistant.endpoint': 'Địa chỉ máy chủ',
    'settings.assistant.endpointDesc': 'Nơi máy chủ mô hình cục bộ đang lắng nghe. Bất kỳ máy chủ '
        + 'nào nói API của OpenAI đều dùng được.',
    'settings.assistant.endpointNote': 'LM Studio: http://localhost:1234/v1. Ollama: '
        + 'http://localhost:11434/v1. llama.cpp: http://localhost:8080/v1.',
    'settings.assistant.endpointChecking': 'Đang hỏi địa chỉ đó xem có những gì...',
    'settings.assistant.endpointFound_other': 'Đã trả lời, có {count} mô hình để chọn.',
    'settings.assistant.endpointNone': 'Không có gì trả lời ở địa chỉ đó. Hãy kiểm tra máy chủ có '
        + 'đang chạy và API của nó đã bật chưa.',
    'settings.assistant.commandMode': 'Lệnh chạy ở đâu',
    'settings.assistant.commandMode.terminal': 'Trong terminal của tôi',
    'settings.assistant.commandMode.background': 'Chạy ngầm',
    'settings.assistant.commandMode.terminal.note': 'Lệnh được gõ vào chính phiên bạn đang xem, nên '
        + 'bạn thấy chúng chạy và kết quả nằm lại trong bộ đệm cuộn. Chúng vào lịch sử của shell '
        + 'đó, và trợ lý đọc kết quả từ màn hình chứ không nhận mã thoát.',
    'settings.assistant.commandMode.background.note': 'Lệnh chạy trên một kênh riêng mà bạn không '
        + 'thấy. Gọn gàng hơn, và trợ lý nhận được mã thoát thật cùng kết quả sạch, nhưng chuyện gì '
        + 'đã xảy ra thì bạn phải tin lời nó.',
    'settings.assistant.approval': 'Hỏi trước khi chạy',
    'settings.assistant.approval.always': 'Mọi thao tác',
    'settings.assistant.approval.writes': 'Chỉ khi thay đổi',
    'settings.assistant.approval.never': 'Không bao giờ',
    'settings.assistant.approval.always.note': 'Mọi lần gọi công cụ đều chờ bạn, kể cả khi chỉ đọc '
        + 'một tệp hay đọc terminal. Rất chắc chắn, nhưng một cuộc điều tra dài sẽ thành rất nhiều '
        + 'lần bấm.',
    'settings.assistant.approval.writes.note': 'Thao tác đọc chạy tự do. Bất cứ thứ gì thay đổi hệ '
        + 'thống đều dừng lại và cho bạn xem đúng lệnh đó cùng máy chủ nó sẽ chạy trên.',
    'settings.assistant.approval.never.note': 'Không có gì dừng lại chờ phê duyệt, kể cả các lệnh '
        + 'xoá dữ liệu hay khởi động lại dịch vụ. Chỉ nên dùng với máy chủ mà bạn chấp nhận được '
        + 'việc nó hỏng.',
    'settings.assistant.localTools': 'Cho phép dùng công cụ trên máy này',
    'settings.assistant.localToolsDesc': 'Cho phép trợ lý đọc ghi tệp cục bộ và chạy lệnh cục bộ. '
        + 'Mặc định tắt: bảng này dùng để quản lý máy chủ, còn máy của chính bạn là một phạm vi '
        + 'rộng hơn thế rất nhiều.',
    'settings.assistant.allowList': 'Các lệnh không bao giờ cần phê duyệt',
    'settings.assistant.allowListDesc': 'Mỗi dòng một lệnh, khớp theo trọn các từ đầu tiên. Một '
        + 'lệnh có ống dẫn, chuyển hướng, dấu chấm phẩy, phép thay thế hoặc dòng thứ hai thì luôn '
        + 'bị hỏi, dù nó bắt đầu bằng gì.',
    'settings.assistant.allowListNote': 'Chỉ có tác dụng khi phê duyệt đang đặt ở “{mode}”.',
    'settings.assistant.blockList': 'Các lệnh không bao giờ được chạy',
    'settings.assistant.blockListDesc': 'Mỗi dòng một lệnh. Chúng bị từ chối thẳng chứ không phải '
        + 'đem ra hỏi, ở mọi chế độ phê duyệt kể cả “Không bao giờ”, dù trợ lý chạy chúng trên kênh '
        + 'riêng hay gõ vào terminal của bạn. Các cờ cũng được tính: “rm -rf” cũng chặn luôn '
        + '“rm -fr”, “rm -r -f” và “sudo /bin/rm --recursive --force”.',
    'settings.assistant.blockListEmpty': 'Để trống ô này thì không chặn gì cả.',
    'settings.assistant.blockListWarning': 'Đây là rào chắn chống nhầm lẫn, không phải một biện '
        + 'pháp bảo mật. Shell có quá nhiều cách viết cùng một lệnh nên không danh sách nào bắt hết '
        + 'được, vì vậy hãy giữ phê duyệt bật cho những việc quan trọng.',
    'settings.assistant.saveList': 'Lưu danh sách',
    'settings.assistant.restoreDefaults': 'Khôi phục mặc định',
    'settings.assistant.quickPrompts': 'Câu hỏi nhanh',
    'settings.assistant.quickPromptsDesc': 'Những câu hỏi bảng trợ lý hiện thành nút bấm một lần '
        + 'khi cuộc trò chuyện còn trống. Mỗi dòng một câu. Ban đầu không có sẵn gì, vì những câu '
        + 'đáng giá là những câu chính bạn hỏi máy của mình mỗi tuần.',
    'settings.assistant.quickPromptsPlaceholder': 'Cái gì đang làm đầy ổ đĩa?\n'
        + 'Vì sao lần triển khai vừa rồi thất bại?',
    'settings.assistant.quickPromptsNote': 'Tối đa 12 câu. Bấm một câu sẽ đưa nó vào ô nhập chứ '
        + 'không gửi ngay, nên bạn có thể bổ sung trước.',
    'settings.assistant.savePrompts': 'Lưu câu hỏi',
    'settings.assistant.steps': 'Số bước mỗi lượt',
    'settings.assistant.stepsDesc': 'Một câu hỏi được phép gọi công cụ bao nhiêu lần trước khi trợ '
        + 'lý dừng lại và báo cáo. Một lượt chạy không đi tới đâu sẽ tự kết thúc, thay vì đợi tới '
        + 'lúc bạn để ý.',
    'settings.assistant.lines': 'Số dòng terminal nó đọc được',
    'settings.assistant.linesDesc': 'Mỗi lần đọc trả về bao nhiêu dòng kết quả gần đây của phiên. '
        + 'Đặt cao hơn thì nó có nhiều ngữ cảnh hơn, và cũng tốn nhiều hạn mức của cuộc trò chuyện hơn.',
    'settings.assistant.tools': 'Nó làm được những gì',
    'settings.assistant.toolsDesc': '{count} công cụ, trong đó {readOnly} công cụ chỉ đọc. Số còn '
        + 'lại chịu ràng buộc của thiết lập phê duyệt ở trên.',

    /* ---- Settings: Monitoring ---- */
    'settings.monitoring.title': 'Theo dõi',
    'settings.monitoring.desc': 'Kiểm tra xem các máy chủ còn liên lạc được không trong lúc ứng '
        + 'dụng đang mở, và nhận thông báo khi một máy ngừng phản hồi. Cần hai công tắc: trang này '
        + 'bật tính năng, còn từng máy chủ bạn muốn theo dõi thì bật trong trình sửa của chính nó.',
    'settings.monitoring.unreadable': 'Không đọc được phần theo dõi từ ứng dụng. Hãy khởi động lại '
        + 'CloudTerm rồi mở lại trang này.',
    'settings.monitoring.saveFailed': 'Không lưu được thiết lập đó',
    'settings.monitoring.checkFailed': 'Không kiểm tra được các máy chủ',
    'settings.monitoring.master': 'Theo dõi máy chủ để phát hiện gián đoạn',
    'settings.monitoring.masterDesc': 'Công tắc chính. Máy chủ được theo dõi từng máy một chứ không '
        + 'phải tất cả cùng lúc, nên riêng công tắc này không kiểm tra gì cả: từng máy chủ bạn muốn '
        + 'theo dõi phải được bật trong trình sửa của nó, ở mục Theo dõi.',
    'settings.monitoring.interval': 'Bao lâu một lần',
    'settings.monitoring.intervalDesc': 'Mỗi máy chủ được theo dõi sẽ được kiểm tra theo khoảng '
        + 'thời gian này. Một lần kiểm tra chỉ là một kết nối được đóng ngay khi vừa mở, nên nó rất '
        + 'nhẹ kể cả khi danh sách máy chủ dài.',
    'settings.monitoring.timeout': 'Chờ bao lâu',
    'settings.monitoring.timeoutDesc': 'Máy chủ không chấp nhận kết nối trong khoảng này coi như '
        + 'trượt lần kiểm tra. Nên tăng lên với máy nằm ở đầu bên kia của VPN.',
    'settings.monitoring.failures': 'Trước khi coi là mất kết nối',
    'settings.monitoring.failuresDesc': 'Cần bao nhiêu lần kiểm tra trượt liên tiếp. Khi dùng wifi, '
        + 'hãy để từ hai lần trở lên: mất một gói tin không có nghĩa là máy chủ sập, và bị báo như '
        + 'thế mỗi phút một lần chính là cách một thông báo mất giá trị.',
    'settings.monitoring.notify': 'Báo cho tôi khi một máy chủ mất kết nối',
    'settings.monitoring.notifyDesc': 'Một thông báo trên màn hình, đúng một lần, khi máy chủ '
        + 'chuyển từ có phản hồi sang không. Tắt đi thì trạng thái vẫn còn trên thẻ máy chủ và ở '
        + 'chuông, chỉ là không làm phiền bạn nữa.',
    'settings.monitoring.notifyBack': 'Và khi nó trở lại',
    'settings.monitoring.notifyBackDesc': 'Một thông báo thứ hai khi máy chủ vốn đang mất kết nối '
        + 'bắt đầu phản hồi trở lại, kèm theo thời gian nó đã vắng mặt.',
    'settings.monitoring.list': 'Đang theo dõi những gì',
    'settings.monitoring.checkNow': 'Kiểm tra ngay',
    'settings.monitoring.checking': 'Đang kiểm tra…',
    'settings.monitoring.noneWatched': 'Việc theo dõi được bật cho từng máy chủ, trong trình sửa '
        + 'máy chủ.',
    'settings.monitoring.watched_other': '{count} máy chủ.',
    'settings.monitoring.watchedButOff_other': 'Đã thiết lập {count} máy chủ, nhưng không có gì '
        + 'kiểm tra chúng khi công tắc ở trên đang tắt.',
    'settings.monitoring.watchedWithOffline_other': '{count} máy chủ, {offline} máy không phản hồi.',
    'settings.monitoring.emptyList': 'Chưa có máy chủ nào đang được theo dõi.',
    'settings.monitoring.emptyListHow': 'Mở một máy chủ từ trang Máy chủ, tìm mục Theo dõi trong '
        + 'phần Tuỳ chọn, rồi bật “Theo dõi máy chủ này”.',
    'settings.monitoring.noNetwork': 'Máy này không có kết nối mạng, nên không có gì được kiểm tra '
        + 'và cũng không có máy chủ nào bị báo là mất kết nối.',
    'settings.monitoring.allFailed': 'Mọi máy chủ đều trượt lần kiểm tra vừa rồi cùng một lúc, và '
        + 'điều đó thường là do chính máy này chứ không phải tất cả chúng. Những kết quả đó đã bị '
        + 'bỏ đi và không có gì được báo cáo.',
    'settings.monitoring.lastChecked': 'Kiểm tra lần cuối {when}.',

    /* ---- Settings: Logging ---- */
    'settings.logging.title': 'Ghi nhật ký',
    'settings.logging.desc': 'Ghi những gì mỗi phiên hiển thị ra một tệp, và quyết định phiên nào '
        + 'được ghi cùng thời gian giữ tệp.',
    'settings.logging.saveFailed': 'Không lưu được thiết lập đó',
    'settings.logging.folderFailed': 'Không dùng được thư mục đó',
    'settings.logging.folderChanged': 'Từ giờ nhật ký phiên sẽ được lưu ở đó',
    'settings.logging.openFailed': 'Không mở được thư mục đó',
    'settings.logging.revealFailed': 'Không tìm thấy nhật ký đó',
    'settings.logging.recordAll': 'Ghi mọi phiên',
    'settings.logging.recordAllDesc': 'Ghi những gì máy chủ in ra vào một tệp, cho mọi phiên ngay '
        + 'khi nó mở. Một phiên đơn lẻ luôn có thể được ghi riêng từ thanh tiêu đề của nó mà không '
        + 'cần bật mục này.',
    'settings.logging.whichSessions': 'Những phiên nào',
    'settings.logging.whichSessionsDesc': 'Công tắc ở trên ghi những loại phiên nào. Việc ghi một '
        + 'phiên từ thanh tiêu đề của chính nó thì bỏ qua danh sách này.',
    'settings.logging.format': 'Ghi cái gì',
    'settings.logging.formatDesc': '“Dễ đọc” loại bỏ các mã màu và mã con trỏ, đó là thứ khiến một '
        + 'tệp nhật ký grep được. “Nguyên bản” giữ từng byte, để sau này phát lại qua terminal.',
    'settings.logging.formatPlain': 'Dễ đọc',
    'settings.logging.formatRaw': 'Nguyên bản',
    'settings.logging.timestamps': 'Đóng dấu thời gian cho từng dòng',
    'settings.logging.timestampsDesc': 'Thêm thời gian cục bộ lúc dòng đó đến vào đầu mỗi dòng.',
    'settings.logging.timestampsUnavailable': 'Không dùng được với nhật ký nguyên bản: một dấu thời '
        + 'gian nằm giữa chuỗi escape sẽ làm hỏng nó.',
    'settings.logging.retention': 'Giữ trong bao lâu',
    'settings.logging.retentionDesc': 'Các bản ghi cũ hơn sẽ bị xoá, khi khởi động và khi các phiên '
        + 'mở ra. Bản đang được ghi thì không bao giờ bị đụng tới, dù nó cũ đến đâu.',
    'settings.logging.forever': 'Mãi mãi',
    'settings.logging.days_other': '{count} ngày',
    'settings.logging.cap': 'Giới hạn dung lượng thư mục',
    'settings.logging.capDesc': 'Khi thư mục vượt quá mức này, các bản ghi cũ nhất sẽ bị xoá trước '
        + 'cho tới khi vừa trở lại.',
    'settings.logging.noCap': 'Không giới hạn',
    'settings.logging.folder': 'Lưu ở đâu',
    'settings.logging.folderDesc': 'Nhật ký chứa mọi thứ đã hiện trên màn hình; với một phiên có '
        + 'chạy trình quản lý mật khẩu hay in ra token thì nó nhạy cảm không kém chính các thông '
        + 'tin đăng nhập. Hãy để chúng ở nơi bạn vẫn cất những thứ đó.',
    'settings.logging.openFolder': 'Mở thư mục',
    'settings.logging.defaultFolder': 'Trở lại thư mục mặc định',
    'settings.logging.showInFolder': 'Hiện trong thư mục',

    /* ---- Settings: Security ---- */
    'settings.security.title': 'Bảo mật',
    'settings.security.desc': 'Ai được mở ứng dụng này, và nó tin cậy những máy chủ nào.',

    'settings.lock.title': 'Mật khẩu mở ứng dụng',
    'settings.lock.badgeOn': 'bật',
    'settings.lock.descOn': 'Được hỏi mỗi lần ứng dụng mở ra. Mật khẩu, khoá và cụm mật khẩu bạn đã '
        + 'lưu đều được mã hoá bằng nó, nên tệp lưu trữ không đọc được nếu thiếu nó.',
    'settings.lock.descOff': 'Yêu cầu mật khẩu để mở ứng dụng, và dùng nó mã hoá các mật khẩu, khoá '
        + 'và cụm mật khẩu bạn đã lưu.',
    'settings.lock.warnOn': 'Không có cách nào khôi phục. Nếu bạn quên mật khẩu này thì các thông '
        + 'tin đăng nhập đã lưu không đọc lại được nữa.',
    'settings.lock.warnOff': 'Không có nó, thông tin đăng nhập chỉ được kho khoá của hệ điều hành '
        + 'bảo vệ, nghĩa là bất kỳ ai đăng nhập với danh nghĩa bạn đều đọc được.',
    'settings.lock.lockNow': 'Khoá ngay',
    'settings.lock.setPassword': 'Đặt mật khẩu',
    'settings.lock.changePassword': 'Đổi mật khẩu',
    'settings.lock.removePassword': 'Gỡ mật khẩu',
    'settings.lock.currentPassword': 'Mật khẩu hiện tại',
    'settings.lock.password': 'Mật khẩu',
    'settings.lock.newPassword': 'Mật khẩu mới',
    'settings.lock.confirmPassword': 'Xác nhận mật khẩu',
    'settings.lock.mismatch': 'Hai mật khẩu không khớp nhau',
    'settings.lock.failed': 'Thao tác không thành công',
    'settings.lock.passwordSet': 'Đã đặt mật khẩu mở ứng dụng',
    'settings.lock.passwordChanged': 'Đã đổi mật khẩu',
    'settings.lock.passwordRemoved': 'Đã gỡ mật khẩu mở ứng dụng',
    'settings.lock.acknowledge': 'Tôi hiểu rằng mật khẩu này không thể khôi phục',
    'settings.lock.acknowledgeDesc': 'Mật khẩu, khoá và cụm mật khẩu bạn đã lưu đều được mã hoá '
        + 'bằng nó. Quên nó thì không gì đọc lại được chúng, kể cả ứng dụng này.',
    'settings.lock.confirmTitle': 'Khoá ứng dụng ngay bây giờ?',
    'settings.lock.confirmMessage': 'Mọi phiên đang mở sẽ bị ngắt kết nối, và bạn sẽ cần mật khẩu '
        + 'để vào lại.',
    'settings.lock.confirmAction': 'Khoá',

    'settings.knownHosts.title': 'Máy chủ đã biết',
    'settings.knownHosts.desc': 'Các khoá máy chủ bạn đã tin cậy. Quên một khoá để được hỏi lại về '
        + 'nó, điều bạn cần khi một máy chủ thực sự được dựng lại.',
    'settings.knownHosts.unknownType': 'không rõ',
    'settings.knownHosts.copy': 'Sao chép vân tay',
    'settings.knownHosts.copied': 'Đã sao chép vân tay',
    'settings.knownHosts.forget': 'Quên',
    'settings.knownHosts.forgetKey': 'Quên khoá này',
    'settings.knownHosts.keyCount_other': '{count} khoá',
    'settings.knownHosts.empty': 'Chưa tin cậy khoá máy chủ nào',
    'settings.knownHosts.emptyNote': 'Lần đầu bạn kết nối tới một máy chủ, khoá của nó sẽ được ghi '
        + 'lại ở đây.',
    'settings.knownHosts.confirmTitle': 'Quên khoá máy chủ này?',
    'settings.knownHosts.confirmMessage': 'Lần kết nối tới, {host} sẽ được coi là một máy chủ mới, '
        + 'và bạn sẽ được hỏi để xác nhận lại khoá của nó.',
    'settings.knownHosts.forgotHost': 'Đã quên {host}',
    'settings.knownHosts.forgotKey': 'Đã quên khoá {type} của {host}',

    /* ---- Settings: Account ---- */
    'settings.account.title': 'Tài khoản',
    'settings.account.fallbackName': 'Tài khoản CloudBlast',
    'settings.account.yourAccount': 'tài khoản CloudBlast của bạn',
    'settings.account.connectedAs': 'Đã kết nối với tư cách {account}',
    'settings.account.disconnect': 'Ngắt kết nối',
    'settings.account.disconnecting': 'Đang ngắt kết nối…',
    'settings.account.disconnected': 'Đã ngắt kết nối tài khoản',
    'settings.account.disconnectedLocally': 'Đã đăng xuất trên thiết bị này, nhưng không liên lạc '
        + 'được với bảng điều khiển để thu hồi quyền truy cập. Hãy gỡ thiết bị trong Cài đặt → API.',
    'settings.account.connect': 'Kết nối tài khoản của bạn',
    'settings.account.connectAction': 'Kết nối',
    'settings.account.connectDesc': 'Đồng bộ máy chủ và sao lưu thiết lập của bạn.',
    'settings.account.unlockFirst': 'Hãy mở khoá ứng dụng trước.',
    'settings.account.waitingForBrowser': 'Đang chờ trình duyệt…',
    'settings.account.syncServers': 'Đồng bộ máy chủ của tôi',
    'settings.account.syncServersDesc': 'Các máy chủ CloudBlast của bạn sẽ xuất hiện trong Máy chủ, '
        + 'sẵn sàng để kết nối.',
    'settings.account.syncOn': 'Đang đồng bộ các máy chủ CloudBlast của bạn vào Máy chủ',
    'settings.account.syncOff': 'Đã tắt đồng bộ. Các máy chủ đã thêm vẫn ở nguyên chỗ cũ.',
    'settings.account.syncNow': 'Đồng bộ ngay',
    'settings.account.syncing': 'Đang đồng bộ…',
    'settings.account.syncedAgo': 'Đồng bộ {when}',
    'settings.account.notSyncedYet': 'Chưa đồng bộ',
    'settings.account.serverCount_other': '{count} máy chủ',
    'settings.account.serversSynced_other': 'Đã đồng bộ {count} máy chủ',
    'settings.account.noServers': 'Tài khoản này chưa có máy chủ nào',
    'settings.account.cloudBackup': 'Sao lưu đám mây',
    'settings.account.cloudBackupDesc': 'Máy chủ, thư mục, khoá và cài đặt của bạn, được lưu vào '
        + 'tài khoản để dùng trên các thiết bị khác.',
    'settings.account.backupOn': 'Sao lưu đám mây đang bật',
    'settings.account.backupOff': 'Sao lưu đám mây đang tắt. Những gì đã lưu vẫn còn cho tới khi '
        + 'bạn thay thế nó.',
    'settings.account.backedUp': 'Đã sao lưu vào tài khoản CloudBlast của bạn',
    'settings.account.saveNow': 'Lưu ngay',
    'settings.account.saving': 'Đang lưu…',
    'settings.account.savedAgo': 'Đã lưu {when}',
    'settings.account.notSavedYet': 'Chưa lưu',
    'settings.account.justNow': 'vừa xong',
    'settings.account.minutesAgo': '{count} phút trước',
    'settings.account.hoursAgo': '{count} giờ trước',
    'settings.account.daysAgo': '{count} ngày trước',

    /* ---- Settings: Backup ---- */
    'settings.backup.title': 'Sao lưu',
    'settings.backup.desc': 'Đưa một thiết lập sẵn có vào, hoặc lấy một bản sao ra.',
    'settings.backup.exportTitle': 'Xuất một bản sao lưu',
    'settings.backup.exportDesc': 'Ghi mọi máy chủ, thư mục, khoá SSH, đoạn lệnh, cổng chuyển tiếp '
        + 'và khoá máy chủ đã tin cậy vào một tệp mã hoá duy nhất, được bảo vệ bằng cụm mật khẩu '
        + 'bạn chọn ở đây.',
    'settings.backup.exportNote': 'Cụm mật khẩu này độc lập với mật khẩu mở ứng dụng, nên tệp vẫn '
        + 'mở được trên một máy chưa từng thấy máy này.',
    'settings.backup.create': 'Tạo bản sao lưu',
    'settings.backup.passphrase': 'Cụm mật khẩu sao lưu',
    'settings.backup.confirmPassphrase': 'Xác nhận cụm mật khẩu',
    'settings.backup.tooShort': 'Dùng ít nhất {count} ký tự',
    'settings.backup.mismatch': 'Hai cụm mật khẩu không khớp nhau',
    'settings.backup.acknowledge': 'Tôi hiểu tệp này chứa các thông tin đăng nhập đã lưu của tôi',
    'settings.backup.acknowledgeDesc': 'Bất kỳ ai có cả tệp lẫn cụm mật khẩu này đều đọc được mọi '
        + 'mật khẩu, khoá riêng tư và cụm mật khẩu lưu trong đó. Hãy để nó ở nơi bạn vẫn cất chính '
        + 'các thông tin đăng nhập.',
    'settings.backup.chooseLocation': 'Chọn nơi lưu…',
    'settings.backup.exportFailed': 'Không ghi được bản sao lưu',
    'settings.backup.exported': 'Đã lưu bản sao lưu: {hosts}, {keys}, {snippets}',
    'settings.backup.restoreTitle': 'Khôi phục một bản sao lưu',
    'settings.backup.restoreDesc': 'Đọc một tệp .cbbackup và thêm những gì nó chứa. Bạn được xem '
        + 'trong đó có gì trước khi bất cứ thứ gì thay đổi.',
    'settings.backup.restoreNote': 'Mặc định, những gì đã có ở đây được để nguyên, nên khôi phục '
        + 'hai lần vẫn an toàn.',
    'settings.backup.chooseFile': 'Chọn tệp…',
    'settings.backup.openTitle': 'Mở bản sao lưu đã mã hoá',
    'settings.backup.fileKind': 'Bản sao lưu CloudBlast',
    'settings.backup.pickerFailed': 'Không mở được hộp thoại chọn tệp',
    'settings.backup.file': 'Tệp',
    'settings.backup.open': 'Mở bản sao lưu',
    'settings.backup.opening': 'Đang mở…',
    'settings.backup.openFailed': 'Không mở được bản sao lưu đó',
    'settings.backup.from': 'Bản sao lưu ngày {when}',
    'settings.backup.unknownDate': 'một ngày không rõ',
    'settings.backup.appVersion': 'ứng dụng {version}',
    'settings.backup.emptyFile': 'Bản sao lưu này trống.',
    'settings.backup.folders': 'Thư mục',
    'settings.backup.keys': 'Khoá SSH',
    'settings.backup.newCount': '{count} mục mới',
    'settings.backup.existingReplaced': '{count} mục đã có ở đây, sẽ bị thay thế',
    'settings.backup.existingSkipped': '{count} mục đã có ở đây, sẽ bị bỏ qua',
    'settings.backup.trustedKeys': 'Khoá đã tin cậy',
    'settings.backup.hostWord_other': 'máy chủ',
    'settings.backup.overwrite': 'Thay thế những mục đã có ở đây',
    'settings.backup.overwriteDesc': 'Đối chiếu theo id của bản ghi chứ không theo tên. Để tắt thì '
        + 'chỉ thêm những gì còn thiếu; bật lên thì làm cho máy này khớp với bản sao lưu, và bỏ đi '
        + 'các sửa đổi cục bộ trên những bản ghi đó.',
    'settings.backup.overwriteWarning': 'Các thay đổi cục bộ trên những bản ghi tương ứng sẽ mất.',
    'settings.backup.restore': 'Khôi phục',
    'settings.backup.restoring': 'Đang khôi phục…',
    'settings.backup.restoreFailed': 'Việc khôi phục chưa hoàn tất',
    'settings.backup.restored_other': 'Đã khôi phục {count} mục mới',
    'settings.backup.restoredAndReplaced_other': 'Đã khôi phục {count} mục mới, thay thế {replaced} mục',
    'settings.backup.duplicateKeys_other': 'Hiện có {count} máy chủ tin cậy nhiều hơn một khoá cùng '
        + 'loại. Hãy xem Bảo mật, rồi tới Máy chủ đã biết.',

    /* ---- Settings: About ---- */
    'settings.about.title': 'Giới thiệu',
    'settings.about.version': 'Phiên bản {version}',
    'settings.about.updates': 'Cập nhật',
    'settings.about.checking': 'Đang kiểm tra bản cập nhật…',
    'settings.about.checkingShort': 'Đang kiểm tra…',
    'settings.about.checkNow': 'Kiểm tra cập nhật',
    'settings.about.disabled': 'Bản cài này đã tắt việc kiểm tra cập nhật.',
    'settings.about.ready': 'Phiên bản {version} đã sẵn sàng để cài. Khởi động lại để hoàn tất.',
    'settings.about.downloading': 'Đang tải bản cập nhật…',
    'settings.about.downloadingVersion': 'Đang tải phiên bản {version}…',
    'settings.about.available': 'Đã có phiên bản {version}.',
    'settings.about.availableToDownload': 'Đã có phiên bản {version} để tải về.',
    'settings.about.upToDate': 'Đã là bản mới nhất. Kiểm tra lần cuối {when}.',
    'settings.about.neverChecked': 'Chưa kiểm tra.',
    'settings.about.restartToUpdate': 'Khởi động lại để cập nhật',
    'settings.about.download': 'Tải {version}',
    'settings.about.noChecksLeft': 'Đã hết lượt kiểm tra trong giờ này.',
    'settings.about.noChecksUntil': 'Đã hết lượt kiểm tra trong giờ này, cho tới {when}.',
    'settings.about.checksLeft_other': 'Còn {count} trong {limit} lượt kiểm tra trong giờ này.',
    'settings.about.noteInstall': 'Bản cập nhật được tải ngầm và cài khi bạn thoát ứng dụng. Việc '
        + 'kiểm tra chỉ hỏi GitHub về bản phát hành mới nhất và không gửi bất cứ thông tin nào về '
        + 'bạn hay máy của bạn.',
    'settings.about.noteNotify': 'Bản cập nhật không được cài tự động. Phần tải về sẽ mở trong '
        + 'trình duyệt của bạn, nơi hệ thống có thể kiểm tra nó. Việc kiểm tra chỉ hỏi GitHub về '
        + 'bản phát hành mới nhất và không gửi bất cứ thông tin nào về bạn hay máy của bạn.',

    /* ---- More shared words ---- */
    'common.add': 'Thêm',
    'common.copy': 'Sao chép',
    'common.delete': 'Xoá',
    'common.deleteNamed': 'Xoá {name}',
    'common.edit': 'Sửa',
    'common.rename': 'Đổi tên',

    /* ---- Hosts ---- */
    'hosts.rootLabel': 'Tất cả máy chủ',
    'hosts.unnamed': 'Máy chủ chưa đặt tên',
    'hosts.noPort': 'Không có cổng',
    'hosts.connected': 'Đã kết nối',
    'hosts.viaProxy': 'qua proxy',
    'hosts.tunnelCount_other': '{count} đường hầm',
    'hosts.itemCount_other': '{count} mục',
    'hosts.selectedCount': 'Đã chọn {count}',
    'hosts.folderEmpty': 'Trống',
    'hosts.folderActions': 'Thao tác với thư mục',
    'hosts.syncedBadge': 'Đã đồng bộ',
    'hosts.syncedAccount': 'Được đồng bộ từ tài khoản CloudBlast của bạn',
    'hosts.syncedProject': 'Một dự án trên tài khoản CloudBlast của bạn. Việc đồng bộ giữ nguyên '
        + 'tên và vị trí của nó',
    'hosts.upOneLevel': 'Lên một cấp',
    'hosts.dragHint': 'Kéo một thẻ vào thư mục để xếp nó vào đó · Kéo một khung để chọn nhiều thẻ',
    'hosts.dragHintFiltered': 'Kéo một khung ngang qua các thẻ để chọn nhiều thẻ',

    'hosts.open': 'Mở',
    'hosts.editHost': 'Sửa máy chủ',
    'hosts.connectVia': 'Kết nối qua {protocol}',
    'hosts.openIpmi': 'Mở IPMI',
    'hosts.notSetUp': 'chưa thiết lập',
    'hosts.moveToFolder': 'Chuyển vào thư mục…',
    'hosts.keepsContents': 'giữ lại nội dung bên trong',
    'hosts.move': 'Chuyển',
    'hosts.tag': 'Gắn thẻ',
    'hosts.tags': 'Thẻ…',
    'hosts.moveMany': 'Chuyển {what}…',
    'hosts.groupIntoFolder': 'Gộp vào một thư mục…',
    'hosts.clearSelection': 'Bỏ chọn',

    'hosts.deleteHostTitle': 'Xoá máy chủ này?',
    'hosts.deleteHostMessage': '“{name}” và các thông tin đăng nhập đã lưu của nó sẽ bị xoá. Phiên '
        + 'nào đang mở thì vẫn giữ kết nối.',
    'hosts.deleteHost': 'Xoá máy chủ',
    'hosts.deleteFolderTitle': 'Xoá thư mục này?',
    'hosts.deleteFolderMessage': '“{name}” sẽ bị xoá. Mọi thứ bên trong sẽ chuyển lên một cấp chứ '
        + 'không bị xoá theo.',
    'hosts.deleteFolder': 'Xoá thư mục',
    'hosts.deleted': 'Đã xoá “{name}”',
    'hosts.deleteManyTitle': 'Xoá {what}?',
    'hosts.deleteMany': 'Xoá {what}',
    'hosts.deletedMany': 'Đã xoá {what}',
    'hosts.deleteManyHostsNote': 'Các máy chủ bị xoá cùng với thông tin đăng nhập đã lưu, và phiên '
        + 'nào đang mở thì vẫn giữ kết nối.',
    'hosts.deleteManyFoldersNote': 'Các thư mục bị xoá, nhưng mọi thứ bên trong chuyển lên một cấp '
        + 'chứ không bị xoá theo.',
    'hosts.deleteFailed': 'Không xoá được: {reason}',

    'hosts.moved': 'Đã chuyển {what}',
    'hosts.movedSome': 'Đã chuyển {count} trong {of}; phần còn lại không vào được đó',
    'hosts.movedTo': 'Đã chuyển {what} sang {where}',
    'hosts.movedSomeTo': 'Đã chuyển {count} trong {of} sang {where}',
    'hosts.movedInto': 'Đã chuyển {what} vào “{name}”',
    'hosts.nothingToMove': 'Không có gì để chuyển: tất cả đã ở đó rồi',
    'hosts.folderInsideItself': 'Không thể chuyển một thư mục vào chính nó.',
    'hosts.moveTitle': 'Chuyển {count} mục',
    'hosts.moveSubtitle': 'Chọn thư mục mà chúng sẽ vào.',
    'hosts.findFolder': 'Tìm một thư mục…',
    'hosts.noFolderMatches': 'Không có thư mục nào khớp với “{query}”.',
    'hosts.alreadyHere': 'đã ở đây',
    'hosts.insideSelection': 'nằm trong phần đã chọn',

    'hosts.editFolder': 'Sửa thư mục',
    'hosts.saveFolder': 'Lưu thư mục',
    'hosts.createFolder': 'Tạo thư mục',
    'hosts.creating': 'Đang tạo…',
    'hosts.folderName': 'Tên thư mục',
    'hosts.folderNamePlaceholder': 'ví dụ: Máy chủ AWS',
    'hosts.folderSubtitle': 'Thư mục dùng để nhóm các máy chủ. Xoá thư mục vẫn giữ lại những gì '
        + 'nằm trong đó.',
    'hosts.folderCreateFailed': 'Không tạo được thư mục đó',
    'hosts.folderCreateFailedWhy': 'Không tạo được thư mục đó: {reason}',
    'hosts.groupTitle': 'Thư mục mới từ phần đã chọn',
    'hosts.groupSubtitle': '{what} sẽ được chuyển vào đó, bên trong {parent}.',

    'hosts.sort': 'Sắp xếp',
    'hosts.sortLabel': 'Sắp xếp: {sort}',
    'hosts.sortNameAsc': 'Tên A-Z',
    'hosts.sortNameDesc': 'Tên Z-A',
    'hosts.sortRecent': 'Dùng gần đây',
    'hosts.sortManual': 'Thủ công',
    'hosts.filterByTag': 'Lọc theo thẻ',
    'hosts.filteredByTags_other': 'đang lọc theo {count} thẻ',
    'hosts.filterBy': 'Lọc theo “{tag}”',
    'hosts.stopFilteringBy': 'Ngừng lọc theo “{tag}”',
    'hosts.searchTags': 'Tìm thẻ',
    'hosts.searchTagsPlaceholder': 'Tìm trong {count} thẻ…',
    'hosts.noTagMatches': 'Không có thẻ nào khớp với “{query}”',
    'hosts.tagMode.all': 'tất cả',
    'hosts.tagMode.any': 'bất kỳ',
    'hosts.tagModeAllHint': 'Máy chủ mang tất cả các thẻ đã chọn',
    'hosts.tagModeAnyHint': 'Máy chủ mang ít nhất một thẻ đã chọn',

    'hosts.tagTitle': 'Gắn thẻ cho máy chủ',
    'hosts.tagSubtitle': 'Đã chọn {what}. Các thẻ đánh dấu một phần chỉ có trên một số máy, và giữ '
        + 'nguyên như vậy trừ khi bạn chạm vào chúng.',
    'hosts.applying': 'Đang áp dụng…',
    'hosts.newTag': 'Thẻ mới',
    'hosts.newTagPlaceholder': 'Thẻ mới…',
    'hosts.noTagsYet': 'Chưa có thẻ nào. Gõ một thẻ ở trên để bắt đầu.',
    'hosts.tagWillAdd': 'sẽ được thêm',
    'hosts.tagWillRemove': 'sẽ bị gỡ',
    'hosts.tagOnAll': 'trên tất cả',
    'hosts.tagOnSome': 'trên {on} trong {total}',

    /* ---- Protocols ---- */
    'protocol.serial': 'Serial',
    'protocol.desktop': 'Máy tính từ xa',
    'protocol.ssh.summary': 'Shell được mã hoá, và mọi thứ dựng trên nó',
    'protocol.ssh.detail': 'Tệp, chuyển tiếp cổng và máy tính từ xa đều là các kênh trên một kết '
        + 'nối SSH, nên chúng chỉ được cung cấp ở đây.',
    'protocol.telnet.summary': 'Một socket thuần tới thiết bị không có SSH',
    'protocol.telnet.detail': 'Gửi mọi thứ, kể cả mật khẩu, ở dạng rõ. Dành cho máy chủ console, '
        + 'một PDU hoặc một switch chưa từng có SSH.',
    'protocol.serial.summary': 'Một cáp console trên máy này',
    'protocol.serial.detail': 'Hoàn toàn không qua mạng. Các thiết lập phải khớp chính xác với '
        + 'thiết bị: sai tốc độ baud thì chỉ ra ký tự rác chứ không báo lỗi.',
    'protocol.desktop.summary': 'RDP hoặc VNC, không có shell phía sau',
    'protocol.desktop.detail': 'Mở thẳng vào màn hình từ xa và không bao giờ gọi SSH. Dành cho máy '
        + 'Windows, vốn thường không có máy chủ SSH.',
    'protocol.ipmi.summary': 'Một bộ xử lý dịch vụ, và không có gì phía sau',
    'protocol.ipmi.detail': 'Mở thẳng vào giao diện web của chính BMC và không bao giờ gọi tới máy. '
        + 'Dành cho một bo iDRAC, iLO hay Supermicro đứng trước một máy mà ứng dụng này không có '
        + 'phiên nào.',

    /* ---- Serial ---- */
    'serial.port': 'Cổng serial',
    'serial.selectPort': 'Chọn một cổng…',
    'serial.rescan': 'Quét lại các cổng',
    'serial.noPorts': 'Không tìm thấy cổng serial nào. Cắm bộ chuyển đổi vào rồi quét lại.',
    'serial.portMissing': '{path} hiện không được kết nối. Nó vẫn được giữ trên máy chủ và sẽ hoạt '
        + 'động trở lại khi cắm cáp vào.',
    'serial.baudRate': 'Tốc độ baud',
    'serial.dataBits': 'Bit dữ liệu',
    'serial.stopBits': 'Bit dừng',
    'serial.parity': 'Chẵn lẻ',
    'serial.parityNone': 'Không',
    'serial.parityEven': 'Chẵn',
    'serial.parityOdd': 'Lẻ',
    'serial.parityMark': 'Mark',
    'serial.paritySpace': 'Space',
    'serial.flowControl': 'Điều khiển luồng',
    'serial.flowNone': 'Không',
    'serial.flowHardware': 'Phần cứng (RTS/CTS)',
    'serial.flowSoftware': 'Phần mềm (XON/XOFF)',
    'serial.enterSends': 'Phím Enter gửi',
    'serial.enterSendsHint': 'Không giao thức nào trả lời được câu này. Thiết bị nhận sai giá trị '
        + 'trông như đã chết: dấu nhắc đơn giản là không quay lại.',
    'serial.newlineCrHint': 'Thiết bị mạng, phần lớn console',
    'serial.newlineLfHint': 'Một getty của Linux',
    'serial.newlineCrLfHint': 'Một số bộ giám sát nhúng',
    'serial.localEcho': 'Hiện lại những gì tôi gõ',
    'serial.localEchoHint': 'Bật cho thiết bị không tự hiện lại. Không có nó thì khung vẫn trống '
        + 'khi bạn gõ, và điều đó trông như một cổng chết chứ không phải một cổng im lặng.',
    'serial.dtr': 'Bật DTR khi mở',
    'serial.dtrHint': 'Mặc định bật, đúng như phần lớn thiết bị mong đợi. Hãy tắt với bo mạch được '
        + 'nối để reset theo DTR, nếu không nó sẽ khởi động lại mỗi lần cổng này được mở.',
    'serial.rts': 'Bật RTS khi mở',
    'serial.rtsHint': 'Mặc định bật. Một số bộ chuyển đổi nối RTS vào chân reset hoặc boot.',
    'serial.rtsIgnored': 'Bị bỏ qua khi điều khiển luồng phần cứng đang bật: khi đó RTS thuộc về '
        + 'trình điều khiển.',
    'serial.noWindowSize': 'Đường serial không mang kích thước cửa sổ hay loại terminal, nên thiết '
        + 'bị luôn coi là 80×24 dù khung có lớn đến đâu.',

    /* ---- Port forwarding ---- */
    'tunnel.heading': 'Chuyển tiếp cổng',
    'tunnel.headingNote': 'Đường hầm chạy trên kết nối của phiên này và dừng khi phiên đóng.',
    'tunnel.local': 'Cục bộ',
    'tunnel.remote': 'Từ xa',
    'tunnel.dynamic': 'Động',
    'tunnel.local.summary': 'Tiếp cận một dịch vụ ở xa từ máy này',
    'tunnel.local.detail': 'Mở một cổng ở đây. Mọi thứ kết nối tới nó sẽ đi ra ở máy chủ, rồi máy '
        + 'chủ gọi tới đích.',
    'tunnel.remote.summary': 'Đưa một dịch vụ cục bộ ra máy chủ',
    'tunnel.remote.detail': 'Mở một cổng trên máy chủ. Các kết nối nó nhận sẽ được gọi từ máy này.',
    'tunnel.dynamic.summary': 'Một proxy SOCKS5 qua máy chủ',
    'tunnel.dynamic.detail': 'Mở một proxy SOCKS5 ở đây. Mỗi kết nối tự nêu đích của mình, và máy '
        + 'chủ sẽ gọi tới đó.',
    'tunnel.newTitle': 'Chuyển tiếp cổng mới',
    'tunnel.editTitle': 'Sửa chuyển tiếp cổng',
    'tunnel.add': 'Thêm chuyển tiếp',
    'tunnel.added': 'Đã thêm chuyển tiếp',
    'tunnel.updated': 'Đã cập nhật chuyển tiếp',
    'tunnel.removed': 'Đã gỡ chuyển tiếp',
    'tunnel.removeTitle': 'Gỡ chuyển tiếp cổng này?',
    'tunnel.removeMessage': '{tunnel} sẽ bị dừng và gỡ khỏi {host}.',
    'tunnel.label': 'Nhãn',
    'tunnel.labelHint': 'Tuỳ chọn, hiển thị thay cho các địa chỉ',
    'tunnel.labelPlaceholder': 'ví dụ: Cơ sở dữ liệu sản xuất',
    'tunnel.listenAddress': 'Địa chỉ lắng nghe',
    'tunnel.listenPort': 'Cổng lắng nghe',
    'tunnel.bindAddress': 'Địa chỉ gắn trên máy chủ',
    'tunnel.bindAddressHint': 'Cần “GatewayPorts yes” cho mọi thứ ngoài loopback',
    'tunnel.remotePort': 'Cổng từ xa',
    'tunnel.autoPort': '0 = tự động',
    'tunnel.destHost': 'Máy chủ đích',
    'tunnel.destHostLocalHint': 'Được phân giải từ máy này',
    'tunnel.destHostRemoteHint': 'Được phân giải từ máy chủ, nên các tên nội bộ của nó vẫn dùng được',
    'tunnel.destPort': 'Cổng đích',
    'tunnel.autoStart': 'Khởi động cùng kết nối',
    'tunnel.autoStartHint': 'Được bật lên mỗi khi máy chủ này kết nối, kể cả sau khi kết nối lại.',
    'tunnel.autoBadge': 'tự động',
    'tunnel.exposedWarning': 'Bất kỳ ai tiếp cận được máy này trên mạng đều sẽ dùng được chuyển '
        + 'tiếp này. Hãy dùng 127.0.0.1 trừ khi bạn cố ý chia sẻ nó.',
    'tunnel.badRemotePort': 'Cổng từ xa phải nằm trong khoảng 0 đến 65535',
    'tunnel.badListenPort': 'Cổng lắng nghe phải nằm trong khoảng 1 đến 65535',
    'tunnel.destHostRequired': 'Cần nhập máy chủ đích',
    'tunnel.badDestPort': 'Cổng đích phải nằm trong khoảng 1 đến 65535',
    'tunnel.anywhere': 'bất kỳ đâu',
    'tunnel.serverWord': 'máy chủ',
    'tunnel.usageLocal': 'Kết nối tới {where}',
    'tunnel.usageRemote': 'Trên máy chủ: {where}',
    'tunnel.usageDynamic': 'Proxy SOCKS5 tại {where}',
    'tunnel.stateActive': 'Đang chạy',
    'tunnel.stateStarting': 'Đang khởi động…',
    'tunnel.stateStopped': 'Đã dừng',
    'tunnel.stateFailed': 'Thất bại',
    'tunnel.start': 'Chạy',
    'tunnel.stop': 'Dừng',
    'tunnel.startAll': 'Chạy tất cả',
    'tunnel.stopAll': 'Dừng tất cả',
    'tunnel.connections': 'kết nối',
    'tunnel.copyAddress': 'Sao chép địa chỉ',
    'tunnel.addressCopied': 'Đã sao chép địa chỉ',
    'tunnel.lastError': 'lỗi gần nhất: {error}',
    'tunnel.sessionDown': 'Phiên chưa kết nối. Các chuyển tiếp sẽ chạy lại khi phiên kết nối lại.',
    'tunnel.empty': 'Chưa có chuyển tiếp cổng nào',
    'tunnel.emptyNote': 'Chuyển tiếp một cổng để tiếp cận cơ sở dữ liệu hay một bảng điều khiển '
        + 'nội bộ qua máy chủ này, hoặc mở một proxy SOCKS để duyệt web từ nó.',
    'tunnel.editorEmpty': 'Chuyển tiếp một cổng để tiếp cận cơ sở dữ liệu hay dịch vụ nội bộ qua '
        + 'máy chủ này, hoặc mở một proxy SOCKS để duyệt web từ nó.',

    /* ---- Assistant panel ---- */
    'assistant.title': 'Trợ lý AI',
    'assistant.welcome': 'Cùng làm việc trên máy chủ của bạn nào',
    'assistant.welcomeNote': 'Nó đọc terminal này, chạy lệnh trên kênh riêng, và có thể làm việc '
        + 'trên mọi máy chủ bạn đã lưu.',
    'assistant.createQuickPrompts': 'Tạo câu hỏi nhanh',
    'assistant.newConversation': 'Cuộc trò chuyện mới',
    'assistant.chats': 'Cuộc trò chuyện',
    'assistant.chatHistory': 'Lịch sử trò chuyện',
    'assistant.working': 'Đang làm',
    'assistant.send': 'Gửi',
    'assistant.stop': 'Dừng',
    'assistant.askAbout': 'Hỏi về {about}',
    'assistant.costHint': 'Chi phí ước tính của cuộc trò chuyện này, tính theo token',

    'assistant.currentSession': 'Phiên hiện tại',
    'assistant.nothingConnected': 'Chưa kết nối gì',
    'assistant.noSessionOpen': 'Không có phiên nào mở',
    'assistant.yourServers': 'máy chủ của bạn',
    'assistant.anyHost': 'bất kỳ máy chủ nào',
    'assistant.closedSession': 'một phiên đã đóng',
    'assistant.savedHost': 'một máy chủ đã lưu',
    'assistant.savedHosts': 'Máy chủ đã lưu',
    'assistant.openSessions': 'Phiên đang mở',
    'assistant.allHostsHint': 'Mọi máy chủ đã lưu và mọi phiên đang mở',
    'assistant.serverCount': '{count} máy chủ',
    'assistant.sessionsOpen_other': '{count} phiên đang mở',
    'assistant.notConnected': 'Chưa kết nối',
    'assistant.searchScope': 'Tìm máy chủ',
    'assistant.searchScopeAria': 'Tìm phiên và máy chủ',

    'assistant.model': 'Mô hình',
    'assistant.modelAndEffort': 'Mô hình và mức nỗ lực',
    'assistant.readingModels': 'Đang đọc danh sách mô hình…',
    'assistant.noModels': 'Không có mô hình nào được báo về. Thử lại',
    'assistant.someNoModels': 'Một số tác nhân không báo mô hình nào. Thử lại',
    'assistant.notInRuntimeList': 'Không có trong danh sách của runtime này',
    'assistant.effort': 'Mức nỗ lực',
    'assistant.effortLow': 'Thấp',
    'assistant.effortMedium': 'Vừa',
    'assistant.effortHigh': 'Cao',
    'assistant.effortXHigh': 'Rất cao',
    'assistant.effortMax': 'Tối đa',
    'assistant.effortUltra': 'Cực đại',

    'assistant.approvalsLabel': 'Phê duyệt: {mode}',
    'assistant.approvalAlways': 'Hỏi mọi lúc',
    'assistant.approvalAlwaysHint': 'Mọi lần gọi công cụ đều chờ bạn',
    'assistant.approvalWrites': 'Hỏi trước khi thay đổi',
    'assistant.approvalWritesHint': 'Thao tác đọc chạy tự do',
    'assistant.approvalNever': 'Chế độ thả cửa',
    'assistant.approvalNeverHint': 'Không gì dừng lại, kể cả lệnh xoá',

    'assistant.didListHosts': 'Đã liệt kê máy chủ',
    'assistant.didListSessions': 'Đã liệt kê phiên',
    'assistant.didReadTerminal': 'Đã đọc terminal',
    'assistant.didRun': 'Đã chạy',
    'assistant.didType': 'Đã gõ',
    'assistant.didList': 'Đã liệt kê',
    'assistant.didRead': 'Đã đọc',
    'assistant.didWrite': 'Đã ghi',
    'assistant.didConnect': 'Đã kết nối tới',
    'assistant.didDisconnect': 'Đã đóng phiên',
    'assistant.lastLines': '{count} dòng cuối',
    'assistant.recentOutput': 'kết quả gần đây',
    'assistant.matching': 'khớp với "{query}"',

    'assistant.askRunCommand': 'Chạy một lệnh',
    'assistant.askSendInput': 'Gõ vào terminal',
    'assistant.askWriteFile': 'Ghi đè một tệp',
    'assistant.askConnectHost': 'Mở một kết nối',
    'assistant.askDisconnect': 'Đóng một phiên',
    'assistant.askReadTerminal': 'Đọc terminal',
    'assistant.askReadFile': 'Đọc một tệp',
    'assistant.askListDirectory': 'Liệt kê một thư mục',
    'assistant.askListHosts': 'Liệt kê máy chủ đã lưu',
    'assistant.askListSessions': 'Liệt kê phiên đang mở',
    'assistant.askRunLocally': 'Chạy {tool} trên máy này',
    'assistant.onHost': 'trên {host}',
    'assistant.allow': 'Cho phép',
    'assistant.decline': 'Từ chối',
    'assistant.somethingElse': 'Làm cách khác…',
    'assistant.insteadPlaceholder': 'Nó nên làm gì thay vào đó?',
    'assistant.copyCommand': 'Sao chép lệnh',
    'assistant.localWarning': 'Lệnh này chạy trên chính máy của bạn, không phải trên máy chủ.',
    'assistant.allowed': 'Đã cho phép',
    'assistant.declined': 'Đã từ chối',
    'assistant.timedOut': 'Đã hết thời gian',
};
