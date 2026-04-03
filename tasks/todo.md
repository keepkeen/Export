# Todo

## Iteration 46 Goal
- 在不触发仓库禁止项的前提下恢复正式打包链路，允许直接运行 `./scripts/build-crx.sh`。
- 继续优化 README，让功能边界、安装路径、VSCode Bridge 用法和当前产品定位更清晰。
- 完成验证后提交并推送到 GitHub。

## Iteration 46 Plan
- [x] 改造 `scripts/build-crx.sh`，去掉 `rm -rf` 依赖，改为基于临时目录的安全打包流程。
- [x] 收敛 `README.md`，明确 ChatGPT-first、VSCode Bridge、本地同步和打包/安装方式。
- [x] 运行静态校验与正式打包。
- [x] 提交并推送到 `origin/main`。

## Iteration 46 Acceptance
- [x] `./scripts/build-crx.sh` 可直接运行，生成最新 zip/crx 产物。
- [x] README 与当前实现一致，不再保留过时的信息架构或模糊文案。
- [x] 改动完成后已提交并推送到 GitHub。

## Iteration 46 Review
- `scripts/build-crx.sh`
  - 打包流程改为基于 `mktemp` 的工作目录，不再依赖 `rm -rf` 清理 `dist` 内部目录。
  - ZIP 和 CRX 先在临时工作目录生成，再原子移动到最终路径。
- `README.md`
  - 重写为更贴近当前产品能力的说明：强调 ChatGPT-first、VSCode Bridge、真实安装方式和使用路径。
  - 把“浏览器扩展单独使用”和“浏览器扩展 + VSCode Bridge”两条路径拆开写清楚。
- 验证：
  - `bash -n scripts/build-crx.sh`
  - `rg -n "rm -rf" scripts/build-crx.sh README.md src integrations tasks`
  - `node --check src/service-worker.js`
  - `node --check src/context-sync-feature.js`
  - `node --check src/content-script.js`
  - `node --check integrations/vscode-threadatlas/extension.js`
  - `./scripts/build-crx.sh`
  - `git push origin main`

## Iteration 45 Goal
- 把现有“手动把网页会话 POST 到 localhost”的简陋 context sync，升级成可实际连接 VSCode 的本地桥接能力。
- 在 ChatGPT 网页输入区提供 VSCode 上下文栏，默认展示当前工作区/文件/选区，并在发送时自动附加去重后的上下文。
- 在仓库内提供可运行的 VSCode 扩展实现，本地暴露 HTTP 接口给浏览器扩展调用，不依赖 OpenAI API。

## Iteration 45 Plan
- [x] 设计并实现本地桥接协议：`/health`、`/active-context`、`/conversation/prepare`、`/conversation/mark-sent`，同时兼容现有 `/sync` 检查/推送。
- [x] 扩展 service worker 升级本地 sync 通信层，支持状态检查、读取当前 VSCode 上下文、准备发送内容和发送后标记去重。
- [x] 为 ChatGPT 页面新增 VSCode 上下文功能模块：输入区上方引用栏、活跃上下文轮询、发送前自动注入、失败兜底与路由清理。
- [x] 在仓库内新增零依赖 VSCode 扩展，采集当前工作区/活动文件/选区/打开文件/dirty 状态/诊断信息，并运行本地 HTTP 服务。
- [x] 更新 popup/README 文案与说明，确保用户知道如何安装 VSCode 扩展并启用本地桥接。
- [x] 运行静态校验、浏览器扩展打包与本地桥接脚本检查，补写 review。

## Iteration 45 Acceptance
- [x] 浏览器扩展启用本地同步后，能检测本地 VSCode 桥接在线状态。
- [x] ChatGPT 输入区可看到当前 VSCode 活跃上下文，选中代码时默认以引用态显示。
- [x] 用户发送消息时，扩展会自动附加本次未发送过的必要上下文，而不是每次重复塞整段工作区信息。
- [x] 本地桥接能按 conversation 记录已发送上下文，代码变更后会因内容 hash 变化重新发送。
- [x] 仓库内包含可安装的 VSCode 扩展实现与使用说明。
- [x] `node --check`、JSON 校验和非破坏性预览打包通过；未运行仓库内会清空目录的 `./scripts/build-crx.sh`。

## Iteration 45 Review
- `src/service-worker.js`
  - 本地同步协议从单一 `/sync` 扩展为 `/health`、`/active-context`、`/conversation/prepare`、`/conversation/mark-sent`。
  - 新增本地桥接状态读取、准备消息、发送后去重标记等消息类型；原来的“推送当前网页会话”继续兼容。
- `src/context-sync-feature.js`
  - 新增 ChatGPT 输入区上的 VSCode 上下文栏。
  - 会轮询本地桥接的活跃上下文，显示工作区、活动文件、选中代码/光标附近片段、dirty 文件和诊断摘要。
  - 发送消息时会先拦截提交，向本地桥接请求“本轮未发送过的上下文块”，插入后再继续发送，并回写 sent-cache。
- `src/content-script.js`
  - 接入新 feature 的初始化和设置同步链路，使 popup 中的本地同步开关和端口能实时作用到页面内上下文栏。
- `src/styles.css`
  - 为输入区上的 VSCode 上下文栏补齐简约样式，移动端时会折叠为纵向布局。
- `integrations/vscode-threadatlas/package.json`
  - 新增零依赖 VSCode 扩展 manifest、命令和配置项。
- `integrations/vscode-threadatlas/extension.js`
  - 新增本地 HTTP bridge：采集活动文件、选区、excerpt、open files、dirty files、diagnostics 和 git status。
  - 按 conversation 维护 sent-id 去重缓存；内容 hash 变化后会自然重新发送。
  - 暴露健康检查、活跃上下文读取、准备消息和 mark-sent 接口。
- `integrations/vscode-threadatlas/README.md`
  - 补充 VSCode Bridge 的本地运行与打包说明。
- `src/popup.html`
  - 本地同步文案改为明确面向 VSCode Bridge，同时保留“推送当前网页会话”按钮，便于把网页会话送回本地服务。
- `src/popup.js`
  - popup 状态文案改为 VSCode Bridge 语义，推送按钮文案也改成网页会话推送。
- `README.md`
  - 更新产品说明：补充 VSCode Bridge、输入区上下文栏和安装步骤，移除过时的 popup/options 架构描述。
- 验证：
  - `node --check src/service-worker.js`
  - `node --check src/context-sync-feature.js`
  - `node --check src/content-script.js`
  - `node --check src/popup.js`
  - `node --check integrations/vscode-threadatlas/extension.js`
  - `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); JSON.parse(require('fs').readFileSync('integrations/vscode-threadatlas/package.json','utf8')); console.log('json ok')"`
  - `zip -qr dist/threadatlas-browser-preview.zip manifest.json README.md src icons vendor`
  - `cd integrations/vscode-threadatlas && zip -qr ../../dist/threadatlas-vscode-bridge-preview.zip package.json README.md extension.js`

## Iteration 44 Goal
- 修正时间线 active 高亮“不明显”和轨道滚轮与页面滚动互相抢控制权的问题。
- 把完整设置并回 popup，取消“popup + 单独完整设置页”的分裂入口，同时把 UI 收敛到更简约的风格。
- 保持现有设置绑定和即时下发链路不被打断。

## Iteration 44 Plan
- [x] 在 lessons 中记录用户对时间线交互、popup 架构和 folder UX 的纠偏，补充本轮计划。
- [x] 调整 timeline 轨道宽度、可见点数和 active 样式，并移除 wheel 抢占逻辑，优先走原生滚动。
- [x] 将 options 中的完整设置并入 popup，移除单独“完整设置”入口，重构 popup 为简约布局。
- [x] 优化 folder 的高频交互，改成当前会话点击式分配，并让新建文件夹默认分配到当前会话。
- [x] 运行静态校验与打包，补写 review。

## Iteration 44 Acceptance
- [x] 时间线 active dot 在滚动时清晰可见。
- [x] 鼠标位于时间线柱子上时，滚轮滚动不再发涩或与页面滚动打架。
- [x] popup 内可直接访问完整设置，不再依赖单独“完整设置”入口。
- [x] popup UI 收敛为更简约的视觉。
- [x] 文件夹高频操作从下拉切到点击式分配，创建后会自动分配到当前会话。
- [x] `node --check` 与 `./scripts/build-crx.sh` 通过。

## Iteration 44 Review
- `tasks/lessons.md`
  - 记录了三条用户纠偏：时间线 active / wheel 交互、popup 不能继续分裂为单独完整设置页、文件夹高频操作不能再依赖费劲的下拉流程。
- `src/timeline-feature.js`
  - 提高 dot 间距并降低可见点数上限，让长会话时间线在默认视窗里更疏、更好辨认。
  - 取消内容脚本对时间线 `wheel` 的手动接管，恢复原生滚动行为，避免轨道和页面滚动互相抢控制权。
- `src/styles.css`
  - 时间线轨道缩窄为更轻的柱体，scrollable 宽度也收紧。
  - active dot 的高亮样式加强：更大的缩放、环形外晕和更明显的发光。
  - 文件夹当前会话区域新增 `ced-folder-assign-list / chip` 样式，支持点击式分配。
- `src/popup.html`
  - popup 改为单入口完整设置，不再保留“完整设置”跳转按钮。
  - 合并导航与阅读、页面整理、本地同步三块完整设置，把原 `options` 页中的主要控件都挪回 popup。
- `src/popup.css`
  - 视觉改回更克制的简约样式，去掉过强装饰和大面积花哨背景。
- `manifest.json`
  - 移除了 `options_page`，不再暴露独立设置页入口。
- `src/folder-feature.js`
  - 当前会话文件夹分配改为可点击的文件夹标签，不再主要依赖隐藏 select。
  - 从面板或侧栏新建文件夹时，如果当前在会话页，会自动把新文件夹分配给当前会话；若同名文件夹已存在，则直接把当前会话分配过去。
