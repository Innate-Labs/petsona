// 壳入口：单实例锁 + sidecar watchdog + 宠物 NSPanel + 面板 + 托盘 + 系统上报
// 壳不含业务逻辑，只做渲染与系统 API 代理（v3.0 §1）

mod bridge;
mod macos;
mod pet_window;
mod tray;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 打开/聚焦面板窗口（宠物菜单与托盘共用）
#[tauri::command]
fn open_panel(app: AppHandle, route: Option<String>) {
    let label = "panel";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(r) = route {
            let _ = win.eval(&format!("location.hash = '#/{}'", r.trim_start_matches("#/")));
        }
        return;
    }
    let _ = WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html#/panel".into()))
        .title("宠格 Petsona")
        .inner_size(920.0, 640.0)
        .build();
}

pub(crate) fn show_panel(app: &AppHandle, route: &str) {
    open_panel(app.clone(), Some(route.to_string()));
}

pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动：聚焦面板而不是再开一个实例（单实例锁）
            show_panel(app, "panel");
        }))
        .plugin(tauri_nspanel::init())
        .manage(bridge::SidecarState::default())
        .invoke_handler(tauri::generate_handler![bridge::ipc_send, open_panel])
        .setup(|app| {
            bridge::spawn_sidecar(app.handle().clone());
            pet_window::create(app.handle())?;
            tray::create(app.handle())?;
            macos::start_reporters(app.handle().clone());
            open_panel(app.handle().clone(), None);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("petsona shell 启动失败");
}
