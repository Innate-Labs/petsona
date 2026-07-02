// 悬浮宠物窗口：NSPanel nonactivating + 透明 + 置顶 + 可拖（§2.1 硬约束，objc 桥经 tauri-nspanel）

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
use tauri_nspanel::WebviewWindowExt;

// NSWindowStyleMaskNonactivatingPanel——点击宠物不抢当前 App 焦点（"不抢焦点"验收项）
const NONACTIVATING_PANEL: i32 = 1 << 7;
// NSMainMenuWindowLevel + 1：压过普通窗口，低于系统弹层
const PANEL_LEVEL: i32 = 25;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html#/pet".into()))
        .title("Petsona")
        .inner_size(180.0, 200.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .accept_first_mouse(true)
        .build()?;

    // 初始位置：主屏右下角（PET_MOVED 的持久化位置恢复 M1 后补，SPEC-GAP）
    if let Some(monitor) = win.primary_monitor()? {
        let size = monitor.size();
        let _ = win.set_position(tauri::PhysicalPosition::new(
            size.width as i32 - 260,
            size.height as i32 - 320,
        ));
    }

    // 转 NSPanel：nonactivating + 全空间跟随；不加 FullScreenAuxiliary → 全屏 App 时自动不可见（§4 约束）
    match win.to_panel() {
        Ok(panel) => {
            panel.set_style_mask(NONACTIVATING_PANEL);
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
