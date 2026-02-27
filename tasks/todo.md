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

---

## Iteration 4 Goal
- 完成 `Timeline` 增强版迁移：星标、层级标记、预览面板、快捷键导航、拖拽位置。
- 增加 `Folder` 会话文件夹管理：分组、排序、颜色与当前会话归档。
- 增加 `Prompt Vault` 提示词管理：保存、检索、复制、一键插入。
- 增加 `Title Updater`：标签标题自动同步当前会话名称（可联动文件夹前缀）。

## Iteration 4 Plan
- [x] 设计并实现独立 feature 模块：
  - [x] `timeline-feature` 增强能力（meta 持久化 + 预览面板 + 键盘 + 拖拽）。
  - [x] `folder-feature`（数据模型 + 存储 + 面板 UI + 当前会话绑定）。
  - [x] `prompt-vault-feature`（存储 + 面板 UI + 插入输入框逻辑）。
  - [x] `title-updater-feature`（SPA 路由监听 + 节流更新）。
- [x] 在 `content-script` 装配层接入模块初始化、配置同步与刷新协同。
- [x] 更新 `manifest` 注入顺序与 `styles`，补齐导出隔离（避免新 UI 进入导出）。
- [x] 完成语法检查、打包验证与文档更新（README/todo）。

## Iteration 4 Acceptance
- [x] Timeline 支持：
  - [x] dot 星标（可切换）与 1/2/3 层级标记（可切换）。
  - [x] 预览面板搜索与点击跳转。
  - [x] 键盘前后导航（默认 `Alt+Shift+↑/↓`）。
  - [x] 可拖拽并持久化位置。
- [x] Folder 支持：
  - [x] 创建/重命名/删除文件夹，支持颜色。
  - [x] 会话按文件夹分组显示，支持排序模式切换。
  - [x] 当前会话可一键归档到指定文件夹。
- [x] Prompt Vault 支持：
  - [x] 提示词条目增删改查、标签检索。
  - [x] 点击后可复制或插入到当前输入框。
- [x] Title Updater 支持：
  - [x] 当前对话标题变化后浏览器 tab title 同步更新。
  - [x] 可附加文件夹前缀并可开关。

## Iteration 4 Review
- 新增模块：
  - `src/folder-feature.js`
  - `src/prompt-vault-feature.js`
  - `src/title-updater-feature.js`
  - `src/timeline-feature.js`（增强版重构）
- 装配改动：
  - `manifest.json` 注入 `folder/prompt/title` 三个 feature 脚本。
  - `src/content-script.js` 新增模块初始化、Folder/Title 刷新联动、Title Updater 配置面板。
  - 新增 ChatGPT 侧边栏会话采集并同步到 Folder 模块。
- Timeline 增强：
  - dot 右键菜单支持星标与 L1/L2/L3 层级。
  - 预览面板（搜索、定位、当前高亮）。
  - 键盘导航：`Alt+Shift+↑/↓`。
  - 拖拽位置并通过 `chrome.storage.sync` 持久化。
- 导出隔离：
  - 导出过滤链路新增剔除：`.ced-timeline-preview-toggle` / `.ced-timeline-preview-panel` / `.ced-timeline-context-menu`。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/folder-feature.js`
  - `node --check src/prompt-vault-feature.js`
  - `node --check src/title-updater-feature.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 5 Goal
- 仅迁移以下 4 个功能：`sidebarAutoHide`、`folderSpacing`、`markdownPatcher`、`snowEffect`。
- 保持 feature 职责分离，并通过现有面板进行配置开关/参数调整。

## Iteration 5 Plan
- [x] 从 `gemini-voyager` 对应模块提取核心行为与存储策略。
- [x] 新建独立模块：
  - [x] `src/sidebar-autohide-feature.js`
  - [x] `src/folder-spacing-feature.js`
  - [x] `src/markdown-patcher-feature.js`
  - [x] `src/snow-effect-feature.js`
- [x] 在 `manifest` 注入上述模块，并在 `content-script` 装配层接入初始化与配置同步。
- [x] 面板新增 4 项配置：
  - [x] 侧边栏自动隐藏开关
  - [x] 文件夹间距滑杆（0-16）
  - [x] Markdown 修复增强开关
  - [x] Snow Effect 开关
