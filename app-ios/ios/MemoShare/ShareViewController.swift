import Social
import UIKit
import UniformTypeIdentifiers

/// 공유 시트 → 보관함 (설계문서 §10.4, 2026-10-07 확정 — 「앱 열 때 저장」).
///
/// 서버에 바로 보내지 않는다. 확장에는 로그인이 없고, 오래 가는 토큰을 새로 두지 않기 위해서다.
/// 글과 링크를 App Group 보관함에 넣어 두면, 메모 앱을 열 때 웹이 「받은 메모」 폴더에 새 메모로 저장한다.
final class ShareViewController: SLComposeServiceViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "메모로 보관"
    placeholder = "메모에 남길 말"
  }

  override func isContentValid() -> Bool {
    true
  }

  override func configurationItems() -> [Any]! {
    []
  }

  override func didSelectPost() {
    guard let inbox = MemoInbox.shared else {
      // 조용히 버리지 않는다 — App Group 설정이 빠진 빌드
      let alert = UIAlertController(title: "보관하지 못했습니다", message: "메모 앱의 보관함을 열 수 없습니다.", preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "닫기", style: .default) { _ in
        self.extensionContext?.cancelRequest(withError: NSError(domain: "MemoShare", code: 1))
      })
      present(alert, animated: true)
      return
    }
    let text = contentText ?? ""
    sharedURL { url in
      inbox.append(MemoInboxItem(id: UUID().uuidString, text: text, url: url, receivedAt: ISO8601DateFormatter().string(from: Date())))
      self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  /// 공유한 것 중 링크 하나 (사파리·앱의 「공유」). 글만 공유했으면 nil
  private func sharedURL(_ done: @escaping (String?) -> Void) {
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) else {
      done(nil)
      return
    }
    provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
      let url = (item as? URL)?.absoluteString ?? (item as? String)
      DispatchQueue.main.async { done(url) }
    }
  }
}
