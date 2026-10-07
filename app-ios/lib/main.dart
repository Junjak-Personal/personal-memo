import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

/// 웹앱이 사는 곳. 이 껍데기는 «키보드 위 서식 툴바»만 가져가고 나머지는 전부 웹이 한다.
///
/// 왜 이 앱이 있는가: iOS WKWebView 는 interactive-widget=resizes-content 를 지원하지 않아서
/// 키보드가 떠도 레이아웃 뷰포트가 줄지 않는다. 웹으로 툴바를 키보드에 붙이려면 visualViewport 를
/// 쫓아야 하는데, pic-blog 에서 그 방식으로 다섯 번 실패했다. 여기서는 Flutter 가 키보드 위 자리를
/// 잡고, 버튼은 명령만 웹으로 보낸다 — 서식 로직은 웹에만 있다.
const kSite = String.fromEnvironment(
  'SITE',
  defaultValue: 'http://localhost:4700',
);

/// 운영 주소가 정해지면 defaultValue 를 바꾼다 (설계문서 §13 미정). 지금은 dev-install.sh 가 SITE 를 넘긴다.

/// 껍데기의 색 — 웹(Nuxt UI, neutral)과 같은 값. 시스템 다크·라이트를 따른다.
/// 웹뷰 밖(상태바 영역, 키보드 위 툴바, 연결 실패 화면)이 웹과 다른 색이면 띠처럼 보인다.
class Palette {
  const Palette._({
    required this.ground,
    required this.toolbar,
    required this.line,
    required this.active,
    required this.muted,
  });

  final Color ground;
  final Color toolbar;
  final Color line;
  final Color active;
  final Color muted;

  static const light = Palette._(
    ground: Colors.white,
    toolbar: Color(0xFFFAFAFA), // neutral-50
    line: Color(0xFFE5E5E5), // neutral-200
    active: Color(0xFFE5E5E5),
    muted: Color(0xFF737373), // neutral-500
  );

  static const dark = Palette._(
    ground: Color(0xFF0A0A0A), // neutral-950 — 웹 다크 바탕(main.css)과 같다
    toolbar: Color(0xFF171717), // neutral-900
    line: Color(0xFF262626), // neutral-800
    active: Color(0xFF262626),
    muted: Color(0xFFA3A3A3), // neutral-400
  );

  static Palette of(BuildContext context) =>
      MediaQuery.platformBrightnessOf(context) == Brightness.dark
      ? dark
      : light;
}

/// 페이지가 부르는 이름. 웹쪽은 이 한 이름만 안다.
const kChannel = 'MemoNative';

/// 공유 시트 보관함 (설계문서 §10.4). 툴바 브리지(kChannel)의 모양을 바꾸지 않으려고 따로 둔다 — 새 정보는 새 창으로.
/// 웹 → `{type:'pull'}` (꺼내 줘) · `{type:'ack', ids}` (서버에 저장했음)
const kInboxChannel = 'MemoInbox';

/// 보관함을 들고 있는 네이티브 쪽 (ios/Shared/MemoInbox.swift, App Group)
const _inbox = MethodChannel('memo/inbox');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MemoApp());
}

class MemoApp extends StatelessWidget {
  const MemoApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    theme: ThemeData(brightness: Brightness.light),
    darkTheme: ThemeData(brightness: Brightness.dark),
    title: 'memo',
    debugShowCheckedModeBanner: false,
    home: const Shell(),
  );
}

/// 웹이 알려주는 에디터 상태. 버튼 활성 표시에만 쓴다.
class EditorState {
  const EditorState({
    this.bold = false,
    this.italic = false,
    this.underline = false,
    this.strike = false,
    this.link = false,
    this.heading = 0,
    this.canUndo = false,
    this.canRedo = false,
  });

  final bool bold;
  final bool italic;
  final bool underline;
  final bool strike;
  final bool link;
  final int heading;
  final bool canUndo;
  final bool canRedo;

  /// 모르는 키는 무시하고, 없는 키는 false — 웹이 먼저 배포돼도, 앱이 먼저 깔려도 깨지지 않게
  factory EditorState.fromJson(Map<String, dynamic> j) => EditorState(
    bold: j['bold'] == true,
    italic: j['italic'] == true,
    underline: j['underline'] == true,
    strike: j['strike'] == true,
    link: j['link'] == true,
    heading: (j['heading'] as num?)?.toInt() ?? 0,
    canUndo: j['canUndo'] == true,
    canRedo: j['canRedo'] == true,
  );
}

