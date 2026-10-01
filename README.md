# dsh-update-checker

DSH 插件：在设置的「插件更新」页一键检查本机已安装的第三方插件是否有上游更新，并展示更新内容（changelog）。

**只做检查，不负责安装或更新。**

## 工作方式

- 宿主端读取当前 profile 的 `package.json`，找出第三方依赖（跳过 `@deepseek-ai/*` 官方内置包）。
- 按安装来源分类检查：
  - **npm 版本号**（`^1.2.3`、`0.1.6` 等）：查询 npm registry（npmjs → npmmirror 依次回退）的 `dist-tags.latest`。
  - **GitHub 引用**（`github:owner/repo#tag`）：查询 GitHub Releases 最新版本；`#tag` 缺省时仅展示最新 Release 供参考。
  - **本地安装**（`file:...`）：标记为本地开发安装；若包声明了 GitHub 仓库，附带展示上游最新版本作参考。
- 更新内容来自 GitHub Releases（当前版本到最新版本之间的所有条目）。GitHub API 不可达时回退 jsDelivr 的 tag 列表（只有版本号，无正文）；GitHub API 匿名限额 60 次/小时/IP。
- 客户端设置页通过 Connection RPC 通道（`/dsh-update-checker`）调用宿主端。宿主端把该通道以 `kind:'prefix'` 路由挂到自身 inject 的 `webServer` 上，逐分支复刻官方 `/api` 传输协议（client-request → server-response 信封），并用 `connection.requestRejection` 做请求栅栏（旧版回退 loopback 校验）。不使用 `ctx.connection.rpc.handle`：当前 dsh 桌面构建中该方法内部访问 `owner.webServer` 会抛 `cannot get property "webServer" without inject`（dsh-pocket lib/web-rpc.js 记录了同一回归），仅作为无 webServer 的 headless 环境兜底。

## 性能与健壮性设计

- 单请求超时 8s（registry 正常 <2s）；最坏离线链条 ≈40s，不会挂死。
- GitHub API 限流（403/429，匿名 60 次/时/IP）时直接降级 jsDelivr tag 列表（版本对比仍可用，仅缺正文），不再整行报错。
- 并发 check.run 服务端去重为一次扫描，保护 registry 配额；被共享的扫描不挂调用方 signal（一个客户端离开不会杀掉其他人的结果）。
- 单条 release 正文上限 64K 字符，防止上游病态 changelog 撑爆响应与 DOM。
- 缓存文件按 profile 分离：`~/.dsh/dsh-update-checker/last-<profile>.json`（兼容读取 ≤0.2.0 的旧平铺文件）。
- 更新内容默认折叠，仅展开的行渲染正文。

## 兼容性说明

- pnpm 会在 profile 里报 `missing peer @deepseek-ai/cordis` 等警告：宿主在运行时从应用内提供这些包、不装入 profile node_modules，所有第三方插件（pocket/retrace/watcher 等）同样如此，属预期噪音。
- 需要 Node ≥22（fetch/AbortSignal.any/timeout）。
- 未来 dsh 若恢复 rpc.handle 可用，本插件的主路径（自有 webServer 路由）不受影响。
- **清理必须走 `ctx.effect`，不能靠 apply 的返回值**（≤0.2.1 的教训）：cordis 对 constructor 形态插件执行 `new apply(ctx, config)`，构造器返回的对象会被丢弃（execute 只认 `instance[symbols.init]?.()`，见 cordis lib/index.js:1066-1071），返回的 disposer 从未注册 → 纤维 dispose 时 webServer 路由残留 → 下次 HMR 重装报 `webserver: duplicate prefix route`。v0.2.2 起与 dsh-pocket（lib/index.js:401-404）一致：`ctx.effect(() => disposer)` 注册全部清理；harness 有「dispose 移除路由 + 重载干净注册」回归测试。若活宿主已残留旧版孤儿路由，重启 DSH 一次即清。

## 设置页 UI（v0.2.3 重设计）

- **状态筛选 chips**：`全部 / 有更新 / 已是最新 / 本地 / 需关注`，兼作统计摘要；点击过滤，仅显示有内容的分组。
- **默认按状态排序**（有更新 → 本地落后 → 异常 → 最新 → 本地 → 其他，同级按名称），可一键切换"按名称"。
- **发行说明 markdown 渲染**：标题/有序无序列表/引用/分隔线/代码围栏/粗体/行内代码/链接（图片降级为链接）。纯字符串→AST→React 元素，全程无 innerHTML；解析器有独立测试（`node test/md.test.mjs`，23 例）。
- **完整状态反馈**：缓存读取骨架屏、从未检查过的居中 CTA、错误横幅带"重试"、缓存超过 24h 提示"建议重新检查"、相对时间（悬停显示绝对时间）。
- **展开状态提升到页面级**：重新检查后已展开的行保持展开；"展开全部/收起全部"（可展开行 ≥2 时出现）。
- **待更新卡片左侧品牌色竖条**一眼可辨；卡片头部整行可点击展开（带旋转箭头）；计数为 0 时不再显示 `(0)`。
- 检查中按钮内置旋转 spinner（keyframes 由插件注入，fiber 卸载时清理）。

## 安装

```
dsh plugin --profile web add github:daha1216/dsh-update-checker
```

（`--profile` 按需替换；开发态可直接 `dsh plugin add "file:<本目录绝对路径>"`）

## 开发

- `index.js` — 宿主端 Cordis 插件（webServer 路由 + RPC 信封 + 请求栅栏）
- `lib/checker.js` — 检查逻辑（纯函数 + fetch，可独立测试）
- `client/client.js` — 设置页（module-loader factory 格式，手写 React.createElement）
- `locale/` — 插件卡片显示文案
- `test/harness.mjs` — 独立端到端验证：真实 cordis + mock webServer/connection + 真实 profile，`node test/harness.mjs` 运行（17 项断言）
- `test/md.test.mjs` — 设置页 markdown 解析器测试（23 例）

无运行时依赖；peer 仅 `@deepseek-ai/cordis`。

注意：修改代码后重新 `install_bundle` 需先升 `package.json` 版本号（pnpm 按 name+version 缓存 file: 打包）。宿主端自 v0.2.2 起清理经 `ctx.effect` 正确接线，remove+install 热换已验证无需重启；设置页（client/client.js）改动需刷新一次 GUI 页面加载新脚本。