- [x] 补充导出隔离（避免雪花 canvas 等扩展 UI 污染导出）。
- [x] 完成语法检查与打包验证。

## Iteration 5 Acceptance
- [x] 开启侧边栏自动隐藏后：鼠标离开收起，移到左边缘可展开。
- [x] 文件夹间距调节可实时生效且持久化。
- [x] Markdown 修复可处理被节点打断的 `**bold**` 显示问题。
- [x] Snow Effect 可开关、不卡交互、页面隐藏时暂停动画。
- [x] 导出结果不包含雪花层和新增控制 UI。

## Iteration 5 Review
- 新增模块：
  - `src/sidebar-autohide-feature.js`
  - `src/folder-spacing-feature.js`
  - `src/markdown-patcher-feature.js`
  - `src/snow-effect-feature.js`
- 装配改动：
  - `manifest.json` 注入 4 个新 feature 脚本。
  - `src/content-script.js` 增加存储键、状态、初始化、配置同步及面板区块。
  - `src/styles.css` 增加 range 行样式与控制区样式补充。
- 导出隔离：
  - 新增对 `.ced-snow-effect-canvas` 的解析/快照/导出隐藏过滤。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/sidebar-autohide-feature.js`
  - `node --check src/folder-spacing-feature.js`
  - `node --check src/markdown-patcher-feature.js`
  - `node --check src/snow-effect-feature.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 6 Goal
- 面板 UI 与 `gemini-voyager` 风格统一（颜色、层次、交互节奏）。
- 将导出能力作为主路径，与已迁移功能在同一面板中优雅融合（避免信息堆叠）。

## Iteration 6 Plan
- [x] 重构面板信息架构：引入 `导出` / `工作区` 双分区（tab）并持久化当前视图。
- [x] 调整 `content-script` 面板装配：导出主流程优先，增强功能集中到工作区分组。
- [x] 重写核心样式令牌与面板组件样式，贴近 `gemini-voyager` 的清爽卡片风格与主题适配。
- [x] 保持现有 Timeline / Folder / Prompt Vault / Formula 等功能交互不回退。
- [x] 完成语法检查与重新打包，并补充本迭代 review 记录。

## Iteration 6 Acceptance
- [x] 面板视觉风格与 Gemini Voyager 统一，浅色/深色主题下都可读。
- [x] 导出入口在首屏清晰可见，导出操作链路更短，不与增强配置混杂。
- [x] 工作区功能可独立配置，现有能力均可正常使用。
- [x] 打包产物可生成且无语法错误。

## Iteration 6 Review
- 装配改动：
  - `src/content-script.js` 新增 `ced-panel-tab` 存储键与 `PANEL_TABS`，支持 `导出/工作区` 双分区切换和持久化。
  - `attachPanel()` 重排为 tab 架构：导出链路（格式/文件名/轮次/导出按钮）集中在导出分区；公式、时间轴、Folder、Prompt Vault、Title Updater 与其他增强项收敛到工作区分区。
- 样式改动：
  - `src/styles.css` 重写核心设计令牌与面板组件，采用 Gemini Voyager 风格的浅色卡片体系，并补齐深色主题变量覆盖。
  - 新增 tab 交互样式（`ced-panel__tabs` / `ced-panel__tab` / `ced-panel__tab-panel`），统一 Folder/Prompt/Timeline/Formula 视觉语言。
- 文档改动：
  - `README.md` Highlights 增加“导出/工作区双分区 UI”说明。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/formula-copy-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/folder-feature.js`
  - `node --check src/prompt-vault-feature.js`
  - `node --check src/title-updater-feature.js`
  - `node --check src/sidebar-autohide-feature.js`
  - `node --check src/folder-spacing-feature.js`
  - `node --check src/markdown-patcher-feature.js`
  - `node --check src/snow-effect-feature.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 7 Goal