class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> with WidgetsBindingObserver {
  late final WebViewController _web;

  /// 에디터에 포커스가 있는가 — 웹이 알려준다
  bool _focused = false;

  /// 첫 페이지를 못 불러온 이유. 있으면 웹뷰 위에 안내를 덮는다
  String? _loadError;

  /// 웹뷰 바탕으로 마지막에 넣은 색 — 같은 색을 매번 넣지 않게
  Color? _ground;
  EditorState _state = const EditorState();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setOnConsoleMessage((m) => debugPrint('[web] ${m.message}'))
      ..addJavaScriptChannel(
        kChannel,
        onMessageReceived: (m) => _onMessage(m.message),
      )
      ..addJavaScriptChannel(
        kInboxChannel,
        onMessageReceived: (m) => _onInboxMessage(m.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          /*
         * 🔴 웹 콘텐츠 프로세스가 죽으면 WKWebView 는 «빈 화면을 그대로 둔다» (pic-blog 와 같은 이유).
         */
          onPageStarted: (_) {
            if (_loadError != null) setState(() => _loadError = null);
          },
          onWebResourceError: (e) {
            if (e.errorType ==
                WebResourceErrorType.webContentProcessTerminated) {
              _web.loadRequest(Uri.parse(kSite));
              return;
            }
            /*
           * 🔴 첫 페이지를 못 불러오면 WKWebView 는 흰 화면을 그대로 둔다 — 서버가 꺼졌는지, 주소가 틀렸는지
           *    아무 말이 없다. 실제로 dev 서버 주소가 엉뚱한 IP 로 풀려 흰 화면에서 멈춘 적이 있다 (2026-10-07).
           *    이미지 하나 못 받은 것 같은 하위 요청 실패는 무시한다.
           */
            if (e.isForMainFrame ?? true) {
              setState(() => _loadError = '${e.description} (${e.errorCode})');
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(kSite));

    // 가장자리 스와이프 뒤로가기를 끈다 — 저장 안 된 입력이 한 번에 날아가면 안 된다
    final platform = _web.platform;
    if (platform is WebKitWebViewController) {
      platform.setAllowsBackForwardNavigationGestures(false);
    }
  }

  void _onMessage(String raw) {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (msg['type']) {
      case 'focus':
        setState(() => _focused = true);
      case 'blur':
        setState(() => _focused = false);
      case 'state':
        setState(() => _state = EditorState.fromJson(msg));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// 공유 시트에서 돌아오면 웹에 보관함을 확인하라고 알린다 (웹이 로그인돼 있으면 pull 한다)
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _web.runJavaScript('window.memoInbox && window.memoInbox.pull()');
    }
  }

  Future<void> _onInboxMessage(String raw) async {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (msg['type']) {
      case 'pull':
        final items = await _inbox.invokeMethod<String>('peek') ?? '[]';
        if (items == '[]') return;
        // JSON 은 그대로 JS 식이다
        await _web.runJavaScript(
          'window.memoInbox && window.memoInbox.deliver($items)',
        );
      case 'ack':
        final ids = (msg['ids'] as List?)?.whereType<String>().toList() ?? [];
        if (ids.isNotEmpty) await _inbox.invokeMethod('remove', ids);
    }
  }

  void _retry() {
    setState(() => _loadError = null);
    _web.loadRequest(Uri.parse(kSite));
  }

  /// 명령은 웹이 실행한다. 여기서는 이름만 보낸다.
  void _exec(String command) {
    _web.runJavaScript(
      'window.memoEditor && window.memoEditor.exec(${jsonEncode(command)})',
    );
  }

  @override
  Widget build(BuildContext context) {
    final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;

    final palette = Palette.of(context);
    // 웹이 그리기 전 잠깐 보이는 웹뷰 바탕도 맞춘다 — 다크에서 흰 번쩍임이 없게
    if (_ground != palette.ground) {
      _ground = palette.ground;
      _web.setBackgroundColor(palette.ground);
    }

    return AnnotatedRegion<SystemUiOverlayStyle>(
      // 상태바 글자색: 어두운 바탕엔 흰 글자
      value: palette == Palette.dark
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: palette.ground,
        // 키보드만큼 몸통을 줄인다 — 그래서 툴바가 키보드 바로 위에 선다
        resizeToAvoidBottomInset: true,
        body: SafeArea(
          bottom: !keyboardUp,
          child: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    WebViewWidget(controller: _web),
                    if (_loadError != null)
                      _LoadError(
                        palette: palette,
                        message: _loadError!,
                        onRetry: _retry,
                      ),
                  ],
                ),
              ),
              // 키보드가 올라오면 아래에서 올라오며 나타난다. 「동작 줄이기」 를 켰으면 바로 나타난다
              AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero
                    : const Duration(milliseconds: 180),
                switchInCurve: Curves.easeOut,
                switchOutCurve: Curves.easeIn,
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: SizeTransition(
                    sizeFactor: animation,
                    alignment: Alignment.topCenter,
                    child: child,
                  ),
                ),
                child: _focused && keyboardUp
                    ? _Toolbar(
                        key: const ValueKey('toolbar'),
                        palette: palette,
                        state: _state,
                        onCommand: _exec,
                      )
                    : const SizedBox.shrink(key: ValueKey('none')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    super.key,
    required this.palette,
    required this.state,
    required this.onCommand,
  });

