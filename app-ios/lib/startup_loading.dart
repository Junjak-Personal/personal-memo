import 'dart:async';

enum StartupPhase { loading, slow, ready, failed, revealed }

/// 문서 로드와 SPA 준비 완료는 다르다. 새 문서의 명시적인 응답만 받는다.
class StartupLoading {
  StartupLoading({
    required this.onChanged,
    this.timeout = const Duration(seconds: 15),
  });

  final void Function() onChanged;
  final Duration timeout;
  Timer? _timer;
  int _generation = 0;
  StartupPhase _phase = StartupPhase.loading;

  int get generation => _generation;
  StartupPhase get phase => _phase;
  bool get visible =>
      _phase == StartupPhase.loading || _phase == StartupPhase.slow;

  void begin() {
    _timer?.cancel();
    final generation = ++_generation;
    _phase = StartupPhase.loading;
    _timer = Timer(timeout, () {
      if (_generation != generation || !visible) return;
      _phase = StartupPhase.slow;
      onChanged();
    });
    onChanged();
  }

  /// 0/없는 계약 = 대기, 1 = 준비 완료, 2 = 웹 초기화 실패.
  /// 이전 문서의 비동기 probe는 새 문서의 로딩을 닫지 못한다.
  void acceptProbe(Object result, int generation) {
    if (generation != _generation || !visible) return;
    if (result == 1 || result == '1') {
      _finish(StartupPhase.ready);
    } else if (result == 2 || result == '2') {
      fail();
    }
  }

  void fail() => _finish(StartupPhase.failed);

  /// 구버전 웹도 열 수 있게 하되, 사용자의 선택을 준비 완료로 기록하지 않는다.
  void reveal() => _finish(StartupPhase.revealed);

  void _finish(StartupPhase phase) {
    _timer?.cancel();
    _phase = phase;
    onChanged();
  }

  void dispose() {
    _timer?.cancel();
    ++_generation;
  }
}
