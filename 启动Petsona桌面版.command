#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"
export PATH="$PROJECT_DIR/scripts:$PATH"
export PETSONA_GATEWAY_URL="http://127.0.0.1:8787"
GATEWAY_URL="http://127.0.0.1:8787/healthz"
GATEWAY_PID=""
GATEWAY_LOG="$PROJECT_DIR/.petsona-gateway.log"

cleanup() {
  if [[ -n "${GATEWAY_PID:-}" ]] && kill -0 "$GATEWAY_PID" >/dev/null 2>&1; then
    echo
    echo "正在关闭本次启动的 Petsona 网关..."
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    GATEWAY_PID=""
  fi
}
trap cleanup EXIT INT TERM

echo "Petsona 桌面版启动器"
echo "项目目录：$PROJECT_DIR"
echo

if [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  echo "还不能启动桌面版：当前系统没有找到 Rust/cargo。"
  echo
  echo "Tauri 桌面壳需要 Rust 工具链；浏览器预览不需要，所以你刚才能打开网页预览。"
  echo
  echo "安装 Rust 后，再双击这个文件即可启动真正的 macOS 桌面应用预览。"
  echo "Rust 官方安装页：https://www.rust-lang.org/tools/install"
  echo
  echo "如果你希望我直接帮你安装 Rust，回到 Codex 里说「帮我安装 Rust」。"
  echo
  read "?按回车关闭..."
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "还不能启动桌面版：没有找到 corepack。"
  echo "请先确认 Node.js 安装完整。"
  echo
  read "?按回车关闭..."
  exit 1
fi

echo "正在同步 Petsona 运行时代码..."
corepack pnpm --filter @petsona/shared build
corepack pnpm --filter @petsona/harness build
echo "运行时代码已同步。"
echo

if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "检测到 5173 端口已有前端预览服务。"
  echo "Tauri dev 会自己启动前端服务，所以请先关闭之前的「前端预览」窗口，或者在那个终端里按 Ctrl+C。"
  echo
  echo "端口占用信息："
  lsof -nP -iTCP:5173 -sTCP:LISTEN || true
  echo
  read "?处理完端口占用后，按回车继续尝试启动桌面版..."
fi

if curl -fsS "$GATEWAY_URL" >/dev/null 2>&1; then
  echo "检测到本地 Petsona 网关已运行：$PETSONA_GATEWAY_URL"
else
  echo "正在启动本地 Petsona 网关：$PETSONA_GATEWAY_URL"
  echo "网关日志：$GATEWAY_LOG"
  corepack pnpm dev:gateway >"$GATEWAY_LOG" 2>&1 &
  GATEWAY_PID=$!

  for _ in {1..60}; do
    if curl -fsS "$GATEWAY_URL" >/dev/null 2>&1; then
      echo "本地 Petsona 网关已就绪。"
      break
    fi
    if ! kill -0 "$GATEWAY_PID" >/dev/null 2>&1; then
      echo "Petsona 网关启动失败，最近日志如下："
      tail -n 40 "$GATEWAY_LOG" || true
      echo
      read "?按回车关闭..."
      exit 1
    fi
    sleep 0.5
  done

  if ! curl -fsS "$GATEWAY_URL" >/dev/null 2>&1; then
    echo "Petsona 网关等待超时，最近日志如下："
    tail -n 40 "$GATEWAY_LOG" || true
    echo
    read "?按回车关闭..."
    exit 1
  fi
fi

echo "正在启动 Tauri 桌面版预览..."
echo "首次启动会编译 Rust，可能需要几分钟。"
echo "要停止桌面版，请回到这个窗口按 Ctrl+C。"
echo

corepack pnpm --filter @petsona/shell tauri:dev