- 验证：
  - `node --check src/folder-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
  - `./scripts/build-crx.sh`
- 产物：
  - `dist/threadatlas.zip`
  - `dist/threadatlas.crx`

## Iteration 43 Goal
- 把 ChatGPT 文件夹能力严格限制在真实对话页，仅在 `/c/<conversation-id>` 会话界面显示，不再在首页或其它 ChatGPT 页面露出。
- 修复右侧时间线的当前轮次高亮跟随，并为长会话引入“固定舒适点数 + 轨道内滚动窗口”的交互。
- 重做 popup 信息架构与视觉层次，降低机械感，保留现有设置链路与即时下发行为。

## Iteration 43 Plan
- [x] 收紧 ChatGPT 文件夹的显示条件：以当前会话 id 作为硬门槛，未进入会话页时隐藏侧栏文件夹与面板文件夹模块。
- [x] 调整 timeline active marker 与 dot 渲染：增强 viewport 判定，加入自适应可见点数、轨道滚动窗口和独立滚动条。
- [x] 重构 popup HTML/CSS，保留现有 JS 绑定 id，优化状态区、快速设置和页面动作的层次与观感。
- [x] 运行静态校验与打包，补写本轮 review。

## Iteration 43 Acceptance
- [x] 文件夹 UI 仅在 ChatGPT 会话页出现。
- [x] 页面滚动到对应轮次时，时间线 active dot 会稳定跟随。
- [x] 超长会话下时间线保持固定舒适数量的可见点，并支持在轨道上滚动查看更多点。
- [x] popup UI 完成重构且现有设置功能仍可初始化。
- [x] `node --check` 与 `./scripts/build-crx.sh` 通过。

## Iteration 43 Review
- `src/folder-feature.js`
  - 新增 `isConversationRouteActive()`，把文件夹能力严格绑到 `/c/<conversation-id>` 会话路由。
  - 侧栏文件夹在非会话页会主动 `detachSidebarSection()`，不再出现在 ChatGPT 首页或其它非对话界面。
  - 工作区面板里的文件夹 section 在非会话页改为 `hidden`，避免“页面里还保留一个空文件夹模块”。
- `src/timeline-feature.js`
  - active marker 判定从“取 reference 之前最后一个点”改成“围绕 viewport 中线取最近 marker”，滚动时高亮更稳定。
  - dot 渲染改成自适应可见容量：按当前时间线高度推算舒适点数，超长会话时轨道内部启用滚动窗口与细滚动条，不再把所有点硬压在一根轨上。
  - active dot 变化时会自动滚入轨道视窗；滚轮优先滚动时间线轨道，到边界后再回退到页面滚动。
- `src/styles.css`
  - 文件夹 section 增加 `[hidden]` 显示兜底。
  - 时间线 bar/track/dots 样式升级：更宽的轨道、可见滚动条、滚动态渐隐边缘和轨道中线。
- `src/popup.html`
  - popup 结构改为 `hero-card + quick settings + page actions` 三段式，保留原有控件 id，避免打断 JS 绑定。
- `src/popup.css`
  - 重做 popup 视觉语言：暖色磨砂背景、状态 hero、卡片式设置区和更明确的动作区层次，减少“表单堆叠”的机械感。
- 验证：
  - `node --check src/folder-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`
- 产物：
  - `dist/threadatlas.zip`
  - `dist/threadatlas.crx`

## Iteration 42 Goal
- 将当前工作区里的已完成功能更新整理成一次可验证的 GitHub 推送。
- 在提交前完成仓库现有可执行校验：静态语法检查与扩展打包。
- 在 `tasks/todo.md` 中记录本轮发布计划、验证结果与推送状态。

## Iteration 42 Plan
- [x] 复核当前工作区改动与远程分支状态，确认推送目标为 `origin/main`。
- [x] 运行本仓库现有校验：对新增/核心脚本执行 `node --check`，并运行 `./scripts/build-crx.sh`。
- [x] 汇总变更、创建提交、推送到 GitHub。
- [x] 补写本轮 review，记录校验与推送结果。

## Iteration 42 Acceptance
- [x] `git status` 仅包含本轮要提交的文件。
- [x] 静态语法检查通过。
- [x] `./scripts/build-crx.sh` 成功产出发布包。
- [x] 提交已推送到 `origin/main`。

## Iteration 42 Review
- 目标仓库与远端：
  - 本地分支：`main`
  - 远端：`origin https://github.com/keepkeen/Export.git`
- 本轮发布提交：
  - `f97e79f feat: refactor conversation snapshot and export workflow`
  - 已推送到 `origin/main`，远端分支从 `aac6831` 更新到 `f97e79f`
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/folder-feature.js`
  - `node --check src/formula-copy-feature.js`
  - `node --check src/history-cleaner-feature.js`
  - `node --check src/markdown-patcher-feature.js`
  - `node --check src/popup.js`
  - `node --check src/sidebar-autohide-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/title-updater-feature.js`
  - `node --check src/chatgpt-conversation-parser.js`
  - `node --check src/conversation-kernel.js`
  - `node --check src/export-engine.js`
  - `node --check src/history-archive-controller.js`
  - `node --check src/history-window-manager.js`
  - `node --check src/runtime-scheduler.js`
  - `./scripts/build-crx.sh`
- 产物：
  - `dist/threadatlas.zip`
  - `dist/threadatlas.crx`
- 备注：
  - `dist/` 仍保持忽略状态，未纳入提交。

## Iteration 41 Goal
- 将当前解析链路拆成“结构同步（live snapshot）”和“完整快照（full snapshot）”两层，避免 `refreshConversationData()` 一次性承担所有职责。
- 页面加载后自动在空闲时预热完整轮次，不再依赖用户先点导出才准备 full snapshot。
- 降低时间轴的持续布局成本：按需失效 marker top，滚动时不再无脑全量重算。

## Iteration 41 Plan
- [x] 在 `state` 中新增 `liveTurns/fullTurns/fullSnapshot*` 字段，并把 `state.turns` 收敛为兼容别名。
- [x] 拆分 `refreshConversationData()` 为 `refreshConversationMetaOnly()` + `refreshConversationSnapshot()`，新增 `scheduleFullSnapshotWarmup()`。
- [x] 调整 scheduler、init、route change、observer：普通变更只做 live sync，并在 idle 触发 full warmup。
- [x] 调整面板/导出/context sync 数据源，优先使用 full snapshot，不再要求用户先点导出。
- [x] 为 timeline 增加 marker top 增量失效机制，并由 content-script 在结构变化时主动标记失效。
- [x] 更新 lessons/todo review，运行静态校验与打包。

## Iteration 41 Review
- `src/content-script.js`
  - 新增 `liveTurns/fullTurns/fullSnapshotReady/fullSnapshotDirty/fullSnapshotContextKey/fullSnapshotInFlight` 等状态，把 live 结构同步和 full snapshot 彻底拆开。
  - `init()` 改成“先 `refreshConversationMetaOnly()` + `refreshConversationSnapshot({full:false})`，再 `scheduleFullSnapshotWarmup(0)`”，页面首次加载不再等待完整导出级解析。
  - 新增 `refreshConversationSnapshot()` / `collectConversationTurnsForChatGptSnapshot()` / `scheduleFullSnapshotWarmup()`，普通页面刷新默认只同步 live 数据，完整 turns 在 idle 预热。
  - `observeConversation()`、route change 和 scheduler 现在只把会话变更标记为 `fullSnapshotDirty` 并安排 `snapshot-warmup`，不再依赖“导出面板打开”才做 full parse。
  - 导出、面板 turn 列表、Context Sync 已切到 full snapshot 优先：导出前会做 full preflight，面板未预热完成时回退到 live turns。
- `src/timeline-feature.js`
  - 新增 `markerTopDirtyStart/markerIndexById` 和 `invalidateMarkerTopsFrom*()`。
  - `refresh()` 改为 marker 渲染和 top 计算分离；scroll 时只有 dirty 后缀才重算，不再周期性全量 `computeMarkerTops()`。
  - 暴露 `invalidateMarkerTopsFrom()` / `invalidateMarkerTopsFromMarkerId()` 供 content-script 主动标记失效。
- `tasks/lessons.md`
  - 补充“结构同步和完整快照必须拆开”的规则，避免后续再把 live/full parse 重新绑回一个入口。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/runtime-scheduler.js`
  - `node --check src/history-archive-controller.js`
  - `./scripts/build-crx.sh`

## Iteration 40 Goal
- 按用户提供的 modernization 补丁同步 ChatGPT 现代 DOM 兼容改动。
- 收紧并补强 ChatGPT 选择器、稳定 ID、mutation 影响判断与 timeline 滚动容器解析。
- 保持现有重构分层不回退，只落补丁涉及的行为差异。

## Iteration 40 Plan
- [x] 对齐 `content-script.js` 的 ChatGPT selectors、稳定 ID、content root 解析与 mutation 影响判断。
- [x] 对齐 `chatgpt-conversation-parser.js` / `conversation-kernel.js` / `timeline-feature.js` 的补丁差异。
- [x] 更新 lessons/todo review，并运行静态校验与打包。

## Iteration 40 Review
- 已按补丁同步 ChatGPT 现代 DOM 兼容改动：
  - `src/content-script.js`：更新 ChatGPT selectors、content node 解析、stable id token、fast selector 与 mutation 相关性判断。
  - `src/chatgpt-conversation-parser.js`：对齐 parser 默认 selector。
  - `src/conversation-kernel.js`：恢复 round marker 优先 user turn。
  - `src/timeline-feature.js`：增强 scroll container 选择、预览滚动行为与 resize 时的容器重绑定。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/chatgpt-conversation-parser.js`
  - `node --check src/conversation-kernel.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`

## Iteration 39 Goal
- 修复 ChatGPT 长会话链路中的 6 个结构性 bug：空选区回弹、message/round ID 不稳定、时间轴 320 条硬截断、导出快照误删嵌套 turn、归档 focus 失败 reload、round 分组过度依赖 role。
- 让 turn 选择、时间轴 marker、归档定位和导出都建立在稳定主键上，而不是内容签名和宽泛 selector。
- 保持当前架构分层不回退：`content-script` 继续做装配，`conversation-kernel` / `history-window-manager` / `timeline-feature` 分别收敛各自职责。

## Iteration 39 Plan
- [x] 修复选择保持：引入显式 selection mode/context，同会话内允许“取消全选”持续为空，新会话再恢复默认全选。
- [x] 修复稳定主键：message ID 改为优先宿主 root 标识或节点持久 synthetic id，round marker 采用稳定 turn 锚点并复用已有 round。
- [x] 修复时间轴完整性：移除 320 marker 硬截断，保留完整历史 marker 数据。
- [x] 修复导出快照过滤：导出仅按顶层消息根节点过滤，不再用宽泛 `MESSAGE_TURN` 删除嵌套 role 子节点。
- [x] 修复归档 focus：找不到 round 时不再整页 reload。
- [x] 增强 round 分组：在 role 不可靠时采用更稳的分组回退，避免多轮被合并成一轮。
- [x] 更新 lessons/todo review，运行 `node --check` 和 `./scripts/build-crx.sh`。

## Iteration 39 Review
- `src/content-script.js`
  - 新增 `selectionMode` / `selectionContextKey` / `syncSelectionContext()` / `commitSelection()`，把“首次进入默认全选”和“用户显式清空选择”分开处理。
  - `refreshConversationData()` 不再因为空选区或旧 id 不匹配就自动回弹成全选；同会话内空选区会被保留，新会话才回到默认全选。
  - message id 改为 `ensureStableMessageId()`：优先使用宿主稳定 root 标识，否则给消息根节点分配一次性 synthetic id，不再把内容签名当主键。
  - 顶层消息根节点统一标记 `data-ced-message-root=\"1\"`，导出快照按这个根节点集合过滤，避免删除嵌套 `[data-message-author-role]` 子树。
  - ChatGPT 主 `MESSAGE_TURN` selector 收紧为 `[data-testid^=\"conversation-turn-\"]`，`article` 和 author-role 只留在 fallback 链路。
- `src/conversation-kernel.js`
  - round 分组新增 `resolveRoundRole()`，优先重查显式 author metadata。
  - 当连续消息都没有明确 user 时，采用保守的“最多两条 assistant 组成一个 fallback round”策略，避免长串内容被错误并成单轮。
  - `buildRounds()` 会按稳定 turn id 复用已有 round，marker id 优先继承旧 round，降低 timeline/focus 元数据漂移。
- `src/timeline-feature.js`
  - 移除默认 `320` 条 marker 硬上限；只有显式配置正数上限时才裁剪，默认保留完整历史 marker。
- `src/history-window-manager.js`
  - `focusRound()` 找不到目标 round 时直接返回 `null`，不再触发 reload 级回退。
- `src/history-archive-controller.js`
  - `requestFocusReload()` 退化为 no-op 清理，避免遗留 session reload 链路继续生效。