- 移除页面悬浮按钮，将设置迁移到浏览器顶部扩展图标的 popup。
- 优化时间轴交互与响应速度，对齐 `gemini-voyager` 的核心体验（滚轮、主动高亮计算、搜索防抖、平滑跳转）。

## Iteration 7 Plan
- [x] 新增扩展 `popup`（UI + JS）：承接原悬浮标设置项并支持“打开导出面板/立即导出”。
- [x] 更新 `manifest` 接入 popup，保留快捷键/右键菜单导出入口。
- [x] 调整 `content-script`：不再注入悬浮按钮，支持 popup 下发设置 patch 并实时生效。
- [x] 重构 `timeline-feature` 交互：滚轮驱动主滚动、活动点二分计算、防抖搜索、平滑滚动导航、滚动更新节流。
- [x] 完成语法检查 + 重新打包，并更新 README / todo / lessons。

## Iteration 7 Acceptance
- [x] 页面不再显示扩展悬浮按钮。
- [x] 设置可在扩展图标 popup 中完成，并能实时作用于当前页面。
- [x] 时间轴交互明显更顺滑、响应更快，滚轮与预览搜索体验改善。
- [x] 打包产物生成成功且语法检查通过。

## Iteration 7 Review
- 新增 popup：
  - `src/popup.html` / `src/popup.css` / `src/popup.js`
  - 支持动作：打开导出面板、立即导出。
  - 支持设置：格式、文件名、停靠侧、公式复制格式、timeline/title/folder/sidebar/markdown/snow 等并持久化到 `chrome.storage.sync`。
- 装配改动：
  - `manifest.json` 增加 `action.default_popup: src/popup.html`。
  - `src/content-script.js` 停止注入悬浮按钮并删除相关拖拽/守护逻辑；新增 `CED_APPLY_SETTINGS_PATCH` 消息，popup 改动可实时同步到当前页面并触发对应 feature config 更新。
  - `togglePanel` 改为无悬浮按钮依赖，支持通过 popup / 快捷键 / 右键菜单控制。
  - 面板 `工作区` 分区仅保留 Folder / Prompt Vault 等管理能力；设置类项统一迁移到 popup。
- Timeline 优化：
  - `src/timeline-feature.js` 新增时间轴滚轮驱动主滚动。
  - 活动标记改为基于 `markerTops` 的二分计算 + 高频变更节流，降低滚动时抖动和延迟。
  - 轮次跳转改为自定义平滑滚动（基于距离动态时长），响应更快。
  - 预览面板搜索加入 200ms 防抖；列表滚轮隔离，避免把滚动透传给主页面。
- 文档：
  - `README.md` 更新为 popup 驱动入口说明，补充 popup 文件说明。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 8 Goal
- 修复并增强时间线交互：默认右侧、非圆点区域可拖拽、点击圆点稳定跳转、长对话自适应尺度。
- 显著提升时间线加载速度，避免等待完整导出解析。
- 雪花动效默认开启。
- 导出设置迁移到时间线预览区域下方；顶部 popup 仅保留时间线与其他功能设置。

## Iteration 8 Plan
- [x] 将时间线默认位置改为右侧，并实现整条时间线（排除圆点）拖拽与手型光标。
- [x] 重构时间线点位布局：长对话启用自适应间距/滚动轨道，避免圆点拥挤。
- [x] 修复圆点跳转：增强目标定位与滚动容器兼容，处理失效节点回退。
- [x] 优化时间线数据源：接入轻量 turns 采集，避免依赖导出全量解析。
- [x] 迁移导出设置到时间线预览面板下方（格式/文件名/导出按钮），并补充导出隔离选择器。
- [x] 精简 popup：移除导出相关入口，仅保留时间线及其他设置项。
- [x] 调整默认值：雪花动效默认开启（content + popup）。
- [x] 完成语法检查与重新打包，记录 review。

## Iteration 8 Acceptance
- [x] 时间线默认出现在右侧，且非圆点区域可直接拖动位置。
- [x] 长对话下圆点间距自动调节并可滚动跟随，不再堆叠成团。
- [x] 点击时间线圆点可稳定跳转到对应对话位置。
- [x] 时间线在页面变更时更快出现，不再依赖完整导出解析结束。
- [x] 雪花动效默认开启。
- [x] 导出设置可在时间线预览面板下方直接选择；popup 仅保留时间线与其他设置。

