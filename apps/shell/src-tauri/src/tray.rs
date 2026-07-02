// 菜单栏常驻：开关桌宠 / 打开面板 / 退出（§2.2 tray.rs）

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle_pet = MenuItem::with_id(app, "toggle_pet", "开关桌宠", true, None::<&str>)?;
    let open_panel = MenuItem::with_id(app, "open_panel", "打开面板", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_pet, &open_panel, &quit])?;

    TrayIconBuilder::with_id("petsona-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_pet" => crate::pet_window::toggle(app),
            "open_panel" => crate::show_panel(app, "panel"),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