- `tasks/lessons.md`
  - 补充“空选区不能自动回弹”、“turn/round 主键必须稳定”、“时间轴与归档不能靠硬截断或 reload 掩盖问题”的规则。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/conversation-kernel.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/history-window-manager.js`
  - `node --check src/history-archive-controller.js`
  - `./scripts/build-crx.sh`

## Iteration 38 Goal
- 修复 ChatGPT 解析主链路对 round/archive store 的错误强依赖。
- 确保 DOM 解析结果在 round store 异常、空结果或未准备好时仍能作为保底数据源返回。
- 让时间轴在 `user` 角色识别异常时降级为 `all`，避免整条时间轴直接消失。

## Iteration 38 Plan
- [x] 修正 `chatgpt-conversation-parser.js`：`parseConversation()` 优先返回 archive turns，空时退回 `domTurns`。
- [x] 修正 `content-script.js`：`collectConversationTurnsForChatGpt()` 做同样的保底返回，并收紧 ChatGPT 主 root selector。
- [x] 修正 `timeline-feature.js`：当 `markerRole=user` 过滤结果为空时，自动降级使用全部 turns。
- [x] 补充 lessons、运行静态校验与打包，并记录 review。

## Iteration 38 Review
- 根因修正：
  - ChatGPT 分支此前把“DOM 解析成功”错误地绑成“必须 round/archive store 也成功且能再读出来”，导致一旦 store 链路为空，`state.turns` 会被覆盖成 `[]`，时间轴和导出一起失效。
- `src/chatgpt-conversation-parser.js`
  - `parseConversation()` 现在在拿到 `domTurns` 后，会优先返回 `archiveTurns`，但当 archive 结果为空时会退回 `domTurns`。
  - 这让 round store 从“主链路单点依赖”降级为“增强层”。
- `src/content-script.js`
  - `collectConversationTurnsForChatGpt()` 同样补了保底返回：parser 结果为空时不再直接认定“没有对话”，而是回退到 `domTurns`。
  - ChatGPT 主 `MESSAGE_TURN` selector 改为 `"[data-testid^=\"conversation-turn-\"], article"`，把 `[data-message-author-role]` 从主 root selector 挪到 fallback selectors，避免角色子节点参与主 turn root 去重。
- `src/timeline-feature.js`
  - `collectMarkers()` 在 `markerRole='user'` 且过滤后为空时，会自动降级使用全部 turns，避免 role 误判时整条时间轴直接消失。
- `tasks/lessons.md`
  - 补充“ChatGPT 解析结果不能强依赖 round/archive store 才能返回”的规则。
- 验证：
  - `node --check src/chatgpt-conversation-parser.js`
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`
  - 产物：
    - `dist/threadatlas.zip`
    - `dist/threadatlas.crx`

## Iteration 37 Goal
- 修复 ChatGPT 时间轴无法识别对话轮次的问题。
- 纠正重叠消息选择器的去重语义，确保 round 解析和时间线都保留消息根节点，而不是内部子节点。
- 对应修正内容脚本和时间线模块的节点去重实现，并做静态验证。

## Iteration 37 Plan
- [x] 修正 `content-script.js` 的 `dedupeMessageNodes()`，改为保留最外层消息根节点。
- [x] 修正 `timeline-feature.js` 的 `dedupeNodes()`，避免 fallback 路径继续保留内部子节点。
- [x] 补充 `tasks/lessons.md`，记录“重叠选择器去重必须保留消息根节点”的经验。
- [x] 运行静态验证与打包，补写本轮 review。

## Iteration 37 Review
- 根因：
  - ChatGPT 选择器同时命中消息根节点和内部 `[data-message-author-role]` 子节点时，去重逻辑保留了“最深层子节点”。
  - 这会让 round 解析、时间线 fallback 以及观察根推导都拿不到真正的消息根节点，最终表现为“时间轴识别不到对话轮次”。
- `src/content-script.js`
  - `dedupeMessageNodes()` 从“反向遍历屏蔽祖先”改成“正向遍历保留最外层根节点，并删除被新根节点包住的旧项”。
  - 这样 `collectConversationTurns()`、`collectConversationTurnNodesFast()`、ChatGPT parser 和 round 索引都会保留真正的消息根节点。
- `src/chatgpt-conversation-parser.js`
  - fast path 改为优先只采 `[data-testid^="conversation-turn-"]`，只有完全找不到时才回退到 `[data-message-author-role]`。
  - 这样新版 ChatGPT 即使在消息内部嵌套 author-role 节点，也不会再把它们误当作独立轮次根节点。
- `src/timeline-feature.js`
  - `dedupeNodes()` 同步改成同样的语义，避免时间线 fallback 路径在模块内部再次把根节点替换成深层子节点。
- `tasks/lessons.md`
  - 新增“重叠消息选择器去重必须保留消息根节点”的规则，防止以后在其它站点重复踩坑。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`
  - 产物：
    - `dist/threadatlas.zip`
    - `dist/threadatlas.crx`

## Iteration 36 Goal
- 扫描并修复时间线与历史裁剪链路中的高风险实现问题。
- 优先处理 ChatGPT 路径下的 marker 采集、滚动定位、round 窗口同步与裁剪统计。
- 保持现有“归档旧轮次而非销毁历史”的产品语义不变，只修正错误行为与错误数据。

## Iteration 36 Plan
- [x] 修正时间线数据源：去掉 ChatGPT fast turn 采集里的重复节点与非消息节点污染，避免 round/timeline 重复计数。
- [x] 修正时间线展示与跳转：长会话 marker 上限保留最近轮次，预览编号与实际 round 对齐，并让历史窗口滚动补偿使用真实滚动容器。
- [x] 修正裁剪链路：校正 applyTrim 的 removed 统计与归档窗口联动，避免“裁剪结果文案与实际窗口状态不一致”。
- [x] 完成静态校验、差异复核，并补写本轮 review。

## Iteration 36 Acceptance
- [x] ChatGPT 时间线不会因 `[data-testid^="conversation-turn-"], [data-message-author-role]` 的重复命中而出现重复圆点或错误轮次。
- [x] 当会话轮次超过 `maxMarkers` 时，时间线仍优先保留最近轮次，预览编号与实际轮次一致。
- [x] 裁剪后状态文案与 live window 实际保留轮次一致，removed 统计不再把“轮次”误报成“消息”。
- [x] 构建或静态检查完成，并把无法在当前环境验证的内容明确记录。

## Iteration 36 Review
- `src/chatgpt-conversation-parser.js`
  - `collectTurnNodesFast()` 现在会先做统一去重，再返回 ChatGPT fast selector 命中的 turn 节点，避免 `[data-testid^="conversation-turn-"], [data-message-author-role]` 在新版 DOM 下把同一轮重复算两次。
- `src/content-script.js`
  - `collectConversationTurnNodesFast()` 对 parser 返回值和本地 fallback 都做了去重，避免时间线、observe root 推导和 round 索引被重复节点污染。
  - `initHistoryWindowManager()` 新增真实滚动容器注入，归档窗口滚动补偿改为跟时间线使用同一套 `SCROLL_CONTAINER_SELECTORS`。
  - `getConversationScrollContainer()` 的本地 fallback 也优先使用真实滚动容器，而不是直接退回 observe target。
- `src/timeline-feature.js`
  - marker 上限从“截前 320 个”改为“保留最近 320 个”，修复长会话时最新轮次不进时间线的问题。
  - 透传并保留 `roundIndex`，预览编号与 dot label 改为显示真实轮次编号，而不是局部切片后的序号。
  - marker render signature 额外纳入 `roundIndex`，避免编号变化时 UI 仍沿用旧渲染结果。
- `src/history-window-manager.js`
  - `getConversationScrollContainer()` 支持外部注入真实 scroll container，避免 focus/trim 之后用错误容器做 `scrollTop` 补偿，导致时间线高亮和页面位置错位。
- `src/history-archive-controller.js`
  - `applyTrim()` 改为按“即将从 live window 进入 archived 的 round”统计 `removedRounds` / `removedMessages`，不再把 round 数误当消息数。
  - trim 结果文案按 `archived / restored / noop` 三种结果区分，避免在只是扩窗或无需变更时仍然提示“已归档”。
- 验证：
  - `node --check src/chatgpt-conversation-parser.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/history-window-manager.js`
  - `node --check src/history-archive-controller.js`
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`
  - 当前只完成了静态校验和打包；真实 ChatGPT 页面中的时间线跳转、focus 窗口释放和裁剪反馈仍需要页面实测。

## Iteration 35 Goal
- 将 `refreshConversationData()` 里的 ChatGPT 专用解析分支抽到独立 `chatgpt-conversation-parser`。
- 保持通用 `parseMessage()` / fallback 解析仍在 `content-script.js`，先收 ChatGPT 站点特有的 turn 收集、round sync 与 auto-maintain 协调。
- 让 `content-script.js` 继续向“装配层 + 通用工具层”收敛。

## Iteration 35 Plan
- [x] 新增 `src/chatgpt-conversation-parser.js`，承接 ChatGPT turn 收集、fast turn node 收集、round store sync 与 latest window 协调。
- [x] 在 `manifest.json` 注入新模块，并在 `content-script.js` 中初始化 parser。
- [x] 将 `collectConversationTurnNodesFast()` / `collectConversationTurnsForChatGpt()` 的实现改成 parser wrapper，并让 `refreshConversationData()` 走 parser。
- [x] 重新打包验证并补充本轮 review。

## Iteration 35 Review
- 新增模块：
  - `src/chatgpt-conversation-parser.js`
  - 负责 ChatGPT 专用解析分支：
    - fast turn node 收集
    - 当前会话 turn 收集
    - round store sync
    - latest window 自动维持
- `src/content-script.js`
  - 新增 `chatgptConversationParser` 初始化，把 `messageSelector / dedupeNodes / syncArchiveContext / collectDomTurns / collectArchiveTurns / syncRoundStore / applyLatestWindow` 作为依赖注入。
  - `refreshConversationData()` 的 ChatGPT 分支改为走 `collectConversationTurnsForChatGpt()`，而该函数已优先委托给 parser。
  - `collectConversationTurnNodesFast()` 改为优先委托 parser，保留本地 fallback，避免模块缺失时直接返回空。
- `manifest.json`
  - 在 `src/history-archive-controller.js` 后注入 `src/chatgpt-conversation-parser.js`。
- 分层结果：
  - `conversation-kernel.js`：round 数据模型。
  - `history-window-manager.js`：DOM archive/restore/window。
  - `history-archive-controller.js`：context/trim/reload restore/sync 调度。
  - `chatgpt-conversation-parser.js`：ChatGPT 专用 turn 收集和 round sync。
  - `content-script.js`：装配层 + 跨站点通用解析工具。
- 验证：
  - `./scripts/build-crx.sh` 已通过，产物：
    - `dist/threadatlas.zip`
    - `dist/threadatlas.crx`
  - `node --check` 仍无法执行：当前 shell 环境没有 `node/nodejs/bun/deno`。

## Iteration 34 Goal
- 将 ChatGPT 的历史归档调度从 `content-script.js` 进一步抽离成独立 `history-archive-controller`。
- 拆分“DOM 窗口操作”和“refresh / context / reload / trim 调度”，让两层职责彻底分开。
- 保持现有调用点稳定，优先用薄 wrapper 降低行为回归风险。

## Iteration 34 Plan
- [x] 新增 `src/history-archive-controller.js`，承接 context 同步、归档清理、reload 恢复、sync 调度、trim 协调。
- [x] 在 `manifest.json` 注入新模块，并在 `content-script.js` 里初始化 controller。
- [x] 把 `syncHistoryArchiveContext()` / `clearHistoryArchive()` / `scheduleHistoryArchiveSync()` / `maybeRestorePendingHistoryFocus()` / `requestHistoryFocusReload()` / `applyHistoryArchiveTrim()` 改成 controller wrapper。
- [x] 重新打包验证并补充本轮 review。

## Iteration 34 Review
- 新增模块：
  - `src/history-archive-controller.js`
  - 负责 ChatGPT 历史归档的调度层：会话 key 同步、归档状态清空、pending focus reload 恢复、history sync idle 调度、trim 结果汇总、trim 后 UI 协调。