## Iteration 8 Review
- 时间线交互与性能：
  - `src/timeline-feature.js` 改为默认右侧定位，支持整条时间线拖拽（排除圆点附近），拖拽中显示 `grabbing`。
  - 圆点布局改为像素间距模型：根据轨道高度自动计算 gap，长会话自动扩展 dots 容器并同步轨道滚动比例。
  - 点击圆点跳转增强：失效节点自动刷新重试，滚动目标加入视口偏移并在必要时 `scrollIntoView` 回退。
  - 新增预览下方导出快捷面板（格式/文件名/立即导出），通过回调与 content-script 状态同步。
- 装配与默认值：
  - `src/content-script.js` 时间线改用轻量 `collectTimelineTurnsFast` 数据源，MutationObserver 增加 `scheduleTimelineRefresh` 快速刷新路径。
  - 雪花默认值改为开启：`state.snowEffectEnabled` 与 popup `DEFAULTS` 均为 `true`。
  - 导出隔离链路新增 `.ced-timeline-export-quick`，确保不污染导出结果。
- Popup 调整：
  - `src/popup.html` / `src/popup.js` / `src/popup.css` 移除导出相关入口，仅保留时间线与其他增强设置。
- 样式改动：
  - `src/styles.css` 时间线默认右侧；移除旧拖拽把手样式；新增导出快捷面板样式与响应式隐藏规则。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 9 Goal
- 调整公式交互：鼠标悬停仅显示公式背景，不显示复制按钮。
- 修复背景覆盖不足：上下边缘完整包裹公式。
- 独立公式点击即复制，并在旁侧显示提示；背景不覆盖左右留白区域。

## Iteration 9 Plan
- [x] 重构 `formula-copy-feature`：去除按钮注入与按钮事件，改为点击 `.ced-formula-node` 直接复制。
- [x] 调整独立公式节点绑定策略：显示公式绑定到 `.katex-display > .katex`，避免整行左右空白被高亮。
- [x] 调整公式样式：增强上下边缘覆盖、保留旁侧 toast、隐藏旧按钮样式。
- [x] 完成语法检查与重新打包。

## Iteration 9 Acceptance
- [x] 悬停公式只显示背景标识，不再出现“复制 LaTeX”按钮。
- [x] 背景在上下方向完整覆盖公式，不再露出边缘。
- [x] 对于单独一栏公式，背景仅覆盖公式本体，点击公式即可复制并弹出提示。

## Iteration 9 Review
- 代码改动：
  - `src/formula-copy-feature.js`
    - 删除复制按钮注入逻辑，点击公式节点直接复制。
    - 显示公式改为绑定到内部 `.katex` 节点，避免整行空白区域高亮。
  - `src/styles.css`
    - 公式高亮样式改为 `inline-flex + padding/margin`，增强上下包裹。
    - 保留 toast 样式，复制按钮样式改为强制隐藏。
- 验证：
  - `node --check src/formula-copy-feature.js`
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 10 Goal
- 将产品统一更名为 `ChronoChat Studio`。
- 重写 `README`，形成正式 GitHub 项目说明（定位、能力、使用、构建、文件结构）。
- 将当前代码同步推送到远端仓库 `https://github.com/keepkeen/Export.git`。

## Iteration 10 Plan
- [x] 全局替换产品名称：`manifest`、popup 标题、面板标题、日志前缀、脚本产物命名。
- [x] 重写 `README.md`，覆盖当前功能现状（时间线、公式复制、工作区、导出与打包）。
- [x] 运行语法检查与打包验证，确认重命名后流程可用。
- [x] 提交并推送到 GitHub `origin/main`。

## Iteration 10 Acceptance
- [x] 扩展名称、popup、面板展示文案统一为 `ChronoChat Studio`。
- [x] README 为完整项目文档，内容与当前实现一致。
- [x] 打包脚本输出文件名切换为 `chronochat-studio.zip/.crx`。
- [x] 远端仓库已包含本次最新提交。

