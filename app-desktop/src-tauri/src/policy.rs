use tauri::Url;

pub const PRODUCTION_URL: &str = "https://memo.jun-devlog.win/";

#[derive(Debug, PartialEq, Eq)]
pub enum Destination {
    App,
    Memo,
    External,
    Blocked,
}

pub fn site_url(dev: bool, value: Option<&str>) -> Result<Url, &'static str> {
    if !dev {
        return Url::parse(PRODUCTION_URL).map_err(|_| "invalid production URL");
    }
    let url = Url::parse(value.unwrap_or("http://localhost:4710/"))
        .map_err(|_| "개발 서버 URL 형식이 올바르지 않습니다")?;
    if !matches!(url.scheme(), "http" | "https")
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("개발 서버는 인증 정보·경로·쿼리 없는 loopback HTTP(S) 주소여야 합니다");
    }
    Ok(url)
}

pub fn is_app(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
}

pub fn destination(site: &Url, url: &Url) -> Destination {
    if !url.username().is_empty() || url.password().is_some() {
        return Destination::Blocked;
    }
    if is_app(url) {
        return Destination::App;
    }
    if matches!(url.scheme(), "https" | "http") && url.origin() == site.origin() {
        return Destination::Memo;
    }
    if matches!(url.scheme(), "https" | "http" | "mailto") {
        return Destination::External;
    }
    Destination::Blocked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_ignores_server_override() {
        assert_eq!(
            site_url(false, Some("http://evil.test")).unwrap().as_str(),
            PRODUCTION_URL
        );
    }

    #[test]
    fn dev_only_accepts_loopback_origin() {
        for good in [
            "http://localhost:4710",
            "http://127.0.0.1:4710/",
            "https://[::1]:4710/",
        ] {
            assert!(site_url(true, Some(good)).is_ok(), "{good}");
        }
        for bad in [
            "https://memo.jun-devlog.win",
            "http://localhost.evil.test",
            "http://127.0.0.2",
            "file:///etc/passwd",
            "http://user@localhost/",
            "http://localhost/path",
            "http://localhost/?x=1",
            "http://localhost/#x",
        ] {
            assert!(site_url(true, Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn navigations_have_exact_origin_and_scheme_boundaries() {
        let site = site_url(false, None).unwrap();
        for (value, expected) in [
            (
                "https://memo.jun-devlog.win/m/abc?x=1#heading",
                Destination::Memo,
            ),
            ("https://memo.jun-devlog.win:444/", Destination::External),
            ("http://memo.jun-devlog.win/", Destination::External),
            (
                "https://memo.jun-devlog.win.evil.test/",
                Destination::External,
            ),
            (
                "https://memo.jun-devlog.win@evil.test/",
                Destination::Blocked,
            ),
            ("https://example.com", Destination::External),
            ("mailto:hello@example.com", Destination::External),
            ("tauri://localhost/index.html", Destination::App),
            ("http://tauri.localhost/index.html", Destination::App),
            ("https://tauri.localhost/", Destination::External),
            ("tauri://evil.test/", Destination::Blocked),
            ("javascript:alert(1)", Destination::Blocked),
            ("file:///etc/passwd", Destination::Blocked),
            ("data:text/html,test", Destination::Blocked),
            ("blob:https://memo.jun-devlog.win/abc", Destination::Blocked),
            ("about:blank", Destination::Blocked),
            ("memo://open", Destination::Blocked),
        ] {
            assert_eq!(
                destination(&site, &Url::parse(value).unwrap()),
                expected,
                "{value}"
            );
        }
    }
}