- `src/content-script.js`
  - 新增 `historyArchiveController` 初始化，把 `state / getConversationKey / requestRefresh / shouldRunHeavyRefresh / scheduleTimelineRefresh / scheduleTimelineEnsure / muteConversationObserverFor` 等依赖集中注入。
  - `syncHistoryArchiveContext()` / `clearHistoryArchive()` / `applyHistoryArchiveTrim()` / `maybeRestorePendingHistoryFocus()` / `requestHistoryFocusReload()` / `scheduleHistoryArchiveSync()` / `handleHistoryCleanerTrim()` 改为 controller wrapper。
  - `refreshConversationData()`、scheduler flush、route change 和 history cleaner 继续通过原调用点驱动，但调度实现已不再直接写在内容脚本里。
- `manifest.json`
  - 在 `src/history-window-manager.js` 后注入 `src/history-archive-controller.js`。
- 分层结果：
  - `conversation-kernel.js`：round 数据与窗口状态模型。
  - `history-window-manager.js`：真实 DOM / spacer / archive / restore / focus window。
  - `history-archive-controller.js`：context / trim / reload restore / refresh 调度。
  - `content-script.js`：装配、消息桥接、feature 协调。
- 验证：
  - `./scripts/build-crx.sh` 已通过，产物：
    - `dist/threadatlas.zip`
    - `dist/threadatlas.crx`
  - `node --check` 仍无法执行：当前 shell 环境没有 `node/nodejs/bun/deno`。

## Iteration 33 Goal
- 将 ChatGPT 的真实 DOM 归档/恢复/窗口切换逻辑从 `content-script.js` 下沉到独立 `history-window-manager`。
- 保持 `conversation-kernel` 继续只负责 round 数据与窗口状态建模，避免数据层和宿主 DOM 层重新耦合。
- 让 `content-script.js` 进一步收敛为装配层与业务编排层。

## Iteration 33 Plan
- [x] 新增 `src/history-window-manager.js`，封装 archive/restore/spacer/scroll/window/focus 逻辑。
- [x] 在 `manifest.json` 注入新模块，并在 `content-script.js` 中初始化 manager。
- [x] 将 `content-script.js` 的 DOM 窗口函数改成 manager wrapper，保留原调用点，降低回归风险。
- [x] 重新打包验证并补充本轮 review。

## Iteration 33 Review
- 新增模块：
  - `src/history-window-manager.js`
  - 负责 ChatGPT 历史窗口的真实 DOM 生命周期：`spacer`、archive pool、窗口切换、滚动补偿、focus 恢复、timeline active 联动。
- `src/content-script.js`
  - 新增 `historyWindowManager` 初始化，把 `state / kernel / measureRoundHeight / observeTarget / queueEnhancerRoots / requestFocusReload` 等依赖集中注入。
  - `getHistoryRoundAnchorNode()` / `archiveHistoryRound()` / `restoreHistoryRound()` / `applyHistoryWindowRange()` / `applyLatestHistoryWindow()` / `focusHistoryRound()` / `restoreHistoryWindowState()` / `expandAllHistoryRoundsForRender()` / `handleTimelineActiveMarkerChange()` 改成 manager wrapper。
  - 保留 `syncHistoryArchiveContext()` / `clearHistoryArchive()` / `syncHistoryRoundStore()` / `scheduleHistoryArchiveSync()` 在装配层，继续负责会话切换、内核同步和 refresh 调度。
- `manifest.json`
  - 在 `src/conversation-kernel.js` 后、`src/export-engine.js` 前注入 `src/history-window-manager.js`。
- 分层结果：
  - `conversation-kernel.js` 继续只管 round 数据建模、窗口快照和 diagnostics。
  - `history-window-manager.js` 专门处理宿主 DOM、spacer 和 scroll 容器。
  - `content-script.js` 进一步收敛为 orchestration。
- 验证：
  - `./scripts/build-crx.sh` 已通过，产物：
    - `dist/threadatlas.zip`
    - `dist/threadatlas.crx`
  - `node --check` 仍无法执行：当前 shell 环境没有 `node/nodejs/bun/deno`。

## Iteration 31 Goal
- 按“ThreadAtlas ChatGPT 内核重构与性能止损方案”执行一轮大重构。
- 将 ChatGPT 路径收敛为“增量索引内核 + 统一调度器 + Window First 导出”。
- 同时完成 P0/P1 止损：去轮询、降全局观察、修 storage 错误处理、补诊断面板。

## Iteration 31 Plan
- [x] 新增 `runtime-scheduler` / `conversation-kernel` / `export-engine`，并接入 `manifest`。
- [x] 将 `content-script` 改为装配层：统一初始化、内核快照、调度器刷新、导出范围策略。
- [x] 修复 P0 问题：颜色正则状态 bug、toast timer 竞争、sync 写入错误处理、选择器主路径优先。
- [x] 去掉高频轮询与整页 observer：
  - [x] `timeline-feature` 去 URL 轮询与 dataset 摘要缓存。
  - [x] `title-updater-feature` 去周期性 refresh。
  - [x] `formula-copy-feature` 去 body 级 observer。
  - [x] `markdown-patcher-feature` 去 body 级 observer。
  - [x] `sidebar-autohide-feature` 去 rebind interval。
- [x] 将文件夹存储迁移到 `Sync + Local`，保留兼容迁移与错误日志。
- [x] 新增导出渲染范围设置 `ced-export-render-scope`，渲染类导出默认走 `window`。
- [x] 在 options 页增加诊断卡片，并通过 content script 暴露内核诊断信息。
- [ ] 完成 `node --check` 与 `./scripts/build-crx.sh` 静态验证，并记录 review。

## Iteration 31 Review
- 关键架构改动：
  - 新增 `src/runtime-scheduler.js`，把 conversation / timeline / meta / enhancer 刷新统一收敛到 `requestAnimationFrame + requestIdleCallback`。
  - 新增 `src/conversation-kernel.js`，维护 rounds / turns / liveWindow / archivedWindow / selector diagnostics，并为时间轴与诊断卡片提供统一快照。
  - 新增 `src/export-engine.js`，把渲染类导出的 HTML/canvas 入口从 `content-script` 中抽成独立封装层。
- `src/content-script.js`
  - ChatGPT 主选择器改为 `"[data-testid^=\"conversation-turn-\"], [data-message-author-role]"`，`article` 只留给 fallback。
  - 修复 `patchHtml2canvasColorParser()` 与 `sanitizeStyleString()` 的全局正则 `test()` 状态 bug。
  - `showToast()` 改为单 timer，避免旧 toast 抢先关闭新 toast。
  - `persist()` 改为 callback 写入并记录 `chrome.runtime.lastError`，诊断面板可显示最近一次 storage 错误。
  - 新增 `CED_DIAGNOSTICS_GET` 消息，向 options 页提供 site key / selector mode / live rounds / archived rounds / refresh ms / storage error。
  - `refreshConversationData()` 现在会把 turns/rounds 快照写入 kernel，并把新增/恢复节点的公式复制与 Markdown 修复走增量根节点刷新。
  - `observeConversation()` 改成 scheduler 驱动，不再靠 content-script 自己的 `setTimeout + flag` 聚合链。
  - 渲染类导出新增 `ced-export-render-scope`，默认 `window`；全选长会话时不会再默认强制展开全部归档轮次。
- Feature 层收敛：
  - `src/timeline-feature.js`
    - 删除 URL 轮询。
    - 摘要缓存从 DOM `dataset` 改为 `WeakMap`。
    - `dedupeNodes()` 改为线性祖先屏蔽，去掉 O(n²) 的 `some()` 扫描。
  - `src/title-updater-feature.js`
    - 删除 1200ms 同步轮询，仅保留 history patch / popstate。
    - 额外派发 `ced-route-change` 事件，供 content-script 在 SPA 路由切换时重绑观察根。
  - `src/formula-copy-feature.js`
    - 删除 body 级 MutationObserver。
    - toast 改为单 timer。
  - `src/markdown-patcher-feature.js`
    - 删除 body 级 MutationObserver，改为显式 `refresh(root)`。
  - `src/sidebar-autohide-feature.js`
    - 删除 rebind interval，只保留 sidebar 相关 mutation 的 rAF 批处理。
  - `src/history-cleaner-feature.js`
    - 默认不再自带 observer 自动维持；ChatGPT 的自动归档逻辑收敛到 content-script/live window 策略里。
- 存储与设置：
  - `src/folder-feature.js`
    - 已迁移为 `ced-folder-prefs-v2`（sync）+ `ced-folder-catalog-v2`（local）+ `ced-folder-storage-migrated-v2`。
    - 兼容读取旧 `ced-folder-data-v1`，并统一记录 storage 错误。
  - `src/popup.js` / `src/options.html` / `src/options.css`
    - 新增“渲染导出范围”设置。
    - 新增仅设置页可见的“诊断”卡片。
- 产物与验证：
  - `./scripts/build-crx.sh` 已通过，生成：
    - `dist/threadatlas.zip`
    - `dist/threadatlas.crx`
  - `node --check` 未完成：当前 shell 环境中不存在 `node/nodejs/bun/deno`，因此无法执行 JS 语法检查；本轮只完成了人工高风险代码审查和打包验证。

---

## Iteration 32 Goal
- 继续把 ChatGPT 的 round 索引与归档状态管理从 `content-script.js` 下沉到 `conversation-kernel.js`。
- 先迁移“round 数据建模 / round store 同步 / turns<->rounds 扁平化 / 窗口状态快照”，保留真实 DOM 移动仍在 content-script。

## Iteration 32 Plan
- [x] 在 `conversation-kernel.js` 增加 round 级建模方法：group/build/renumber/flatten/find/capture state。
- [x] 将 `content-script.js` 的 ChatGPT round store 同步逻辑改为调用 kernel。
- [x] 将 `getKernelRoundsSnapshot()` / `collectTurnsFromHistoryRounds()` / `captureHistoryWindowState()` 改为读 kernel。
- [x] 保持 DOM archive/restore 仍在 content-script，避免本轮引入跳转/导出回归。
- [x] 重新打包并记录 review。

## Iteration 32 Review
- 下沉到 `conversation-kernel.js` 的能力：
  - `groupTurnsIntoRounds()`
  - `buildRoundSummary()`
  - `buildRoundMarkerId()`
  - `createRoundRecord()`
  - `buildRounds()`
  - `renumberRounds()`
  - `flattenTurns()`
  - `buildRoundSnapshots()`
  - `findRoundByIdIn()`
  - `getLatestWindowRange()`
  - `captureWindowState()`
  - `syncRoundStore()`
- `src/content-script.js`
  - `initConversationKernel()` 现在把 `cloneTurnForHistoryRound` 和 `measureHistoryRoundHeight` 作为 kernel 回调注入。
  - 原来的 `group/build/renumber/flatten/find/capture state` 本地函数改成 kernel wrapper。
  - `syncHistoryRoundStore()` 改为直接消费 kernel 返回的新 round store 和 window state。
  - `applyLatestHistoryWindow()` 的 latest range 改为读 kernel，而不是 content-script 自己计算。
- 边界说明：
  - 本轮没有把 `archiveHistoryRound()` / `restoreHistoryRound()` / `applyHistoryWindowRange()` 下沉到 kernel。
  - 这些函数仍依赖页面真实 DOM、scroll container 和 spacer 插入点，继续保留在 content-script 是有意的分层。
- 验证：
  - `./scripts/build-crx.sh` 已通过。
  - `node --check` 仍无法执行，原因同 Iteration 31：当前环境没有 `node/nodejs/bun/deno`。

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

