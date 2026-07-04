#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
PANEL_URL="http://localhost:5173/#/panel"
PET_URL="http://localhost:5173/#/pet"
FLOAT_URL="http://localhost:5173/#/float"

cd "$PROJECT_DIR"

echo "Petsona 前端预览启动器"
echo "项目目录：$PROJECT_DIR"
echo

if curl -fsS "http://localhost:5173/" >/dev/null 2>&1; then
  echo "检测到 5173 端口已经有预览服务，直接打开页面。"
  open "$PANEL_URL"
  echo
  echo "面板预览：$PANEL_URL"
  echo "桌宠预览：$PET_URL"
  echo "浮窗预览：$FLOAT_URL"
  echo
  echo "可以关闭这个窗口。"
  exit 0
fi

echo "正在启动前端预览服务..."
echo "首次启动如果需要安装/校验依赖，可能会多等一会。"
echo
echo "面板预览：$PANEL_URL"
echo "桌宠预览：$PET_URL"
echo "浮窗预览：$FLOAT_URL"
echo
echo "服务启动后会自动打开面板预览。要停止服务，请回到这个窗口按 Ctrl+C。"
echo

(
  for _ in {1..60}; do
    if curl -fsS "http://localhost:5173/" >/dev/null 2>&1; then
      open "$PANEL_URL"
      exit 0
    fi
    sleep 0.5
  done
) &

corepack pnpm --filter @petsona/shell dev -- --host 127.0.0.1
