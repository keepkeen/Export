#!/usr/bin/env python3
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "PROJECT_OVERVIEW.txt"
EXCLUDE_DIRS = {'.git', 'dist', 'certs', '.trash', '.DS_Store', '__pycache__'}
SKIP_PATH_PREFIXES = [
    ('vendor',),
    ('vendor', 'fonts')
]
SKIP_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}

PROJECT_DESCRIPTION = """ChatGPT Conversation Exporter 是一个面向 Chrome / Edge 的 MV3 扩展，提供漂浮式快捷按钮和可吸附侧边栏，帮助用户在 ChatGPT 网页端快速选择聊天轮次并导出多种格式（Text/Markdown/Word/HTML/JSON/Excel/CSV/PDF/Screenshot），并保留图片、附件、LaTeX 公式和自定义命名。"""

ARCHITECTURE = """核心架构:
1. manifest.json —— MV3 配置，声明权限、入口、content script、service worker 与图标。
2. src/content-script.js —— 主 UI 与业务逻辑：漂浮按钮、拖拽吸附、侧边面板、对话解析、导出实现、截图/PDF 渲染，以及文件命名自定义等设置。
3. src/styles.css —— 玻璃态面板与按钮动画样式，包括“探头”动画和响应式细节。
4. src/service-worker.js —— 后台 service worker，负责 contextMenus、快捷键、action 按钮、Downloads API 下载权限及消息转发。
5. scripts/* —— 辅助脚本（生成图标、打包 CRX、导出项目概览等）。
6. README.md —— 使用说明、打包步骤、格式特性描述。
"""


def build_tree(base: Path, prefix: str = '') -> str:
    entries = []
    for p in sorted(base.iterdir(), key=lambda p: p.name.lower()):
        if p.name in EXCLUDE_DIRS:
            continue
        rel_parts = p.relative_to(ROOT).parts
        skip = False
        for skip_prefix in SKIP_PATH_PREFIXES:
            if rel_parts[:len(skip_prefix)] == skip_prefix:
                skip = True
                break
        if skip:
            continue
        entries.append(p)
    lines = []
    for index, entry in enumerate(entries):
        connector = '└── ' if index == len(entries) - 1 else '├── '
        line = f"{prefix}{connector}{entry.name}"
        lines.append(line)
        if entry.is_dir():
            extension = '    ' if index == len(entries) - 1 else '│   '
            subtree = build_tree(entry, prefix + extension)
            if subtree:
                lines.append(subtree)
    return '\n'.join(lines)


def gather_files(base: Path):
    files = []
    for path in sorted(base.rglob('*')):
        if path.is_dir():
            continue
        rel_parts = path.relative_to(base).parts
        if any(part in EXCLUDE_DIRS for part in rel_parts):
            continue
        if path.suffix.lower() in SKIP_EXTS:
            continue
        skip = False
        for skip_prefix in SKIP_PATH_PREFIXES:
            if rel_parts[:len(skip_prefix)] == skip_prefix:
                skip = True
                break
        if skip:
            continue
        files.append(path)
    return files


def main():
    tree = build_tree(ROOT)
    files = gather_files(ROOT)
    with OUTPUT.open('w', encoding='utf-8') as f:
        f.write('=== 项目简介 ===\n' + PROJECT_DESCRIPTION.strip() + '\n\n')
        f.write('=== 架构说明 ===\n' + ARCHITECTURE.strip() + '\n\n')
        f.write('=== 文件树（排除 dist/certs/.git 等） ===\n')
        f.write(tree + '\n\n')
        f.write('=== 文件内容 ===\n')
        for path in files:
            rel = path.relative_to(ROOT)
            f.write(f"--- {rel} ---\n")
            try:
                text = path.read_text(encoding='utf-8', errors='replace')
            except Exception as exc:
                text = f"<无法读取: {exc}>"
            f.write(text.rstrip() + '\n\n')
    print(f'Wrote {OUTPUT}')


if __name__ == '__main__':
    main()