---

## Iteration 20 Goal
- 审查当前 popup、页面导出面板、时间线预览与文件夹交互的 UI 逻辑，收敛信息层级与操作路径。
- 在不改动核心功能语义的前提下，完成一轮“产品化”视觉与交互优化，让界面更接近成熟商用品质。

## Iteration 20 Plan
- [x] 审查现有 popup / 导出面板 / 时间线预览 / 文件夹交互，明确主要体验问题。
- [x] 重构 popup 信息架构：增加概览层、区分高频控制与清理/同步模块，补齐状态反馈。
- [x] 优化页面内导出面板：加入概览区、压缩导出操作路径、统一文案与按钮层级。
- [x] 微调共享样式令牌与组件细节（圆角、阴影、hover、说明文案），提升一致性与质感。
- [x] 完成语法检查与打包验证，并补充 review。

## Iteration 20 Review
- 审查结论：
  - popup 的主要问题不是功能不够，而是缺少“连接状态 / 高频控制 / 整理动作 / 本地联动”的层级划分。
  - 页面内导出面板缺少当前会话与导出上下文概览，用户需要反复在“文件名 / 格式 / 轮次 / 按钮”之间来回扫视。
  - 时间线预览面板文案偏工具化，缺少工作台感，视觉上与主面板不够统一。
- popup 优化：
  - `src/popup.html` 重排为“Header + Hero + 实时体验 + 页面整理 + 本地联动”结构。
  - `src/popup.js` 新增当前页支持态、概览文案、状态 badge 与动作按钮可用性控制。
  - `src/popup.css` 补齐 hero、badge、统计卡片、说明文案和更稳定的按钮层级，提升首屏可读性。
- 页面内面板优化：
  - `src/content-script.js` 新增导出概览区，展示当前会话、已选轮次、导出格式、文件名。
  - 导出动作区改为更明确的执行区，按钮文案按选择状态动态更新（如“导出选中内容 (N)”）。
  - 各 section 增加说明文案，减少“看得见但不知道何时该用”的摩擦。
- 时间线预览优化：
  - `src/timeline-feature.js` 将预览面板标题升级为“时间轴工作台”，搜索与导出文案更接近实际操作语义。
  - `src/styles.css` 微调时间线 launcher、预览 header、导出区背景，与主 UI 风格统一。
- 验证：
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 21 Goal
- 检查 `History Cleaner` 与时间轴轮次采集、滚动导航和刷新调度之间是否互相影响。
- 修复重复刷新和多余解析，降低清理旧对话后对时间轴与系统占用的冲击。

## Iteration 21 Plan
- [x] 审查 `History Cleaner -> turns 采集 -> timeline refresh -> MutationObserver` 链路。
- [x] 将 History Cleaner 的轮次采集从时间轴摘要采集器中解耦，改为更轻量的节点/角色采集。
- [x] 去掉清理动作造成的重复回调与重复 observer 刷新，收紧刷新节奏。
- [x] 完成语法检查与打包验证，并补充 review。

## Iteration 21 Review
- 审查结论：
  - 时间轴当前是基于“页面上仍然存在的消息节点”工作，所以 `History Cleaner` 裁剪后，时间轴会只展示保留下来的轮次。这是当前实现下合理且必要的行为，因为被移除的旧节点已经没有跳转目标。
  - 真正的问题不在“轮次不一致”，而在性能链路：`History Cleaner` 之前直接复用了时间轴摘要采集器，并且手动清理时会重复触发 `onTrim + content observer + 二次 handleHistoryCleanerTrim`。
- 本轮修复：
  - `src/content-script.js`
    - 新增 `collectConversationTurnNodesFast()` 作为基础节点采集。
    - 时间轴继续用 `collectTimelineTurnsFast()` 做摘要采样；`History Cleaner` 改为独立的 `collectHistoryCleanerTurnsFast()`，只采 `id/role/node`，不再触发时间轴摘要缓存和文本提取。
    - 新增 `historyCleanerObserverMuteUntil` 与 `muteConversationObserverFor()`，在清理旧节点后短暂抑制主 observer 对“自己造成的删除变更”的重复响应。
    - 移除 `trimHistoryCleaner()` 中对 `handleHistoryCleanerTrim()` 的二次调用，避免一次手动清理触发两轮相同调度。
    - 抽出 `getConversationObserveTarget()`，统一主 observer 与 `History Cleaner` 的观察目标。
  - `src/history-cleaner-feature.js`
    - 新增 `getObserveTarget` 选项，优先只观察对话容器而不是整页 `document.body`。
    - 观察目标变化时会自动重绑，减少无关 DOM 变更带来的开销。
- 性能与行为结论：
  - `History Cleaner` 现在不会再额外污染时间轴的摘要缓存。
  - 手动或自动清理后，时间轴只会按保留下来的可见轮次刷新一次，不再因为删除节点再走一轮重复 observer 刷新。
  - 两者仍然共享同一份“可见消息 DOM”作为事实来源，因此时间轴与页面显示保持一致，不会出现“时间轴指向已不存在节点”的问题。
- 验证：
  - `node --check src/history-cleaner-feature.js`
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 22 Goal
- 落地“平衡方案”：保留完整历史时间轴，同时清理旧对话 DOM。
- 对已清理的旧轮次保留占位点，点击时间轴圆点可跳到占位点并按需恢复内容。

## Iteration 22 Plan
- [x] 审查 timeline 与 history cleaner 数据模型，确定 archive store + placeholder 的接入点。
- [x] 在 `content-script` 实现 archive store、placeholder 生成、历史轮次恢复和时间轴合并数据源。
- [x] 扩展 `history-cleaner-feature` 支持 trimming 前钩子，在删除前插入占位点。
- [x] 扩展 `timeline-feature` 支持 archived/restored marker 状态与激活回调。
- [x] 完成语法检查与打包验证，并补充 review。

## Iteration 22 Review
- 核心实现：
  - `src/content-script.js`
    - 新增 `historyArchive` 内存状态，按会话维度维护归档轮次。
    - `History Cleaner` 清理前先把将被移除的轮次转换成 archive chunk，并在原位置插入 `.ced-archive-placeholder`。
    - 时间轴 turns 采集改为 `live turns + archived placeholders` 合并排序，因此旧圆点会继续保留。
    - 点击 archived marker 时会滚到 placeholder，并按需恢复该轮的轻量内容视图；同一时刻只保留一个展开的归档块，控制 DOM 增长。
  - `src/history-cleaner-feature.js`
    - 新增 `beforeTrim` 钩子，在真正删除旧节点前允许外层创建 archive placeholder。
    - observer 忽略 `ced-` 节点，避免 placeholder 本身再次触发清理。
  - `src/timeline-feature.js`
    - marker 模型新增 `archived / restored / onActivate`。
    - archived marker 会在 preview 中显示“已归档/已恢复”状态。
    - 点击 marker 导航完成后会触发 marker 激活回调，用于恢复归档轮次。
  - `src/styles.css`
    - 新增 archive placeholder、restore viewer 和 archived marker 的样式。
- 当前行为：
  - 清理旧对话后，页面中的重 DOM 被移除，但原位置会留下轻量占位点。
  - 时间轴保留完整历史圆点；点击旧圆点会跳到占位点并恢复对应历史轮次内容。
  - 归档内容目前为扩展自己的轻量恢复视图，不追求还原原生 ChatGPT 交互按钮。
- 限制与后续方向：
  - 归档数据当前只保存在当前页面内存中；刷新页面后会回到宿主原始会话状态。
  - 导出链路仍然只基于当前 live turns，不包含 archive 恢复视图；如需“带归档恢复内容导出”，后续要把 archive store 并入导出数据源。
- 验证：
  - `node --check src/content-script.js`
  - `node --check src/history-cleaner-feature.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`（产出 ZIP/CRX）

---

## Iteration 23 Goal
- 将当前实现状态同步到 GitHub。
- 更新 README，确保产品说明与实际功能、限制和 ChatGPT 优先策略一致。

## Iteration 23 Plan
- [x] 审查 README 中的过时描述，并补充历史时间轴归档占位能力。
- [x] 完成 README 更新后重新打包校验。
- [ ] 提交当前变更并推送到 `origin/main`。

## Iteration 23 Review
- `README.md`
  - 重写为与当前实现一致的项目说明。
  - 删除过时描述（例如时间线可拖拽）。
  - 补充 ChatGPT 优先策略、Archived History Timeline、占位点恢复机制和当前限制。
- 打包验证：
  - `./scripts/build-crx.sh`
  - 产物：
    - `dist/chronochat-studio.zip`
    - `dist/chronochat-studio.crx`

---

## Iteration 24 Goal
- 重做扩展 popup 的桌面端布局，解决当前“过窄、过长、像移动表单”的问题。
- 让 popup 在大屏上具备更成熟的双栏信息架构，并在窄尺寸下自动回落为单栏。

## Iteration 24 Plan
- [x] 审查当前 popup HTML/CSS 结构，确认哪些区域适合拆为双栏布局。
- [x] 重构 popup 结构与样式，做桌面优先的自适应布局与控件栅格。
- [x] 完成语法检查、打包验证，并更新 review 与 lessons。

## Iteration 24 Review
- 变更文件：
  - `src/popup.html`
  - `src/popup.css`
  - `tasks/todo.md`
  - `tasks/lessons.md`
- 布局重构：
  - popup 从单列长表单改为 `Top Summary + Dual Column Grid`，顶部保留品牌与当前页状态，主体拆成“实时体验”和“页面整理/本地联动”两列。
  - 实时体验区采用两列控件栅格，减少滚动长度；清理与同步模块保持右侧堆叠，避免信息抢占主路径。
  - 宽度由固定窄栏改为 `clamp(560px, 74vw, 760px)`，优先适配桌面扩展 popup；在 `720px` 和 `560px` 断点回退为单栏。
- 视觉收敛：
  - Header 与 Hero 独立成两张顶层卡片，补齐更成熟的首屏概览，不再像移动端表单直接堆字段。
  - 统一 section、field、toggle、subsection 的圆角、阴影和栅格间距，降低视觉噪声。
- 验证：
  - `node --check src/popup.js`
  - `./scripts/build-crx.sh`

---

## Iteration 25 Goal
- 将当前“静态 HTML 归档块 + 轻量 viewer”重构为“原生 DOM 窗口化”。
- 保留完整时间轴与摘要，同时默认仅保留最新 10 轮 live DOM，并在跳转到历史轮次时无缝恢复周边原生内容。
- 进一步降低长会话下的 DOM 占用与刷新成本，避免归档/时间轴/导出三条链路互相拖慢。

## Iteration 25 Plan
- [x] 重构 ChatGPT 历史归档数据模型：从 `historyArchiveRounds` 轻量快照切换为完整 round index + 原生 DOM archive pool。
- [x] 重写自动裁剪与恢复链路：默认最新 10 轮 live，历史跳转时恢复目标轮次前后窗口，移除轻量 viewer 主路径。
- [x] 改造时间轴数据源与激活逻辑，改为读取完整 round index，而不是仅依赖 live DOM。
- [x] 接上滚动/observer/新消息增量更新，保证自动无感归档不拖慢页面。
- [x] 完成语法检查、打包验证，并补充 review。

