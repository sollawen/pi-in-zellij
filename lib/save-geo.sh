#!/bin/sh
# save-geo.sh — 在浮动 pane 内执行，保存当前 pane 坐标到 geometryFile
# 用法: sh save-geo.sh <geometryKey>
#
# 依赖: awk（提取表格列）
#       ZELLIJ_PANE_ID 环境变量（zellij 自动注入，精确标识当前 pane）

KEY=$1
GEOFILE="$HOME/.pi/tmp/zellij-geometry"

# 从 current-tab-info 获取 viewport 尺寸
TAB=$(zellij action current-tab-info -j)
TAB_W=$(echo "$TAB" | grep viewport_columns | head -1 | grep -o '[0-9]*')
TAB_H=$(echo "$TAB" | grep viewport_rows | head -1 | grep -o '[0-9]*')

# 用 ZELLIJ_PANE_ID 精确匹配当前 pane（不依赖 focus 状态）
CURR_PANE_ID=$ZELLIJ_PANE_ID

# 从 list-panes 表格中找当前 pane，提取坐标
# 注意：PANE_ID 格式为 {type}_{id}，如 terminal_8、plugin_0，而 ZELLIJ_PANE_ID=8
PANE=$(zellij action list-panes -s -g | awk -v tw="$TAB_W" -v th="$TAB_H" -v pid="$CURR_PANE_ID" '
  $1 ~ ("terminal_" pid) || $1 ~ ("plugin_" pid) {
    x = int($(NF-3) * 100 / tw + 0.5)
    y = int($(NF-2) * 100 / th + 0.5)
    w = int($NF * 100 / tw + 0.5)
    h = int($(NF-1) * 100 / th + 0.5)
    printf "x:%d, y:%d, w:%d, h:%d", x, y, w, h
    exit
  }
')

if [ -z "$PANE" ]; then exit 0; fi

# 读写 geometryFile（行格式：[key] x:N, y:N, w:N, h:N）
mkdir -p "$(dirname "$GEOFILE")"
if [ -f "$GEOFILE" ] && grep -q "^\[$KEY\]" "$GEOFILE" 2>/dev/null; then
  # 已有 key，整行替换
  sed -i.bak "s/^\[$KEY\].*/[$KEY] $PANE/" "$GEOFILE" && rm -f "$GEOFILE.bak"
else
  # 追加新行
  echo "[$KEY] $PANE" >> "$GEOFILE"
fi
