// 壳入口：单实例锁 + sidecar watchdog + 宠物 NSPanel + 面板 + 托盘 + 系统上报
// 壳不含业务逻辑，只做渲染与系统 API 代理（v3.0 §1）

mod bridge;
mod macos;
mod pet_window;
mod tray;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const FLOAT_WIDTH: f64 = 300.0;
const FLOAT_HEIGHT: f64 = 425.0;
const FLOAT_GAP: f64 = 12.0;

/// 打开/聚焦面板窗口（宠物菜单与托盘共用）
/// 面板子页 hash 是 #/panel/<page>（Panel.tsx 按 split('/')[2] 取页名），
/// 调用方只传子页名（chat/data/…）或 "panel" 表示首页，这里统一补前缀
#[tauri::command]
fn open_panel(app: AppHandle, route: Option<String>) {
    let label = "panel";
    let raw = route.unwrap_or_default();
    let page = raw
        .trim_start_matches("#/")
        .trim_start_matches("panel")
        .trim_start_matches('/');
    let hash = if page.is_empty() {
        "#/panel".to_string()
    } else {
        format!("#/panel/{page}")
    };
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.eval(&format!("location.hash = '{hash}'"));
        return;
    }
    // 首次打开也要带上子页，否则深链在窗口创建路径上丢失
    let _ = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(format!("index.html{hash}").into()))
        .title("宠格 Petsona")
        .inner_size(920.0, 640.0)
        .build();
}

/// 打开宠物旁快捷聊天浮窗（复用 #/float 路由）
#[tauri::command]
fn open_float_chat(app: AppHandle) {
    let label = "float";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let Ok(win) = WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html#/float".into()))
        .title("宠格快捷聊天")
        .inner_size(FLOAT_WIDTH, FLOAT_HEIGHT)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .accept_first_mouse(true)
        .build()
    else {
        return;
    };
    place_float_chat(&app, &win);
    let _ = win.set_focus();
}

#[tauri::command]
fn close_float_chat(app: AppHandle) {
    if let Some(win) = app.get_webview_window("float") {
        let _ = win.hide();
    }
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
        .invoke_handler(tauri::generate_handler![
            bridge::ipc_send,
            open_panel,
            open_float_chat,
            close_float_chat
        ])
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

fn place_float_chat(app: &AppHandle, win: &tauri::WebviewWindow) {
    if let Some(pet) = app.get_webview_window("pet") {
        if let (Ok(pet_pos), Ok(Some(monitor))) = (pet.outer_position(), pet.current_monitor()) {
            let scale = monitor.scale_factor();
            let float_w = (FLOAT_WIDTH * scale).round() as i32;
            let float_h = (FLOAT_HEIGHT * scale).round() as i32;
            let gap = (FLOAT_GAP * scale).round() as i32;
            let pet_w = (180.0 * scale).round() as i32;
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();
            let right_x = pet_pos.x + pet_w + gap;
            let left_x = pet_pos.x - float_w - gap;
            let x = if right_x + float_w <= monitor_pos.x + monitor_size.width as i32 {
                right_x
            } else {
                left_x
            };
            let y = pet_pos.y - ((FLOAT_HEIGHT - 200.0) * scale / 2.0).round() as i32;
            let _ = win.set_position(tauri::PhysicalPosition::new(
                clamp_i32(x, monitor_pos.x, monitor_pos.x + monitor_size.width as i32 - float_w),
                clamp_i32(y, monitor_pos.y, monitor_pos.y + monitor_size.height as i32 - float_h),
            ));
            return;
        }
    }

    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        let float_w = (FLOAT_WIDTH * scale).round() as i32;
        let float_h = (FLOAT_HEIGHT * scale).round() as i32;
        let pos = monitor.position();
        let size = monitor.size();
        let _ = win.set_position(tauri::PhysicalPosition::new(
            pos.x + size.width as i32 - float_w - (24.0 * scale).round() as i32,
            pos.y + size.height as i32 - float_h - (64.0 * scale).round() as i32,
        ));
    }
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    if max < min {
        return min;
    }
    value.max(min).min(max)
}