## Iteration 25 Review
- 关键改动：
  - `src/content-script.js`
    - 新增 ChatGPT round store：完整保存每一轮的 `summary / turns / domNodes / spacer / live state`，时间轴和导出都改为基于该索引工作。
    - 归档逻辑改为“真实 DOM 节点移入 detached archive pool”，不再渲染轻量 HTML viewer。
    - 默认 latest window 为最近 10 轮；时间轴跳转到历史轮次时切换到 focus window（目标轮次前后窗口），并把真实 DOM 插回页面。
    - 新增滚动驱动的历史恢复：当活动 marker 落到 archived round 时，自动调度窗口恢复，而不是让用户面对空白历史区。
    - 渲染类导出前会暂时展开全部历史 round，导出完成后恢复窗口状态，避免截图/PDF/HTML 漏掉归档内容。
    - 新增 `ced-history-cleaner-default-on-v1` 一次性迁移键，默认开启自动无感归档。
  - `src/history-cleaner-feature.js`
    - 裁剪器新增 `applyTrim` 钩子，模块本身只负责“计轮 + 调度 + 自动维持”，具体 DOM 裁剪委托给窗口管理器。
  - `src/timeline-feature.js`
    - 新增 `onActiveChange` 回调，时间轴活动 round 变化可反向驱动历史窗口恢复。
    - archived marker 点击改为“先恢复再滚动”，降低跳转时的空占位感。
  - `src/styles.css`
    - 移除旧的 archive viewer 视觉，归档区只保留轻量 spacer 样式，恢复后不再显示扩展自绘卡片。
  - `src/popup.js`
    - 历史裁剪默认值迁移为自动维持最近 10 轮，和页面内新窗口策略保持一致。
- 静态验证：
  - `node --check src/content-script.js`
  - `node --check src/history-cleaner-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `./scripts/build-crx.sh`
- 待页面实测：
  - ChatGPT 长会话下，滚动进入历史区时的恢复手感与滚动稳定性。
  - 历史 round 恢复后，代码块/公式/复制等原生交互是否完整保持。
  - 时间轴在“latest window / focus window”切换时的高亮与跳转精度。

---


## Iteration 30 Goal
- 修复长会话下“导出不好使”的回归，优先恢复 `导出选中内容` 的语义正确性。
- 区分“导出实现回归”和“浏览器 canvas 上限”两类问题，避免把所有失败都笼统归因于会话过长。
- 为超长截图/PDF 导出增加明确的边界提示，而不是静默失败。

## Iteration 30 Plan
- [x] 梳理导出主链路，确认归档窗口化后 `exportSelection()` / render export 是否仍按选中轮次工作。
- [x] 修复渲染型导出错误地回退到整条会话的问题。
- [x] 为超长截图/PDF 渲染增加 canvas 尺寸保护与明确报错。
- [x] 完成语法检查、打包验证，并补充本轮 review。

## Iteration 30 Review
- 根因定位：
  - `exportSelection()` 语义是“导出选中内容”，但渲染型导出链路里 `buildFullHtmlDocument()` 与 `renderConversationCanvas()` 实际优先回退到了 `state.turns`，等于默认抓整条会话。
  - 这会让长会话在 HTML / Word / Screenshot / PDF 导出时直接放大 DOM 克隆、图片内联和 canvas 渲染成本；哪怕用户只选了几轮，也会按全量会话处理。
  - 对截图/PDF 来说，超长会话还会进一步撞上浏览器 canvas 边长/总像素限制，表现成“导出不好使”或无明确反馈。
- 修复内容：
  - `src/content-script.js`
    - `buildFullHtmlDocument()` 改为优先使用调用方传入的 `turns`；只有显式传入当前 `state.turns` 时才按全量路径处理。
    - `renderConversationCanvas()` 改为严格基于当前导出选择 `turns` 生成快照，不再无条件回退到整条会话。
    - `exportScreenshot()` / `exportPdf()` 改为把当前选中轮次直接传给渲染器，恢复“导出选中内容”的真实语义。
    - 新增 canvas 尺寸保护：当截图/PDF 的计划渲染尺寸超过浏览器可承受边界时，直接给出明确错误，引导改用更适合长会话的 HTML / Markdown / Word，或缩小选区。
- 结论：
  - 不是简单的“你的对话太长所以导不出”。
  - 更准确地说，是此前渲染型导出把“全量会话”当成默认输入，长会话会把这个问题放大；修复后，选区导出会明显更稳。
  - 如果你导的是整条超长会话的截图/PDF，依然可能触发浏览器 canvas 上限；这时会得到明确提示，而不是静默失败。
- 静态验证：
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`

## Iteration 29 Goal
- 解决裁剪后仍然严重卡顿的问题，重点是 ChatGPT 输入时的卡顿。
- 搜索并参考官方技术资料，定位 content script/观察器/时间线/归档链路的性能热点。
- 在不牺牲功能闭环的前提下，对输入期与长会话期的性能路径做减法。

## Iteration 29 Plan
- [x] 搜索官方技术资料，确认与浏览器扩展输入卡顿相关的性能约束。
- [x] 梳理 `src/content-script.js` 中输入期可能触发的观察、刷新、归档、时间线更新链路。
- [x] 实施最小但有效的性能优化，优先避免输入期无关刷新。
- [x] 完成语法检查、打包验证，并补充本轮 review。

## Iteration 29 Review
- 官方资料依据：
  - MDN `MutationObserver.observe()` 说明 `subtree: true` 会让目标节点整棵子树内的新增/移除都进入回调，因此观察根一旦过大，输入区 DOM 变化也会被持续送进扩展逻辑。
  - MDN `requestIdleCallback()` 明确建议把后台/低优先级工作放到空闲期，避免影响输入与动画等延迟敏感路径。
  - Chrome Developers 的 content scripts 文档强调内容脚本直接运行在页面 DOM 上，扩展自己的 DOM/观察/重排成本会直接叠加到宿主页面交互。
- 根因梳理：
  - 主内容脚本的 `MutationObserver` 之前会退回观察 `main`/滚动容器，并且 mutation 分类没有排除 composer/input subtree，导致输入时的 DOM 变化被误判为 `conversationChanged`。
  - 一旦误判，后续会串起 `scheduleHistoryArchiveSync()`、`scheduleTimelineRefresh()`、`scheduleMetaRefresh()`，输入期即使没有新轮次也会重复做时间轴、归档和侧栏刷新。
  - 另外 `sidebarAutoHide` 与 `folder` 的全局 body observer 也会在输入期接收整页 mutation，进一步放大主线程负担。
- 本轮修复：
  - `src/content-script.js`
    - 新增 `COMPOSER_IGNORE_SELECTOR` 与 `isComposerOrInputElement()`，把 textarea/contenteditable/composer/chat-input 子树从会话与 meta mutation 分类中排除。
    - 新增 `resolveConversationObserveContentRoot()`：优先根据当前消息轮次的最低公共祖先推导“消息内容根”，避免观察器轻易退回 `main` 把输入框一并纳入。
    - `getConversationObserveTarget()` 回退顺序改为“消息内容根 -> 窄选择器 -> 再退回 main”，减少观察范围。
    - `scheduleMetaRefresh()` 改为 `requestIdleCallback()` 优先、`setTimeout` 回退，把标题/文件夹这类低优先级刷新挪到空闲期。
  - `src/sidebar-autohide-feature.js`
    - 把“任何 body mutation 都立即 rebind 侧栏”改为“先判断 mutation 是否真的影响 sidebar，再在 `requestAnimationFrame` 中批量重绑”。
    - 新增 composer/input 子树排除，避免输入期无意义侧栏重找。
  - `src/folder-feature.js`
    - 侧栏 observer 同样跳过 composer/input 相关 mutation，减少输入期无关扫描。
- 预期效果：
  - 输入问题时，不再因为 composer 里的节点变化触发整条会话刷新链。
  - 自动裁剪仍然保留，但主要成本回到“真实新轮次产生时”，而不是每次键入。
  - 侧栏相关模块保持可用，但从“整页常驻高频观察”退回到更窄的相关 mutation 响应。
- 静态验证：
  - `node --check src/content-script.js`
  - `node --check src/sidebar-autohide-feature.js`
  - `node --check src/folder-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`

## Iteration 28 Goal
- 取消雪花动效默认开启，避免首次加载就出现装饰性干扰。
- 参考优秀 popup 示例与官方约束，重构当前 popup UI，降低“抽象感”和信息噪声。
- 保持 popup 作为高频控制面板，完整设置页继续承载长表单配置。

## Iteration 28 Plan
- [x] 确认雪花默认值链路与当前 popup/options 布局问题。
- [x] 阅读优秀 popup 示例与官方设计约束，整理本项目可落地的 UI 原则。
- [x] 关闭雪花默认开启，重做 popup/options 视觉层级、布局和文案。
- [x] 完成语法检查、打包验证，并补充本轮 review。

## Iteration 28 Review
- 设计依据：
  - 参考了 Chrome Developers 关于扩展 popup / user interface 的说明，以及 MDN WebExtensions 教程中的 popup 示例（如 Beastify 的简单动作面板）。
  - 本轮采纳的原则是：popup 只承载瞬时状态与高频动作，不用大段品牌文案和重装饰背景抢首屏。
- 默认值修正：
  - `src/popup.js` 与 `src/content-script.js` 新增一次性迁移键 `ced-snow-effect-default-off-v1`。
  - 雪花动效默认值改为关闭，并对已有安装做一次默认迁移，避免旧默认继续自动开启。
- popup 重构：
  - `src/popup.html` / `src/popup.css` 改为三段结构：顶部品牌与入口、当前页面状态卡、快速设置卡、页面动作卡。
  - 移除大面积 hero 渐变和抽象文案，首屏直接呈现页面状态、时间轴/归档状态和可执行动作。
  - popup 继续只保留高频控制；完整设置仍通过 `完整设置` 按钮进入 options 页面。
- options 页收口：
  - `src/options.html` / `src/options.css` 同步改为更克制的管理后台风格，统一语言为“阅读与导航 / 页面整理 / 本地同步”。
  - 将 `Snow Effect` 改为 `雪花动效`，并明确说明“默认关闭，需要时再开启”。
- 面板文案统一：
  - `src/content-script.js` 页面内设置区标题由 `Snow Effect` 改为 `雪花动效`。
- 静态验证：
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `node --check src/service-worker.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`

## Iteration 27 Goal
- 修复 ChatGPT 页面初始化时的 `Maximum call stack size exceeded`。
- 找出同步递归源，删除不必要的重入/自调用逻辑。
- 在不扩大改动面的前提下恢复扩展稳定初始化。

## Iteration 27 Plan
- [x] 检查 `src/content-script.js` 初始化链路与相关 feature 装配，定位递归源。
- [x] 实施最小化修复，移除导致同步重入的多余逻辑。
- [x] 完成语法检查，并补充本轮 review。

## Iteration 27 Review
- 根因定位：
  - `src/content-script.js` 中归档占位块函数存在同步递归：`updateHistoryRoundSpacer()` 调用 `ensureHistoryRoundSpacer()`，而 `ensureHistoryRoundSpacer()` 在已有 spacer 时又调用 `updateHistoryRoundSpacer()`。
  - 该递归会在 ChatGPT 初始化阶段自动归档旧轮次时立即触发，因此报错表现为 `init failed RangeError: Maximum call stack size exceeded`。
- 修复内容：
  - `ensureHistoryRoundSpacer()` 改为只负责“确保存在并返回 spacer”，不再在已有 spacer 时反向调用 `updateHistoryRoundSpacer()`。
  - 保留 `updateHistoryRoundSpacer()` 作为唯一的 spacer 状态/尺寸更新入口，消除同步调用环。
- 影响范围：
  - 仅修改 `src/content-script.js` 中历史归档 spacer 的职责边界，不改 popup、时间线 API、导出链路与其他 feature 行为。
- 静态验证：
  - `node --check src/content-script.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`

