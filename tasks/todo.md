# Todo

## Goal
- 扫描并确认当前项目功能实现入口。
- 去掉“站点结构变化，已启用降级导出模式”这类浏览器内提示。
- 新增 ChatGPT 公式悬浮一键复制 LaTeX，复制成功时在公式旁显示提示。

## Plan
- [x] 盘点当前实现：导出流程、提示系统、公式提取逻辑及样式注入入口。
- [x] 移除/禁用降级导出提示触发（不影响 fallback 解析本身）。
- [x] 在 ChatGPT 页面识别公式节点（KaTeX），注入可点击复制入口。
- [x] 实现复制逻辑：优先 `navigator.clipboard.writeText`，失败回退 `execCommand('copy')`。
- [x] 实现公式旁提示（toast/bubble），并处理重复注入、DOM 变化与清理。
- [x] 运行基础验证（语法检查 + 关键字符串回归检查），记录结果。

## Acceptance
- [x] 导出降级模式仍可用，但不再弹“结构变化/降级导出”提示。
- [x] ChatGPT 中公式鼠标靠近可见复制入口，点击一次复制对应 LaTeX。
- [x] 复制成功时公式旁出现短暂提示，不阻塞原页面交互。

## Review
- 变更文件：
  - `src/content-script.js`
  - `src/styles.css`
  - `.gitignore`
  - `README.md`
  - `LICENSE`
  - `tasks/lessons.md`
- 关键实现：
  - 删除 fallback 模式提示 `showToast('站点结构发生变化，已启用降级导出模式')`，保留解析降级逻辑。
  - 新增 ChatGPT 公式复制支持：为 `.katex` / `.katex-display` 注入可点击复制目标，支持键盘触发。
  - 新增 LaTeX 复制实现：`navigator.clipboard.writeText` 优先，失败回退 `document.execCommand('copy')`。
  - 新增公式旁侧提示气泡，自动定位并自动消失。
  - 导出快照中移除公式复制辅助 UI，避免污染导出内容。
- 验证结果：
  - `node --check src/content-script.js` 通过。
  - `node --check src/service-worker.js` 通过。
  - 关键字符串回归检查确认：降级提示字符串已移除，公式复制样式/逻辑存在。
  - 已在项目目录初始化独立 Git 仓库并配置远端 `https://github.com/keepkeen/Export.git`。

---

## Iteration 2 Goal
- 解决复制出的 LaTeX 被换行的问题。
- 参考 `gemini-voyager` 的公式识别与复制实现，迁移到 ChatGPT 页面。
- 在当前项目中以“职责分离、便于维护”的方式落地公式复制模块与设置项。

## Iteration 2 Plan
- [x] 盘点 `gemini-voyager` 公式复制实现与可迁移功能清单。
- [x] 将公式复制逻辑从 `content-script.js` 抽离为独立模块（识别/复制/提示/格式）。
- [x] 迁移并适配复制格式能力：`LaTeX` / `LaTeX(无$)` / `MathML(Word)`.
- [x] 修复 LaTeX 源码换行：规范化 annotation 文本，避免复制结果硬换行。
- [x] 接入现有侧边面板配置并持久化存储。
- [x] 完成语法检查与关键行为验证，更新 review。

## Iteration 2 Acceptance
- [x] ChatGPT 中公式点击复制后，LaTeX 不再出现异常换行。
- [x] 支持切换复制格式（LaTeX / 无$ / MathML），并能持久化。
- [x] 公式复制功能代码独立成模块，`content-script.js` 仅负责装配调用。

## Iteration 2 Review
- 参考实现来源：
  - `gemini-voyager/src/features/formulaCopy/FormulaCopyService.ts`
  - `gemini-voyager/public/contentStyle.css`（公式 hover + toast 样式）
- 新增模块：
  - `src/formula-copy-feature.js`
  - 采用服务化封装：识别、提取、格式化、复制、提示、DOM 观察独立在模块内。
- 迁移能力：
  - 公式自动识别（`.katex-display`、`.katex`）。
  - 复制格式：LaTeX / LaTeX(无$) / MathML(Word)。
  - 剪贴板策略：`ClipboardItem`（含 `text/html`/`application/mathml+xml`）优先，失败回退。
  - 复制结果提示：公式旁 toast，成功/失败分态。
- 换行修复：
  - 引入 `normalizeLatexSource`，对 annotation 源码做空白与换行归一化，避免复制结果被硬换行。
- 配置集成：
  - 面板新增“公式复制格式”区块，写入 `ced-formula-copy-format` 并实时同步模块。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/formula-copy-feature.js`
  - `node --check src/service-worker.js`

---

## Iteration 3 Goal
- 先迁移 `gemini-voyager` 的 timeline 能力到 ChatGPT 页面。
- 保持代码职责分离，timeline 作为独立模块接入当前扩展。

## Iteration 3 Plan
- [x] 盘点 `gemini-voyager` timeline 核心能力（标记点、预览、跳转、滚动高亮）。
- [x] 新建独立 `timeline-feature` 模块，封装 UI/交互/滚动同步逻辑。
- [x] 接入 `content-script` 装配层与配置持久化（面板开关 + storage）。
- [x] 适配导出链路，确保 timeline UI 不进入解析/导出内容。
- [x] 完成语法检查与关键字符串回归。

## Iteration 3 Acceptance
- [x] ChatGPT 页面出现左侧时间轴，点击标记可跳转到对应轮次。
- [x] 时间轴当前标记会随滚动位置更新高亮。
- [x] 面板可开关 timeline，配置持久化。
- [x] 时间轴元素不会被导出到 HTML/PDF/截图等结果中。

## Iteration 3 Review
- 新增模块：
  - `src/timeline-feature.js`
  - 独立封装：标记收集、轨道渲染、点击跳转、滚动高亮、悬浮提示、URL 变化刷新。
- 装配改动：
  - `manifest.json` 注入 `src/timeline-feature.js`
  - `src/content-script.js` 新增 timeline 初始化、配置同步、面板开关和 storage key。
- 样式改动：
  - `src/styles.css` 新增 timeline bar/dot/tooltip 与面板开关样式。
- 导出隔离：
  - 在解析过滤、快照克隆与内嵌导出样式中排除 `.ced-timeline-bar` / `.ced-timeline-tooltip`。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/formula-copy-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）
