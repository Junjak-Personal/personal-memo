import Foundation

/// 공유 시트로 받은 글 하나.
struct MemoInboxItem: Codable {
  let id: String
  /// 공유 시트 글칸의 내용 (사파리에서 공유하면 페이지 제목이 들어 있다)
  let text: String
  let url: String?
  /// ISO 8601
  let receivedAt: String
}

/// 공유 시트(MemoShare 확장)가 받은 글을 메모 앱이 열릴 때까지 담아 두는 보관함 (설계문서 §10.4).
///
/// 확장과 앱은 다른 프로세스라 App Group 의 UserDefaults 로 나눠 쓴다. 확장은 넣기만 하고, 앱은 웹이 서버 저장을
/// 마쳤다고 알려 준 것(id)만 뺀다 — 저장 도중에 앱이 꺼져도 잃지 않는다.
/// 이 파일은 Runner 와 MemoShare 두 타깃에 같이 들어간다.
final class MemoInbox {
  /// Info.plist 의 AppGroupId(= group.<번들 id>). 비었거나(App Group 없이 설치한 dev 빌드) 설정이 틀렸으면 nil —
  /// 공유 시트는 「보관하지 못했습니다」 를 띄운다. 묶이지 않은 그룹 이름으로 열면 앱과 나눠 쓰지 못해 조용히 사라진다
  static let shared: MemoInbox? = {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupId") as? String,
          !group.isEmpty,
          let defaults = UserDefaults(suiteName: group)
    else { return nil }
    return MemoInbox(defaults: defaults)
  }()

  private let defaults: UserDefaults
  private let key = "memoInbox"

  init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  func items() -> [MemoInboxItem] {
    guard let data = defaults.data(forKey: key) else { return [] }
    return (try? JSONDecoder().decode([MemoInboxItem].self, from: data)) ?? []
  }

  func append(_ item: MemoInboxItem) {
    save(items() + [item])
  }

  func remove(ids: [String]) {
    let gone = Set(ids)
    save(items().filter { !gone.contains($0.id) })
  }

  /// 웹에 넘길 JSON 배열
  func json() -> String {
    guard let data = try? JSONEncoder().encode(items()) else { return "[]" }
    return String(data: data, encoding: .utf8) ?? "[]"
  }

  private func save(_ all: [MemoInboxItem]) {
    defaults.set(try? JSONEncoder().encode(all), forKey: key)
  }
}
