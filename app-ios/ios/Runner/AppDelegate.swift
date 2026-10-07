import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    registerInbox(engineBridge.applicationRegistrar.messenger())
  }

  /// 공유 시트 보관함 (설계문서 §10.4) — Dart 가 꺼내 웹에 넘기고, 웹이 저장한 것만 뺀다
  private func registerInbox(_ messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "memo/inbox", binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "peek":
        result(MemoInbox.shared?.json() ?? "[]")
      case "remove":
        MemoInbox.shared?.remove(ids: call.arguments as? [String] ?? [])
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