  final Palette palette;
  final EditorState state;
  final void Function(String command) onCommand;

  @override
  Widget build(BuildContext context) {
    Widget button(
      String command,
      Widget child, {
      bool active = false,
      bool enabled = true,
    }) =>
        // 🔴 GestureDetector 로 받는다. 포커스를 요청하는 위젯(IconButton 등)을 쓰면 Flutter 포커스가
        //    옮겨가면서 웹뷰가 first responder 를 잃을 수 있다. 이 방식으로 실기기에서 탭 5번에 blur 0건 (스파이크 S1).
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: enabled ? () => onCommand(command) : null,
          child: Container(
            width: 44,
            height: 40,
            alignment: Alignment.center,
            margin: const EdgeInsets.symmetric(horizontal: 2),
            decoration: BoxDecoration(
              color: active ? palette.active : null,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Opacity(opacity: enabled ? 1 : 0.3, child: child),
          ),
        );

    Text label(String s) => Text(
      s,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    );

    Widget divider() => Container(
      width: 1,
      margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
      color: palette.line,
    );

    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: palette.toolbar,
        border: Border(top: BorderSide(color: palette.line)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        children: [
          // 블록 메뉴 — 웹이 「/」 를 넣어 연다. 키보드를 기호판으로 바꾸지 않아도 된다
          button('block', const Icon(Icons.add, size: 22)),
          divider(),
          button('h1', label('H1'), active: state.heading == 1),
          button('h2', label('H2'), active: state.heading == 2),
          button('h3', label('H3'), active: state.heading == 3),
          divider(),
          button(
            'bold',
            const Icon(Icons.format_bold, size: 22),
            active: state.bold,
          ),
          button(
            'italic',
            const Icon(Icons.format_italic, size: 22),
            active: state.italic,
          ),
          button(
            'underline',
            const Icon(Icons.format_underlined, size: 22),
            active: state.underline,
          ),
          button(
            'strike',
            const Icon(Icons.format_strikethrough, size: 22),
            active: state.strike,
          ),
          divider(),
          button('link', const Icon(Icons.link, size: 22), active: state.link),
          button('image', const Icon(Icons.image_outlined, size: 22)),
          divider(),
          button(
            'undo',
            const Icon(Icons.undo, size: 20),
            enabled: state.canUndo,
          ),
          button(
            'redo',
            const Icon(Icons.redo, size: 20),
            enabled: state.canRedo,
          ),
        ],
      ),
    );
  }
}

/// 첫 페이지를 못 불러왔을 때 — 흰 화면 대신 이유와 다시 시도를 보여준다
class _LoadError extends StatelessWidget {
  const _LoadError({
    required this.palette,
    required this.message,
    required this.onRetry,
  });

  final Palette palette;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Container(
    color: palette.ground,
    alignment: Alignment.center,
    padding: const EdgeInsets.all(32),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.cloud_off_outlined, size: 40, color: palette.muted),
        const SizedBox(height: 12),
        const Text(
          '메모 서버에 연결하지 못했습니다',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        Text(kSite, style: TextStyle(fontSize: 13, color: palette.muted)),
        const SizedBox(height: 4),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: palette.muted),
        ),
        const SizedBox(height: 20),
        FilledButton(onPressed: onRetry, child: const Text('다시 시도')),
      ],
    ),
  );
}
