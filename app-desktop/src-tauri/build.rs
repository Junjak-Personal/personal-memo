fn main() {
    println!("cargo:rerun-if-env-changed=MEMO_DESKTOP_DEV_URL");
    tauri_build::build()
}
