// 菜单栏常驻：页面入口 / 桌宠开关 / 退出（§2.2 tray.rs）

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let home = MenuItem::with_id(app, "tray_home", "首页", true, None::<&str>)?;
    let pet_data = MenuItem::with_id(app, "tray_pet_data", "宠物数据", true, None::<&str>)?;
    let history = MenuItem::with_id(app, "tray_history", "对话记录", true, None::<&str>)?;
    let reminders = MenuItem::with_id(app, "tray_reminders", "提醒事项", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "tray_settings", "设置中心", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let toggle_pet = MenuItem::with_id(app, "tray_toggle_pet", "桌宠开关", true, None::<&str>)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[
        &home,
        &pet_data,
        &history,
        &reminders,
        &settings,
        &separator_one,
        &toggle_pet,
        &separator_two,
        &quit,
    ])?;

    TrayIconBuilder::with_id("petsona-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_home" => crate::show_panel(app, "panel"),
            "tray_pet_data" => crate::show_panel(app, "data"),
            "tray_history" => crate::show_panel(app, "chat"),
            "tray_reminders" => crate::show_panel(app, "reminders"),
            "tray_settings" => crate::show_panel(app, "settings"),
            "tray_toggle_pet" => crate::pet_window::toggle(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
