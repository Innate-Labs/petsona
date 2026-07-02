// WebView⇄sidecar NDJSON relay（壳不解析业务，只转发行——§2.2 bridge.rs 职责）
// sidecar 拉起 + watchdog：崩溃 ≤5s 重启（§2.1 硬约束）

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct SidecarState {
    stdin: Mutex<Option<std::process::ChildStdin>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self { stdin: Mutex::new(None) }
    }
}

/// UI → sidecar：一行一个 Envelope
#[tauri::command]
pub fn ipc_send(state: State<'_, SidecarState>, line: String) -> Result<(), String> {
    send_line(&state, &line)
}

/// Rust 侧（idle/权限上报）也走同一入口
pub fn send_line(state: &SidecarState, line: &str) -> Result<(), String> {
    let mut guard = state.stdin.lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(stdin) => {
            let mut buf = line.trim_end().to_string();
            buf.push('\n');
            stdin.write_all(buf.as_bytes()).map_err(|e| {
                // 写失败 = sidecar 掉了，watchdog 会拉起；这里只报告
                format!("sidecar stdin 写失败: {e}")
            })
        }
        None => Err("SIDECAR_DOWN".into()),
    }
}

/// 拉起 sidecar + watchdog 循环（后台线程）
pub fn spawn_sidecar(app: AppHandle) {
    std::thread::spawn(move || {
        let mut restarts: u32 = 0;
        loop {
            match launch(&app) {
                Ok(mut child) => {
                    restarts = 0;
                    let status = child.wait();
                    log::warn!("[watchdog] sidecar 退出: {:?}", status);
                    // 通知 UI 一次轻提示（§6 可靠性：至多一次轻提示）
                    let _ = app.emit("sidecar-status", "restarting");
                }
                Err(e) => {
                    log::error!("[watchdog] sidecar 启动失败: {e}");
                    restarts += 1;
                }
            }
            // ≤5s 拉起；连续失败退避（1s→5s 封顶）
            let delay = Duration::from_millis(1000_u64.saturating_mul(restarts.min(5).max(1) as u64));
            std::thread::sleep(delay);
        }
    });
}

fn launch(app: &AppHandle) -> Result<Child, String> {
    let (program, args) = resolve_command();
    log::info!("[watchdog] 启动 sidecar: {program} {args:?}");
    let mut child = Command::new(&program)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .env("PETSONA_GATEWAY_URL", std::env::var("PETSONA_GATEWAY_URL").unwrap_or_default())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdin = child.stdin.take().ok_or("无 stdin")?;
    let stdout = child.stdout.take().ok_or("无 stdout")?;

    *app.state::<SidecarState>().stdin.lock().unwrap() = Some(stdin);

    // 读线程：sidecar stdout 每行 → 广播给所有 WebView（不解析）
    let reader_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    let _ = reader_app.emit("harness-envelope", l);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    Ok(child)
}

/// dev：node + harness dist；打包后：PETSONA_HARNESS_CMD 指向 sidecar 二进制
/// SPEC-GAP: M1 dev 用 node 直跑，sidecar 独立二进制打包留到发布流程
fn resolve_command() -> (String, Vec<String>) {
    if let Ok(cmd) = std::env::var("PETSONA_HARNESS_CMD") {
        let mut parts = cmd.split_whitespace().map(String::from).collect::<Vec<_>>();
        if !parts.is_empty() {
            let program = parts.remove(0);
            return (program, parts);
        }
    }
    // 从 src-tauri 向上找 monorepo 内 harness 产物
    let here = std::env::current_dir().unwrap_or_default();
    for anc in here.ancestors() {
        let candidate = anc.join("packages/harness/dist/main.js");
        if candidate.exists() {
            return ("node".into(), vec![candidate.to_string_lossy().into()]);
        }
    }
    ("node".into(), vec!["packages/harness/dist/main.js".into()])
}
