// macOS 系统桥：空闲/全屏检测 + 系统权限状态（SH→H 上报，§3.1 系统类消息）

pub mod idle;
pub mod permissions;

use crate::bridge::{send_line, SidecarState};
use tauri::{AppHandle, Manager};

/// 每 60s 上报 SYS_IDLE_STATE + SYS_PERMISSION_STATE（p01/p02 输入）
pub fn start_reporters(app: AppHandle) {
    std::thread::spawn(move || {
        let mut seq: u64 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            seq += 1;
            let state = app.state::<SidecarState>();

            let idle_min = idle::idle_minutes();
            let fullscreen = idle::frontmost_fullscreen();
            let idle_env = format!(
                r#"{{"v":1,"id":"sh-idle-{seq}","kind":"event","type":"SYS_IDLE_STATE","payload":{{"idleMinutes":{idle_min},"fullscreen":{fullscreen}}}}}"#
            );
            let _ = send_line(&state, &idle_env);

            let (ax, sr) = (permissions::accessibility(), permissions::screen_recording());
            let perm_env = format!(
                r#"{{"v":1,"id":"sh-perm-{seq}","kind":"event","type":"SYS_PERMISSION_STATE","payload":{{"accessibility":{ax},"screenRecording":{sr},"automation":{{}}}}}}"#
            );
            let _ = send_line(&state, &perm_env);
        }
    });
}
