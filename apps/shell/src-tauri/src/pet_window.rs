// 悬浮宠物窗口：NSPanel nonactivating + 透明 + 置顶 + 可拖（§2.1 硬约束，objc 桥经 tauri-nspanel）

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
use tauri_nspanel::WebviewWindowExt;

// NSWindowStyleMaskNonactivatingPanel——点击宠物不抢当前 App 焦点（"不抢焦点"验收项）
const NONACTIVATING_PANEL: i32 = 1 << 7;
// NSWindowStyleMaskResizable——无边框窗口也能从边缘拖拽改大小（第四轮验收：桌宠可变大小）
const RESIZABLE: i32 = 1 << 3;
// NSMainMenuWindowLevel + 1：压过普通窗口，低于系统弹层
const PANEL_LEVEL: i32 = 25;
// SPEC-GAP: 规格只定义 PET_MOVED 消息，未定义壳层窗口位置存储位置；先落 Tauri app data。
const PET_WINDOW_STATE_FILE: &str = "pet-window.json";

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
struct PetWindowState {
    x: i32,
    y: i32,
    // 尺寸后加（第四轮），旧 pet-window.json 没有这两个字段 → None 用默认尺寸
    #[serde(default)]
    w: Option<u32>,
    #[serde(default)]
    h: Option<u32>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html#/pet".into()))
        .title("Petsona")
        .inner_size(180.0, 200.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .min_inner_size(120.0, 140.0)
        .max_inner_size(640.0, 700.0)
        .accept_first_mouse(true)
        .build()?;

    place_pet_window(app, &win)?;
    watch_pet_window(app, &win);

    // 转 NSPanel：nonactivating + 全空间跟随；不加 FullScreenAuxiliary → 全屏 App 时自动不可见（§4 约束）
    match win.to_panel() {
        Ok(panel) => {
            // RESIZABLE 必须并进 style mask：to_panel 整体覆盖 mask，漏掉就丢边缘拖拽
            panel.set_style_mask(NONACTIVATING_PANEL | RESIZABLE);
            panel.set_level(PANEL_LEVEL);
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
            );
            panel.set_hides_on_deactivate(false);
            panel.set_becomes_key_only_if_needed(true);
            panel.show();
        }
        Err(e) => {
            // NSPanel 桥失败降级为普通置顶窗口（功能不丢，SPEC-GAP 标注风险）
            log::error!("[pet_window] to_panel 失败，降级普通窗口: {e:?}");
        }
    }
    Ok(())
}

/// 托盘「开关桌宠」
pub fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("pet") {
        let visible = win.is_visible().unwrap_or(false);
        if visible { let _ = win.hide(); } else { let _ = win.show(); }
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("pet") {
        let _ = win.hide();
    }
}

fn place_pet_window(app: &AppHandle, win: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(state) = read_pet_window_state(app) {
        // 尺寸先于位置恢复：位置校验（state_on_monitor）用的是左上角坐标，与尺寸无耦合
        if let (Some(w), Some(h)) = (state.w, state.h) {
            let _ = win.set_size(tauri::PhysicalSize::new(w, h));
        }
        let monitors = win.available_monitors()?;
        if monitors.iter().any(|monitor| state_on_monitor(state, monitor)) {
            let _ = win.set_position(tauri::PhysicalPosition::new(state.x, state.y));
            return Ok(());
        }
    }

    // 默认右下角：monitor.size() 是物理像素，窗口尺寸/边距按逻辑点算——必须除以 scale，否则 Retina 上偏出屏幕
    if let Some(monitor) = win.primary_monitor()? {
        let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
        let _ = win.set_position(tauri::LogicalPosition::new(
            logical.width - 260.0,
            logical.height - 320.0,
        ));
    }
    Ok(())
}

fn watch_pet_window(app: &AppHandle, win: &tauri::WebviewWindow) {
    let app = app.clone();
    let state_path = Arc::new(pet_window_state_path(&app));
    let probe = win.clone();
    win.on_window_event(move |event| {
        // Moved/Resized 都全量落一次位置+尺寸：事件本身只带单侧数据，直接查窗口拿完整状态
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            if let (Ok(pos), Ok(size)) = (probe.outer_position(), probe.inner_size()) {
                write_pet_window_state(
                    &state_path,
                    PetWindowState { x: pos.x, y: pos.y, w: Some(size.width), h: Some(size.height) },
                );
            }
        }
    });
}

fn read_pet_window_state(app: &AppHandle) -> Option<PetWindowState> {
    let path = pet_window_state_path(app);
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_pet_window_state(path: &PathBuf, state: PetWindowState) {
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            log::warn!("[pet_window] 创建状态目录失败: {e}");
            return;
        }
    }
    match serde_json::to_vec_pretty(&state) {
        Ok(bytes) => {
            if let Err(e) = fs::write(path, bytes) {
                log::warn!("[pet_window] 保存窗口位置失败: {e}");
            }
        }
        Err(e) => log::warn!("[pet_window] 序列化窗口位置失败: {e}"),
    }
}

fn pet_window_state_path(app: &AppHandle) -> PathBuf {
    app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("Petsona"))
        .join(PET_WINDOW_STATE_FILE)
}

fn state_on_monitor(state: PetWindowState, monitor: &tauri::Monitor) -> bool {
    let origin = monitor.position();
    let size = monitor.size();
    let x = state.x;
    let y = state.y;
    x >= origin.x
        && y >= origin.y
        && x < origin.x + size.width as i32
        && y < origin.y + size.height as i32
}
