// 壳入口：单实例锁 + 窗口/托盘/sidecar 装配（Phase 4 填充各模块）

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // 单实例锁：二次启动只唤起已存在实例（M1：无操作占位）
        }))
        .run(tauri::generate_context!())
        .expect("petsona shell 启动失败");
}