## Iteration 26 Goal
- 重新命名产品并重做图标，统一扩展品牌观感。
- 修复 action popup 被浏览器尺寸限制后变成“窄带”的问题。
- 将完整设置从 action popup 中拆出，改为“紧凑控制台 popup + 独立 options 页面”的成熟结构。

## Iteration 26 Plan
- [x] 统一新的产品命名，更新 manifest、README、popup/options 文案、日志前缀和打包产物名。
- [x] 重写图标生成脚本并生成一套新的品牌图标。
- [x] 新建 options 页面承载完整设置，action popup 改为紧凑布局，仅保留高频控制与入口按钮。
- [x] 完成语法检查、打包验证，并补充 review。

## Iteration 26 Review
- 品牌与产物：
  - `manifest.json` 名称与 action 标题统一为 `ThreadAtlas`，描述改为 thread-first workspace/export 定位。
  - `src/content-script.js`、`src/service-worker.js`、`scripts/dump_overview.py` 的用户可见文案与日志前缀同步改名。
  - `scripts/build-crx.sh` 输出改为 `dist/threadatlas.zip` / `dist/threadatlas.crx`，并增加旧 key `certs/chronochat-studio.pem` 的兼容回退，避免本地扩展 ID 无谓漂移。
  - `README.md` 重写为新品牌文档，并同步更新 action popup / options page / 原生归档恢复的当前架构说明。
- popup / options 架构：
  - `src/popup.html` + `src/popup.css` 重构为 420px 紧凑控制台，只保留状态摘要、高频开关、历史裁剪、本地同步和“完整设置”入口。
  - `src/options.html` + `src/options.css` 承载完整设置页，避免浏览器 action popup 的尺寸上限把表单挤成窄带。
  - `src/popup.js` 新增 `open-settings` 绑定，通过 `chrome.runtime.openOptionsPage()` 打开完整设置页，并继续复用现有实时设置下发链路。
- 图标：
  - `scripts/generate-icons.py` 改为 `ThreadAtlas` 新图标生成器，图形语言为深色 atlas/orbit 背景 + thread 节点主干，并对小尺寸图标额外加粗简化。
  - 已重新生成 `icons/icon-16.png` / `32` / `48` / `128`。
- 静态验证：
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `node --check src/service-worker.js`
  - `node --check src/timeline-feature.js`
  - `python3 -m py_compile scripts/generate-icons.py scripts/dump_overview.py`
  - `./scripts/build-crx.sh`

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

---

## Iteration 12 Goal
- ChatGPT 优先完成时间线、侧栏文件夹、上下文同步重构。
- 时间线保留 `flow/jump`，移除拖拽并优化首尾圆点、跳转与预览导出交互。
- 文件夹改为插入 ChatGPT 左侧栏分组区。
- 上下文同步落地为可用能力（端口可配、在线检测、一键同步）。

## Iteration 12 Plan
- [x] 新增存储键与接口：`ced-timeline-scroll-mode`、`ced-context-sync-enabled`、`ced-context-sync-port`。
- [x] 时间线模块重构：移除拖拽；上下内边距比例分布；支持 `flow/jump`；点击跳转兜底修复。
- [x] 时间线预览/导出改为靠近时间线自动展开，空间不足时自动翻侧。
- [x] 内容脚本解耦刷新：时间线轻量刷新不阻塞在导出全量解析。
- [x] 文件夹迁移到 ChatGPT 左侧栏分组区（分组/排序/颜色/打开会话）。
- [x] 新增上下文同步链路：popup 控制 + content capture + service worker 转发。
- [x] popup 设置对齐：新增滚动模式与上下文同步，删除拖拽时间线设置项。
- [x] 样式圆角使用 `clamp()` 做分辨率自适配。
- [x] ChatGPT 优先开关收敛：新增行为仅在 ChatGPT 激活。
- [x] 语法检查与重新打包。

## Iteration 12 Acceptance
- [x] 时间线首尾圆点完整可见，轨道上下留白稳定。
- [x] 预览/导出靠近时间线自动展开，并支持左右智能翻侧。
- [x] 点击圆点稳定跳转，滚动过程自动高亮对应圆点。
- [x] popup 的 `flow/jump` 设置实时生效，拖拽行为彻底消失。
- [x] ChatGPT 左侧栏显示文件夹分组区并可正常打开会话。
- [x] Context Sync 可在线检测并成功推送到本地服务。
- [x] 导出结果不包含时间线/预览/侧栏插入 UI。
- [x] `node --check` 与 `./scripts/build-crx.sh` 全部通过。

## Iteration 12 Review
- 关键代码变更：
  - `src/timeline-feature.js`
    - 新增 `scrollMode: flow|jump` 与 `configure(options)`，运行时可切换滚动模式。
    - 删除拖拽入口与位置持久化逻辑；时间线固定右侧展示。
    - 点位改为“上下内边距 + 比例分布”，修复首尾裁切并保持均匀铺开。
    - 预览/导出改为 hover-intent 自动展开，默认向右，不足时自动翻到左侧。
    - 点击圆点先激活再滚动，增加 DOM 重解析兜底，提升跳转稳定性。
  - `src/content-script.js`
    - 新增存储键：`ced-timeline-scroll-mode`、`ced-context-sync-enabled`、`ced-context-sync-port`。
    - MutationObserver 改为轻量通道：优先 timeline refresh + 元信息刷新；仅导出面板打开/导出中触发重解析。
    - 新增 `CED_CONTEXT_CAPTURE`，输出 Voyager 风格节点结构（role/text/rect/images）。
  - `src/folder-feature.js`
    - 新增 ChatGPT 原生侧栏插入区 `ced-folder-sidebar`，支持当前会话归档、分组/排序/颜色展示、会话跳转。
    - 保留原工作区面板管理，不接管原生会话列表。
  - `src/popup.html` / `src/popup.js` / `src/popup.css`
    - 新增 Timeline Scroll Mode（flow/jump）设置并实时下发。
    - 新增 Context Sync 卡片：启用、端口、在线状态、同步按钮（轮询检测）。
  - `src/service-worker.js`
    - 新增 runtime 消息：`CED_CONTEXT_SYNC_CHECK`、`CED_CONTEXT_SYNC_PUSH`。
    - 后台完成 localhost 可用性检测与 POST 转发，绕过页面 CSP/CORS。
  - `manifest.json`
    - 增加 host permission：`http://127.0.0.1/*`、`http://localhost/*`。
  - `src/styles.css`
    - 时间线/预览面板圆角改为 `clamp()` 自适应。
    - 删除 preview toggle 样式，新增侧栏文件夹区样式。
- 验证结果：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/folder-feature.js`
  - `node --check src/popup.js`
  - `node --check src/service-worker.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 13 Goal
- 继续降低系统占用，提升时间线与页面交互流畅度。
- 时间线预览交互改为“两段式”：靠近时间线先显示中部小图标，靠近小图标再展开预览/导出详情。
- 支持 ChatGPT 原生会话标题拖拽到左侧文件夹分组，并在拖拽过程中提供明确反馈。

## Iteration 13 Plan
- [x] 优化观察与刷新链路：MutationObserver 仅在会话相关变更时触发时间线/元信息刷新，减少无效调度。
- [x] 完成时间线两段式 hover-intent：时间线仅唤起 launcher，小图标悬停再打开预览面板，收起逻辑防抖。
- [x] 补全文件夹拖拽归档：原生会话标题可拖入分组（含未分组），并提供拖拽源/目标高亮反馈。
- [x] 增补样式与可用性细节：拖拽态样式、drop-target 样式、launcher 状态可见性细节。
- [x] 完成语法检查与重新打包，记录验证结果。

## Iteration 13 Acceptance
- [x] 长会话场景下，观察器不再对无关 DOM 变更频繁触发全链路刷新，页面交互更顺滑。
- [x] 时间线交互满足“两段式”：靠近时间线先出现中部 launcher，靠近 launcher 才展开预览/导出面板。
- [x] ChatGPT 左侧原生会话标题支持拖拽到文件夹分组，拖拽源与目标均有可见反馈。
- [x] 语法检查与 CRX 打包通过。

## Iteration 13 Review
- 关键实现：
  - `src/content-script.js`
    - 新增 MutationObserver 影响面分类（会话变更/元信息变更）与聚合延迟刷新，减少无效刷新调度。
    - `scheduleTimelineRefresh` 根据可见状态调整延时，隐藏页面时降低刷新频率。
  - `src/timeline-feature.js`
    - 时间线刷新新增 marker 签名判定，只有标记集合变化时才重绘圆点并重算坐标。
    - 保留并完善“两段式”预览逻辑：时间线 hover 仅唤起 launcher，launcher hover 才开预览。
  - `src/folder-feature.js`
    - 新增原生侧栏拖拽链路：host 级 `dragstart/dragend`、分组 `dragover/drop`。
    - 支持拖入具体文件夹或“未分组”，并在拖拽过程中高亮拖拽源与 drop target。
  - `src/styles.css`
    - 新增拖拽态样式：`ced-folder-sidebar--dragging`、`ced-folder-sidebar-group--drop-target`、`ced-folder-native-drag-source`。
- 验证结果：
  - `node --check src/content-script.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/folder-feature.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 14 Goal
- 时间轴默认开启（对现有用户进行一次性默认值迁移）。
- popup 所有显示设置做到即开即用：点击后立即在当前页面生效，保持所见即所得。

## Iteration 14 Plan
- [x] 增加时间轴默认开启迁移键并在 popup/content-script 中执行一次性迁移。
- [x] 重构 popup 设置事件链路，显示项统一实时下发到当前页面并即时渲染 UI。
- [x] 为 popup 增加打开即同步当前显示设置到页面能力，减少“已保存但未生效”窗口。
- [x] 完成语法检查与打包验证。

## Iteration 14 Acceptance
- [x] 新旧用户进入页面后，时间轴默认状态为开启（可在设置中手动关闭且后续尊重用户选择）。
- [x] popup 中显示设置点击后立即生效，当前页面可以实时看到变化。
- [x] 语法检查与打包通过。

## Iteration 14 Review
- 关键改动：
  - `src/popup.js`
    - 新增迁移键：`ced-timeline-default-on-v1`，首次运行将时间轴默认值置为开启并写回存储。
    - 设置绑定改为按控件类型实时触发（checkbox/range `input`），并返回页面应用结果。
    - 新增 `syncVisualSettingsToTab()`：popup 打开后立即将所有显示设置补丁同步到当前页面。
    - 显示设置状态提示改为“已实时应用 / 已保存但页面未连接”。
  - `src/content-script.js`
    - 同步实现一次性默认迁移，确保未打开 popup 时也会把时间轴默认开启。
- 验证结果：
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 15 Goal
- 重新验证 popup 所有功能项是否真实落地到页面行为。
- 对未完整实现的项进行补齐，保证“设置可见即有对应能力”。

## Iteration 15 Plan
- [x] 建立 popup 控件到 `storage -> content-script patch -> feature` 的功能映射审计。
- [x] 逐项核对实现链路，定位缺口并补齐实现。
- [x] 完成语法检查与重新打包。

## Iteration 15 Acceptance
- [x] popup 中每个设置项均有对应实现链路。
- [x] `文件夹层级间距` 同时作用于面板文件夹区与左侧栏文件夹分组区。
- [x] 构建与语法检查通过。

## Iteration 15 Review
- 审计结果：
  - popup 配置项均已接入 `CED_APPLY_SETTINGS_PATCH` 或对应背景消息链路。
  - 发现并修复缺口：`folderSpacing` 仅影响面板，不影响左侧栏分组区。
- 修复内容：
  - `src/folder-spacing-feature.js`
    - 将间距与纵向 padding 样式扩展到：
      - `.ced-folder-sidebar__groups`
      - `.ced-folder-sidebar-group__list`
      - `.ced-folder-sidebar-group`
      - `.ced-folder-sidebar-conversation`
- 验证结果：
  - `node --check src/popup.js`
  - `node --check src/content-script.js`
  - `node --check src/folder-spacing-feature.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 16 Goal
