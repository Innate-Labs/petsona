// 启动、sidecar 拉起 + watchdog、单实例锁（M1 骨架：先保证编译预热，模块随 Phase 4 填充）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    petsona_shell::run()
}