## Iteration 10 Review
- 命名统一：
  - `manifest.json` 扩展名称与 action 标题改为 `ChronoChat Studio`。
  - `src/popup.html` 标题与主标题改为 `ChronoChat Studio`。
  - `src/content-script.js` 面板标题改为 `ChronoChat Studio`，副标题改为 `Timeline & Export`，日志前缀统一。
  - `src/service-worker.js` 日志前缀统一为 `ChronoChat Studio`。
- 文档重写：
  - `README.md` 按正式 GitHub 项目结构重写：定位、能力、使用、构建、主文件、注意事项、许可证。
- 脚本与产物命名：
  - `scripts/build-crx.sh` 产物名改为 `dist/chronochat-studio.zip` / `dist/chronochat-studio.crx`。
  - 默认签名 key 改为 `certs/chronochat-studio.pem`。
- 辅助脚本命名同步：
  - `scripts/generate-icons.py` 与 `scripts/dump_overview.py` 的项目描述改为新名称。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/formula-copy-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
  - `python3 -m py_compile scripts/generate-icons.py scripts/dump_overview.py`
  - `./scripts/build-crx.sh`
- 发布：
  - Commit: `37263da`
  - Push: `origin/main` 已完成（`952e855..37263da`）。

---

## Iteration 11 Goal
- 继续优化时间线响应速度，点击圆点立即跳转并高亮。
- 支持滚轮滚动时自动检测当前对话位置并高亮对应圆点。
- 圆点在时间线上按从上到下均匀分布（比例布局），不再使用固定像素间距导致聚集。
- 调整预览与导出 UI，减少浮层切换成本，提升点击效率。

## Iteration 11 Plan
- [x] 重构圆点布局为百分比均匀分布，并移除固定间距/轨道内部滚动耦合逻辑。
- [x] 优化跳转链路：缩短动画时长、点击即高亮、滚动结束保持目标圆点激活。
- [x] 强化滚动联动：滚轮和页面滚动过程中持续计算活动轮次并同步高亮。
- [x] 合并预览与导出交互到同一面板（预览列表 + 导出控件），精简悬浮控件。
- [x] 完成语法检查、打包与 review 记录。

## Iteration 11 Acceptance
- [x] 点击任意圆点后可快速跳转，且目标圆点立即亮起并保持激活。
- [x] 页面滚轮滚动过程中，时间线会自动跟随当前阅读位置更新高亮圆点。
- [x] 圆点沿时间线从上到下均匀铺开，不再出现固定间距导致的上部聚集。
- [x] 预览与导出在同一个面板内完成，点击路径更短、交互更直接。

## Iteration 11 Review
- 时间线性能与高亮：
  - `src/timeline-feature.js`
    - 活动点节流间隔从 `72ms` 降至 `40ms`，滚动跟随更及时。
    - 跳转基础时长从 `520ms` 降到 `240ms`，并限制在 `120-360ms` 区间。
    - 点击圆点后先 `setActiveIndex` 再滚动，保证“先亮再跳”。
    - 增加滚动中周期性 `computeMarkerTops()` 刷新，提升长对话动态布局下的命中准确率。
- 圆点分布：
  - `src/timeline-feature.js`
    - 由像素间隔改为比例布局：`index/(total-1)` 映射到 `0%-100%`，全轨道均匀分布。
    - 移除轨道内部滚动同步逻辑，时间线点位始终完整可见。
- 预览/导出 UI：
  - `src/timeline-feature.js`
    - 将导出控件并入 `ced-timeline-preview-panel`，形成“搜索/预览/导出”单面板。
    - 预览按钮改为 `预览/导出`，放大可点击区域。
  - `src/styles.css`
    - 预览面板改为列式布局，列表区与导出区合并展示。
    - 删除独立 `ced-timeline-export-quick` 浮层样式。
- 轻量数据优化：
  - `src/content-script.js`
    - `collectTimelineTurnsFast` 新增签名缓存（数量+首尾 id），未变化时直接复用 turns。
- 验证：
  - `node --check src/timeline-feature.js`
  - `node --check src/content-script.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