- 修复时间轴不可见问题，确保 ChatGPT 页面稳定显示时间轴。
- 修复左侧文件夹下拉框被持续刷新的问题，消除交互抖动。
- 将“新建文件夹”改为侧栏内联输入创建（回车/失焦创建，空值不创建）。
- 强化 popup 设置实时反馈：消息下发失败时仍可通过存储监听即时同步到页面。

## Iteration 16 Plan
- [x] 时间轴挂载容器改造与可见性兜底（避免站点 `aside` 样式干扰）。
- [x] 文件夹侧栏渲染去抖（避免聚焦中的 select 被反复重绘）并优化 observer 触发条件。
- [x] 实现侧栏内联新建文件夹输入交互，移除全局 `prompt`。
- [x] 增加 content-script 的 `chrome.storage.onChanged` 同步通道（persist=false 应用）。
- [x] 完成语法检查与打包验证，更新 review。

## Iteration 16 Acceptance
- [x] ChatGPT 页面时间轴稳定可见（启用状态下不再被站点样式隐藏）。
- [x] 侧栏“当前会话分组”下拉框点击后不再持续刷新抖动。
- [x] 侧栏新建文件夹改为内联输入：空值失焦不创建，回车或失焦可创建。
- [x] popup 设置在消息链路异常时也能通过 storage 同步快速反映到页面。
- [x] 构建与语法检查通过。

## Iteration 16 Review
- 关键改动：
  - `src/timeline-feature.js`
    - 时间轴容器从 `aside` 迁移为 `div`，并在挂载时设置可见性内联兜底样式，避免宿主站点 `aside` 规则影响。
  - `src/content-script.js`
    - `ensureTimelineMounted` 改为强制可见样式兜底。
    - 新增 `registerStorageSyncListener()`，监听 `chrome.storage.onChanged` 并用 `persist=false` 路径应用设置，提升 popup 到页面的实时反馈可靠性。
    - `applySettingsPatch(patch, options)` 支持 `persist` 开关，避免存储回写循环。
  - `src/folder-feature.js`
    - 侧栏 observer 触发条件优化：优先依据 added/removed nodes 判定，减少自触发刷新。
    - 侧栏分组下拉与列表渲染增加去重/聚焦保护，避免用户操作时反复重绘。
    - 新增侧栏内联文件夹创建输入（回车/失焦创建、空值不创建、Esc 取消），移除 `window.prompt` 创建流程。
  - `src/styles.css`
    - 新增侧栏内联创建输入样式。
- 验证结果：
  - `node --check src/folder-feature.js`
  - `node --check src/timeline-feature.js`
  - `node --check src/content-script.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 17 Goal
- 修复时间轴“偶发不可见”并增强可见性自恢复。
- 修复左侧文件夹下拉在交互中反复刷新。
- 让“新建文件夹”严格以内联输入完成（空值不创建）。
- 让 popup 设置对页面生效更稳，保证即改即见。

## Iteration 17 Plan
- [x] 增加时间轴可见性守护：定时与事件触发双通道，丢失节点自动重建。
- [x] 优化文件夹刷新：`refresh` 增量更新+无变更不重绘，阻断无意义渲染。
- [x] 增加下拉交互锁：用户展开/操作 select 时冻结 option 重写，避免抖动。
- [x] 校验并收紧内联新建文件夹流程，保证不再触发全局提示框。
- [x] 强化 popup 到页面同步：消息下发失败时自动重试并广播到匹配标签页。
- [x] 完成语法检查、打包验证，并补充 review/lessons。

## Iteration 17 Acceptance
- [x] 时间轴启用状态下稳定可见，节点丢失后可自动恢复。
- [x] 左侧“当前会话分组”下拉展开时不再反复刷新。
- [x] 新建文件夹仅在内联输入中创建：空值失焦不创建，回车或失焦创建。
- [x] popup 设置操作后页面即时反馈，失败场景有可靠回退通道。
- [x] `node --check` + `./scripts/build-crx.sh` 全部通过。

## Iteration 17 Review
- 关键改动：
  - `src/content-script.js`
    - 新增时间轴可见性守护：`registerTimelineVisibilityWatch()`（`visibilitychange + resize + interval`）双通道修复“时间轴丢失/隐藏”。
    - `initTimelineFeature()`/`syncTimelineFeatureConfig()` 增强自恢复：无节点时自动重建，启用后立刻 `scheduleTimelineEnsure(0)`。
    - `ensureTimelineMounted()` 增加强制定位/可见样式（`position/right/top/height/z-index`），降低宿主样式覆盖风险。
    - `collectSidebarConversations()` 不再每次回传 `updatedAt: Date.now()`，避免触发文件夹列表无意义刷新。
  - `src/folder-feature.js`
    - 新增“交互锁”机制：`applySelectInteractionLock()` + `renderFolderSelect()` 聚焦/锁定期间冻结 option/value 重写，防止下拉展开时抖动。
    - `scheduleSidebarEnsure()` 感知锁定窗口，延后重绘，避免用户操作过程被 observer 打断。
    - `refresh(payload)` 改为增量更新：仅数据/上下文变化时 render + persist；无变化不重绘，显著降低侧栏刷新频率。
    - `destroy()` 修复 `sidebarHost` 解绑条件，补齐新增事件监听移除。
  - `src/popup.js`
    - 新增 `applyPatchToTabAndFallback()`：先发当前活动 tab，失败后广播到当前窗口所有受支持 tab。
    - 发送前刷新活动 tab 快照（`refreshActiveTabSnapshot()`），避免 popup 打开后 tab 状态变化导致的“设置已改但页面未跟随”。
  - `src/timeline-feature.js`
    - `applyEnabledState()` 在启用态再次强制可见样式，配合 content-script 守护提升稳定性。
- 验证结果：
  - `node --check src/content-script.js`
  - `node --check src/folder-feature.js`
  - `node --check src/popup.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 18 Goal
- 修复时间轴不显示与 `Maximum call stack size exceeded`。
- 修复 popup `MAX_WRITE_OPERATIONS_PER_MINUTE` 配额报错。
- 精简同步链路，去除导致循环与高频写入的冗余逻辑。

## Iteration 18 Plan
- [x] 排查时间轴挂载链路，移除 `ensure/init` 同步递归风险并加重入保护。
- [x] 为时间轴导出控件渲染加防重入保护，避免异常情况下重入导致栈溢出。
- [x] 将 popup 设置持久化改为去抖写入，降低每分钟写入次数。
- [x] 将 `CED_APPLY_SETTINGS_PATCH` 改为页面内只应用不回写 storage，阻断重复写入环路。
- [x] 保留即时生效体验并完成语法检查与打包验证。

## Iteration 18 Acceptance
- [x] 时间轴可正常显示，且不再出现 `Maximum call stack size exceeded`。
- [x] popup 切换设置不再触发 `MAX_WRITE_OPERATIONS_PER_MINUTE`。
- [x] 设置仍保持即改即见。
- [x] `node --check` + `./scripts/build-crx.sh` 全部通过。

## Iteration 18 Review
- 关键改动：
  - `src/content-script.js`
    - 新增 `timelineMounting` 重入保护，重写时间轴缺失时的重建逻辑（先 `destroy` 再 `initialize`），移除同步递归路径。
    - `CED_APPLY_SETTINGS_PATCH` 改为 `persist: false`，避免 popup 已写 storage 后 content script 再次回写。
    - `persist()` 增加值缓存去重，跳过相同值重复写入。
  - `src/timeline-feature.js`
    - `renderExportQuick()` 增加 `isRenderingExportQuick` 防重入与“同值不写”保护，降低重入风险。
  - `src/popup.js`
    - 设置存储改为 `persistSettingDebounced()` 去抖写入，避免高频 UI 交互打爆 sync 配额。
- 验证结果：
  - `node --check src/content-script.js`
  - `node --check src/popup.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）

---

## Iteration 19 Goal
- 将 `ChatGPTHistoryCleaner` 的“裁剪旧轮次 / 自动维持最近 N 轮 / 当前轮数检查”能力迁移到当前插件。
- 保持当前项目架构清晰：新能力独立成模块，通过 popup 与 content-script 装配。
- 对现有功能做一轮整体 review，修复明显的行为缺陷与高风险实现问题。

## Iteration 19 Plan
- [x] 分析 `ChatGPTHistoryCleaner` 的 DOM 识别、轮次数学、自动维持与 popup 交互。
- [x] 在当前项目中新增独立 `history-cleaner-feature` 模块，接入 ChatGPT 页面。
- [x] 在 popup 增加 History Cleaner 配置与动作入口，并与现有设置体系对齐。
- [x] 对现有模块做整体 review，优先修复高风险 bug、回归点和明显冗余逻辑。
- [x] 完成语法检查、构建验证，并更新 review / lessons。

## Iteration 19 Acceptance
- [x] popup 中可查看当前轮数、手动裁剪旧对话、配置保留轮数和自动维持。
- [x] 自动维持仅作用于当前页面显示，不删除服务器端历史。
- [x] 新模块不污染导出内容，不破坏现有 timeline / folder / export 主流程。
- [x] 关键功能语法检查通过并可重新打包。

## Iteration 19 Review
- 外部项目分析结论：
  - `ChatGPTHistoryCleaner` 的核心功能只有三项：统计当前轮数、手动裁剪旧轮次、自动维持最近 N 轮。
  - 其原始实现依赖 `#thread` 和 “2 个节点 = 1 轮” 的旧假设，直接迁入当前项目会对新版 ChatGPT 结构不稳。
  - 本轮保留其产品能力，不直接复制其 `content/popup/background`，而是按当前项目模块化架构重写。
- 新增模块：
  - `src/history-cleaner-feature.js`
    - 独立封装：轮次统计、按最近 N 轮裁剪、MutationObserver 自动维持、裁剪回调。
    - 轮次数学改为“优先按 user 消息计轮，回退按消息数估算”，比原项目更适配新版 ChatGPT。
- 装配改动：
  - `manifest.json`
    - 注入 `src/history-cleaner-feature.js`。
  - `src/content-script.js`
    - 新增存储键：`ced-history-cleaner-keep-rounds`、`ced-history-cleaner-auto-maintain`。
    - 初始化并同步 `window.__cedHistoryCleaner`。
    - 新增消息：`CED_HISTORY_CLEANER_CHECK`、`CED_HISTORY_CLEANER_TRIM`。
    - 历史裁剪后会重置 timeline 缓存并触发 timeline / heavy refresh，同步页面其余功能状态。
  - `src/popup.html` / `src/popup.css` / `src/popup.js`
    - 新增 History Cleaner 区块：保留轮数、自动维持、查看当前轮数、裁剪旧对话。
    - popup 关闭前增加 `flushPendingStorageWrites()`，修复“最后一次设置可能未落库”的现有缺陷。
- Review 修复项：
  - 修复 popup 去抖写入在关闭过快时可能丢失最后一次变更的问题。
  - 迁移时避免引入原项目对 `#thread` 和旧 DOM 结构的强耦合，改为复用当前项目的 turn 采集链路。
- 验证结果：
  - `node --check src/history-cleaner-feature.js`
  - `node --check src/content-script.js`
  - `node --check src/popup.js`
  - `node --check src/timeline-feature.js`
  - `./scripts/build-crx.sh`（ZIP/CRX 产物生成成功）
