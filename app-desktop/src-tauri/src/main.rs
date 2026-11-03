#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod policy;

use policy::{destination, is_app, site_url, Destination};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::webview::{NewWindowResponse, PermissionResponse};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

static RECOVERY_DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

// 외부 링크 반복 클릭으로 브라우저 창이 쌓이지 않게 한다. 주소/토큰은 로그에 남기지 않는다.
fn open_external(url: &Url, last_open: &Mutex<Option<Instant>>) {
    let Ok(mut last) = last_open.lock() else {
        return;
    };
    if last.is_some_and(|time| time.elapsed() < Duration::from_millis(800)) {
        return;
    }
    *last = Some(Instant::now());
    if open::that_detached(url.as_str()).is_err() {
        eprintln!("외부 링크를 열지 못했습니다");
    }
}

fn main() {
    let local = cfg!(debug_assertions) || cfg!(feature = "local-test");
    let site = site_url(local, option_env!("MEMO_DESKTOP_DEV_URL"))
        .expect("Memo 개발 서버 설정을 확인하세요");
    let setup_site = site.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let connect = MenuItem::with_id(
                app,
                "connect",
                "연결 화면…",
                true,
                Some("CmdOrCtrl+Shift+L"),
            )?;
            let back = MenuItem::with_id(app, "back", "뒤로", true, Some("CmdOrCtrl+["))?;
            let app_menu = SubmenuBuilder::new(app, "Memo")
                .about(None)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit = SubmenuBuilder::new(app, "편집")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view = SubmenuBuilder::new(app, "이동")
                .item(&back)
                .item(&connect)
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "창")
                .minimize()
                .close_window()
                .build()?;
            app.set_menu(
                MenuBuilder::new(app)
                    .items(&[&app_menu, &edit, &view, &window_menu])
                    .build()?,
            )?;

            // 원격 화면에는 네이티브 API를 주입하지 않는다. 연결 주소와 HTTP 캐시 정책만 설정한다.
            let script = include_str!("../../frontend/bootstrap.js")
                .replace("__MEMO_SITE__", &format!("{:?}", setup_site.as_str()));
            let nav_site = setup_site.clone();
            let popup_site = setup_site.clone();
            let last_open = Arc::new(Mutex::new(None));
            let nav_last = last_open.clone();
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(if local {
                    "Memo — 로컬 테스트"
                } else {
                    "Memo"
                })
                .inner_size(1280.0, 860.0)
                .min_inner_size(800.0, 600.0)
                .initialization_script(&script)
                .on_navigation(move |url| match destination(&nav_site, url) {
                    Destination::App | Destination::Memo => true,
                    Destination::External => {
                        open_external(url, &nav_last);
                        false
                    }
                    Destination::Blocked => false,
                })
                .on_new_window(move |url, _| {
                    match destination(&popup_site, &url) {
                        Destination::Memo => {
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.navigate(url);
                            }
                        }
                        Destination::External => open_external(&url, &last_open),
                        Destination::App | Destination::Blocked => {}
                    }
                    NewWindowResponse::Deny
                })
                .on_download(|_, _| false)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .disable_drag_drop_handler()
                .build()?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            match event.id().as_ref() {
                "back" => {
                    let _ = window.eval("history.back()");
                }
                "connect" => {
                    #[cfg(target_os = "windows")]
                    let local_url = "http://tauri.localhost/index.html";
                    #[cfg(not(target_os = "windows"))]
                    let local_url = "tauri://localhost/index.html";
                    if window.url().is_ok_and(|url| is_app(&url)) {
                        let _ = window.navigate(local_url.parse().expect("local URL"));
                    } else {
                        // WKWebView의 JS confirm 구현에 기대지 않고 Rust에서만 확인창을 연다.
                        if RECOVERY_DIALOG_OPEN.swap(true, Ordering::SeqCst) {
                            return;
                        }
                        app.dialog()
                            .message("연결 화면으로 이동할까요? 저장 상태를 확인해 주세요.")
                            .parent(&window)
                            .title("Memo")
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                "이동".into(),
                                "취소".into(),
                            ))
                            .show(move |confirmed| {
                                RECOVERY_DIALOG_OPEN.store(false, Ordering::SeqCst);
                                if confirmed {
                                    let _ = window.navigate(local_url.parse().expect("local URL"));
                                }
                            });
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("Memo를 실행하지 못했습니다");
}
