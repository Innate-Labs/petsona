// 壳入口：单实例锁 + sidecar watchdog + 宠物 NSPanel + 面板 + 托盘 + 系统上报
// 壳不含业务逻辑，只做渲染与系统 API 代理（v3.0 §1）

mod bridge;
mod macos;
mod pet_window;
mod tray;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    AppHandle, LogicalPosition, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder,
};

const FLOAT_WIDTH: f64 = 412.0;
const FLOAT_HEIGHT: f64 = 537.0;
const FLOAT_MAX_WIDTH: f64 = 872.0;
const FLOAT_MAX_HEIGHT: f64 = 1092.0;
const FLOAT_GAP: f64 = 12.0;
const PANEL_WIDTH: f64 = 960.0;
const PANEL_HEIGHT: f64 = 720.0;
const MIN_PET_SIZE: f64 = 180.0;
const MAX_PET_SIZE: f64 = 420.0;

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
    let page = normalize_panel_route(page);
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
        .title("")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .min_inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .transparent(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .traffic_light_position(LogicalPosition::new(16.0, 22.0))
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
        .min_inner_size(FLOAT_WIDTH, FLOAT_HEIGHT)
        .max_inner_size(FLOAT_MAX_WIDTH, FLOAT_MAX_HEIGHT)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
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

#[tauri::command]
fn resize_pet_window(app: AppHandle, size: f64) {
    if let Some(win) = app.get_webview_window("pet") {
        let next = size.round().clamp(MIN_PET_SIZE, MAX_PET_SIZE);
        let _ = win.set_size(tauri::LogicalSize::new(next, next));
    }
}

#[tauri::command]
fn pet_visibility_get(app: AppHandle) -> bool {
    app
        .get_webview_window("pet")
        .and_then(|win| win.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn pet_visibility_set(app: AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window("pet") {
        if visible {
            let _ = win.show();
        } else {
            let _ = win.hide();
        }
    }
}

#[derive(serde::Serialize)]
struct LlmDebugTestResult {
    ok: bool,
    message: String,
}

#[tauri::command]
fn llm_debug_test(base_url: String, api_key: Option<String>, model: String) -> Result<LlmDebugTestResult, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    let model = model.trim();
    let api_key = api_key.unwrap_or_default();
    let api_key = api_key.trim();

    if base_url.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    if model.is_empty() {
        return Err("Model 不能为空".to_string());
    }
    if api_key.is_empty() {
        return Err("请输入 API Key 后再测试连接".to_string());
    }

    let url = format!("{base_url}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "ping" }],
        "stream": false,
        "max_tokens": 8
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("连接测试初始化失败：{e}"))?;
    let res = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|e| format!("连接失败：{e}"))?;
    let status = res.status();
    if status.is_success() {
        Ok(LlmDebugTestResult { ok: true, message: "连接成功".to_string() })
    } else {
        let text = res.text().unwrap_or_default();
        let detail = text.chars().take(140).collect::<String>();
        Err(format!("连接失败：HTTP {status} {detail}"))
    }
}

#[tauri::command]
fn show_pet_menu(app: AppHandle, window: tauri::WebviewWindow) {
    let Ok(home) = MenuItem::with_id(&app, "pet_menu_home", "首页", true, None::<&str>) else { return };
    let Ok(pet_data) = MenuItem::with_id(&app, "pet_menu_pet_data", "宠物数据", true, None::<&str>) else { return };
    let Ok(chat) = MenuItem::with_id(&app, "pet_menu_chat", "对话记录", true, None::<&str>) else { return };
    let Ok(reminders) = MenuItem::with_id(&app, "pet_menu_reminders", "提醒事项", true, None::<&str>) else { return };
    let Ok(settings) = MenuItem::with_id(&app, "pet_menu_settings", "设置中心", true, None::<&str>) else { return };
    let Ok(separator_one) = PredefinedMenuItem::separator(&app) else { return };
    let Ok(hide) = MenuItem::with_id(&app, "pet_menu_hide", "隐藏桌宠", true, None::<&str>) else { return };
    let Ok(quit) = MenuItem::with_id(&app, "pet_menu_quit", "退出", true, None::<&str>) else { return };
    let Ok(menu) = Menu::with_items(&app, &[
        &home,
        &pet_data,
        &chat,
        &reminders,
        &settings,
        &separator_one,
        &hide,
        &quit,
    ]) else {
        return;
    };

    if let Err(e) = window.popup_menu(&menu) {
        log::warn!("[pet_menu] 弹出桌宠右键菜单失败: {e:?}");
    }
}

pub(crate) fn show_panel(app: &AppHandle, route: &str) {
    open_panel(app.clone(), Some(route.to_string()));
}

fn normalize_panel_route(route: &str) -> &str {
    match route {
        "" | "home" | "panel" => "",
        "petData" | "pet-data" => "data",
        "history" | "conversation" | "conversations" => "chat",
        "tasks" => "reminders",
        other => other,
    }
}

fn handle_pet_menu_event(app: &AppHandle, id: &str) {
    match id {
        "pet_menu_chat" => show_panel(app, "chat"),
        "pet_menu_home" => show_panel(app, "panel"),
        "pet_menu_pet_data" => show_panel(app, "data"),
        "pet_menu_reminders" => show_panel(app, "reminders"),
        "pet_menu_settings" => show_panel(app, "settings"),
        "pet_menu_hide" => crate::pet_window::hide(app),
        "pet_menu_quit" => app.exit(0),
        _ => {}
    }
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
            close_float_chat,
            resize_pet_window,
            pet_visibility_get,
            pet_visibility_set,
            llm_debug_test,
            show_pet_menu
        ])
        .on_menu_event(|app, event| handle_pet_menu_event(app, event.id.as_ref()))
        .setup(|app| {
            bridge::spawn_sidecar(app.handle().clone());
            pet_window::create(app.handle())?;
            tray::create(app.handle())?;
            macos::start_reporters(app.handle().clone());
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
            // 宠物窗可变大小（第四轮），取实际宽度而非当初的固定 180
            let pet_w = pet
                .outer_size()
                .map(|s| s.width as i32)
                .unwrap_or_else(|_| (180.0 * scale).round() as i32);
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
