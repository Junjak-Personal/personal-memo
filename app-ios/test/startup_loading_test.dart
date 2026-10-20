import 'package:flutter_test/flutter_test.dart';
import 'package:memo/startup_loading.dart';

void main() {
  testWidgets('문서 로드만으로 숨기지 않고 명시적인 SPA 준비 응답을 기다린다', (tester) async {
    final startup = StartupLoading(onChanged: () {})..begin();
    addTearDown(startup.dispose);

    startup.acceptProbe(0, startup.generation);
    expect(startup.visible, isTrue);
    startup.acceptProbe('1', startup.generation);
    expect(startup.phase, StartupPhase.ready);
    expect(startup.visible, isFalse);
    await tester.pump(const Duration(seconds: 20));
    expect(startup.phase, StartupPhase.ready);
  });

  testWidgets('구버전 웹은 15초 뒤 선택지를 보이고 시간 초과를 완료로 취급하지 않는다', (tester) async {
    final startup = StartupLoading(onChanged: () {})..begin();
    addTearDown(startup.dispose);

    await tester.pump(const Duration(seconds: 15));
    expect(startup.phase, StartupPhase.slow);
    expect(startup.visible, isTrue);
    startup.reveal();
    expect(startup.phase, StartupPhase.revealed);
    expect(startup.visible, isFalse);
  });

  testWidgets('재시도 후 이전 문서의 준비 완료와 이전 타이머는 무시한다', (tester) async {
    final startup = StartupLoading(onChanged: () {})..begin();
    addTearDown(startup.dispose);
    final oldGeneration = startup.generation;
    await tester.pump(const Duration(seconds: 10));

    startup.begin();
    startup.acceptProbe(1, oldGeneration);
    await tester.pump(const Duration(seconds: 5));
    expect(startup.phase, StartupPhase.loading);
    startup.acceptProbe(1, startup.generation);
    expect(startup.phase, StartupPhase.ready);
  });

  testWidgets('초기화 실패는 안내 상태를 유지하고 재시도로 다시 준비할 수 있다', (tester) async {
    final startup = StartupLoading(onChanged: () {})..begin();
    addTearDown(startup.dispose);

    startup.acceptProbe(2, startup.generation);
    startup.acceptProbe(1, startup.generation);
    await tester.pump(const Duration(seconds: 20));
    expect(startup.phase, StartupPhase.failed);
    startup.begin();
    expect(startup.phase, StartupPhase.loading);
    startup.acceptProbe(1, startup.generation);
    expect(startup.phase, StartupPhase.ready);
  });

  testWidgets('종료한 화면에서는 타이머와 늦은 응답이 상태를 바꾸지 않는다', (tester) async {
    var changes = 0;
    final startup = StartupLoading(onChanged: () => changes++)..begin();
    final generation = startup.generation;

    startup.dispose();
    startup.acceptProbe(1, generation);
    await tester.pump(const Duration(seconds: 20));
    expect(changes, 1);
  });
}
