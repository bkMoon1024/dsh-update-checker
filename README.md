# dsh-update-checker

[![Version](https://img.shields.io/badge/version-0.3.1-blue)](https://github.com/daha1216/dsh-update-checker/commits/main)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4A90D9)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org)

DSH 插件：在设置的「插件更新」页一键检查本机已安装的第三方插件是否有上游更新，并展示当前版本到最新版本之间的 Release 更新内容。

**只做检查，不负责安装或更新。**

## ✨ 功能

- **一键扫描**：读取当前 profile 的依赖，逐个查询上游最新版本；npm 包、GitHub 仓库、本地 `file:` 安装都支持。
- **状态筛选**：`全部 / 有更新 / 已是最新 / 本地 / 需关注` 五个 chips，兼作统计摘要，点击即过滤。
- **更新内容**：展示「当前版本 → 最新版本」之间的所有 Release 条目，markdown 渲染（标题/列表/引用/代码/粗体/链接），默认折叠、展开才解析。
- **本地领先可辨**：本地版本高于上游时显示「本地领先上游」，不再与「本地一致」混淆。
- **缓存与配额友好**：TTL 缓存 + ETag 条件请求，GitHub 304 不消耗匿名配额；支持 `GITHUB_TOKEN` 提升限额。
- **请求统计**：页面底部显示本次扫描的请求数、缓存命中数等。
- **可访问性**：折叠行是真正的展开按钮（`aria-expanded` / `aria-controls` / `aria-label`，键盘可操作）。

## 🧭 状态含义

| 状态 | 含义 |
|---|---|
| 有更新 `update` | 上游存在比当前安装版本更新的稳定版，可展开查看更新内容。 |
| 本地落后 `local-behind` | 本地安装（`file:`）声明的版本低于上游最新版。 |
| 本地领先 `local-ahead` | 本地版本高于上游最新版（例如本地开发中、或上游回退过版本）。 |
| 已是最新 `local-latest` | 与上游最新稳定版一致。 |
| 跟踪分支 `branch` | 安装的是分支或 commit（如 `#main`、commit sha），没有可比较的版本号。 |
| 无法比较 `unknown` | 引用形式无法解析出版本（如非标准 tag）。 |
| 本地安装 `local` | 本地安装且未声明上游仓库，无参考版本。 |
| 检查失败 `error` | 查询上游时出错（网络/限流等），行内给出原因。 |

## 🔍 工作方式

- 宿主端读取当前 profile 的 `package.json`，找出第三方依赖（跳过 `@deepseek-ai/*` 官方内置包）。
- 按安装来源分类检查：
  - **npm 版本号**（`^1.2.3`、`0.1.6` 等）：查询 npm registry（npmjs → npmmirror 依次回退）的 `dist-tags.latest`。
  - **GitHub 引用**（`github:owner/repo#tag`）：查询 GitHub Releases 最新版本；`#tag` 缺省时仅展示最新 Release 供参考；分支/commit 引用判为「跟踪分支」。
  - **本地安装**（`file:...`）：标记为本地开发安装；若包声明了 GitHub 仓库，附带展示上游最新版本作参考（本地版本与上游一致 / 落后 / 领先分别标注）。
- 更新内容来自 GitHub Releases（当前版本到最新版本之间的所有条目）。GitHub API 不可达时回退 jsDelivr 的 tag 列表（只有版本号，无正文）；GitHub API 匿名限额 60 次/小时/IP，可在宿主环境设置 `GITHUB_TOKEN`（或 `GH_TOKEN`）提升限额——插件会自动以 Bearer 头发送，未设置时保持匿名。
- 客户端设置页通过 Connection RPC 通道（`/dsh-update-checker`）调用宿主端。宿主端把该通道以 `kind:'prefix'` 路由挂到自身 inject 的 `webServer` 上，逐分支复刻官方 `/api` 传输协议（client-request → server-response 信封），并用 `connection.requestRejection` 做请求栅栏（旧版回退 loopback 校验）。不使用 `ctx.connection.rpc.handle`：当前 dsh 桌面构建中该方法内部访问 `owner.webServer` 会抛 `cannot get property "webServer" without inject`（dsh-pocket lib/web-rpc.js 记录了同一回归），仅作为无 webServer 的 headless 环境兜底。
- **网络访问范围**：仅 `registry.npmjs.org`、`registry.npmmirror.com`、`api.github.com`、`data.jsdelivr.com`；不访问其他主机，不收集遥测。

## ⚡ 性能与健壮性设计（v0.3.0 重构）

- **统一出站层 `lib/http.js`**：所有 registry/CDN/GitHub 请求走同一层，提供四件套——
  - **全局限流**：并发上限 6，N 个插件 × M 个端点不会同时开 N×M 个连接；
  - **单飞合并**：同 URL 并发请求共享一次网络调用（两个插件指同一仓库只花一次 releases 查询）；
  - **TTL 缓存 + ETag 条件请求**：响应 5 分钟内直接走内存；过期但有 ETag 的条目发 `If-None-Match` 再验证，**GitHub 304 不消耗匿名配额**——重复扫描从「每次 15+ 请求」降到「几乎零成本」；
  - **主机熔断**：GitHub 403/429 后按 `x-ratelimit-reset` 短路该主机（默认 60s），后续行直接走 jsDelivr 回退，不再浪费注定失败的请求。
- **npm dist-tags 快路径**：先用 ~200B 的 `/-/package/<name>/dist-tags` 判定「已是最新」（最常见情形一个微请求收工）；只有真过期的包才拉 abbreviated packument（billion-context 这类活跃包的 packument 是 MB 级，过去每次扫描都要白拉）。
- **预发布双保险**：发行说明与「最新稳定版」判定同时看 GitHub prerelease 标记和标签形态（`-rc`/`-beta`），作者忘勾标记也不会把 rc 当稳定版。
- 单请求超时 8s，用 REF'd 定时器实现（`AbortSignal.timeout` 的定时器不保活事件循环，裸环境永不触发——库代码不能依赖宿主恰好有其他活动）；最坏离线链条 ≈40s，不会挂死。
- 失败的 URL 不缓存（每次扫描重试），成功的 URL 进 TTL 缓存；缓存条目带 etag 的过期后条件再验证。
- 并发 check.run 服务端去重为一次扫描，保护 registry 配额；被共享的扫描不挂调用方 signal（一个客户端离开不会杀掉其他人的结果）。
- 单条 release 正文上限 64K 字符，防止上游病态 changelog 撑爆响应与 DOM。
- 结果持久化原子写（tmp + rename），崩溃不会留下半截缓存文件；缓存按 profile 分离：`~/.dsh/dsh-update-checker/last-<profile>.json`（兼容读取 ≤0.2.0 的旧平铺文件，但仅在文件内记录的 `profileDir` 与当前 profile 一致时才采用）；内存缓存命中与文件回退都校验 profileDir，多 profile 宿主不串台。
- 客户端分组/过滤/排序全部 `useMemo` 化，展开单行不再触发全列表重算。
- 更新内容默认折叠，仅展开的行渲染正文（首次展开后才解析 markdown）；每次扫描的请求统计附在结果 `stats` 字段（requests/cacheHits/coalesced/revalidations/notModified），并在页面底部显示本次请求数与缓存命中数。

## 🎛 设置页 UI

- **状态筛选 chips**：`全部 / 有更新 / 已是最新 / 本地 / 需关注`，兼作统计摘要；点击过滤，仅显示有内容的分组。
- **默认按状态排序**（有更新 → 本地落后 → 异常 → 无法比较 → 最新/本地一致/本地领先 → 跟踪分支 → 本地安装，同级按名称），可一键切换"按名称"。
- **发行说明 markdown 渲染**：标题/有序无序列表/引用/分隔线/代码围栏/粗体/行内代码/链接（图片降级为链接）。纯字符串→AST→React 元素，全程无 innerHTML；解析器有独立测试（`node test/md.test.mjs`，23 例）。
- **完整状态反馈**：缓存读取骨架屏、从未检查过的居中 CTA、错误横幅带"重试"、缓存超过 24h 提示"建议重新检查"、相对时间（悬停显示绝对时间）。
- **展开状态提升到页面级**：重新检查后已展开的行保持展开；"展开全部/收起全部"（可展开行 ≥2 时出现）。
- **待更新卡片左侧品牌色竖条**一眼可辨；卡片头部整行可点击展开（带旋转箭头）；计数为 0 时不再显示 `(0)`。
- **页面统计**：底部一行显示本次扫描的请求数 / 缓存命中数。
- 检查中按钮内置旋转 spinner（keyframes 由插件注入，fiber 卸载时清理）。

## 📦 安装

```sh
# 桌面版
dsh plugin --profile desktop add github:daha1216/dsh-update-checker

# Web 部署
dsh plugin --profile web add github:daha1216/dsh-update-checker
```

装完**重启 DSH**（宿主端加载新插件），再刷新一次页面（设置页脚本）。

开发态可直接从本地目录安装：

```sh
dsh plugin --profile desktop add "file:D:\path\to\dsh-update-checker"
```

## 🔑 配置

| 环境变量 | 作用 |
|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | 以 Bearer 头发给 GitHub API，匿名 60 次/小时 → 认证 5000 次/小时。未设置时保持匿名。 |

## ⚠️ 兼容性说明

- pnpm 会在 profile 里报 `missing peer @deepseek-ai/cordis` 等警告：宿主在运行时从应用内提供这些包、不装入 profile node_modules，所有第三方插件（pocket/retrace/watcher 等）同样如此，属预期噪音。
- 需要 Node ≥22（fetch/AbortSignal.any/timeout）。
- 未来 dsh 若恢复 rpc.handle 可用，本插件的主路径（自有 webServer 路由）不受影响。
- **清理必须走 `ctx.effect`，不能靠 apply 的返回值**（≤0.2.1 的教训）：cordis 对 constructor 形态插件执行 `new apply(ctx, config)`，构造器返回的对象会被丢弃（execute 只认 `instance[symbols.init]?.()`，见 cordis lib/index.js:1066-1071），返回的 disposer 从未注册 → 纤维 dispose 时 webServer 路由残留 → 下次 HMR 重装报 `webserver: duplicate prefix route`。v0.2.2 起与 dsh-pocket（lib/index.js:401-404）一致：`ctx.effect(() => disposer)` 注册全部清理；harness 有「dispose 移除路由 + 重载干净注册」回归测试。若活宿主已残留旧版孤儿路由，重启 DSH 一次即清。

## 🛠 开发

- `index.js` — 宿主端 Cordis 插件（webServer 路由 + RPC 信封 + 请求栅栏）
- `lib/http.js` — 统一出站层（限流 / 单飞 / TTL+ETag 缓存 / 主机熔断，fetch 可注入）
- `lib/checker.js` — 检查逻辑（纯函数 + 出站层，layer 可注入）
- `client/client.js` — 设置页（module-loader factory 格式，手写 React.createElement）
- `locale/` — 插件卡片显示文案
- `npm test` — 离线测试全家桶：`test/checker.test.mjs`（纯函数 38 断言）+ `test/http.test.mjs`（出站层 19 例）+ `test/integration.test.mjs`（runCheck 集成 21 例，脚本化网络）+ `test/md.test.mjs`（markdown 23 例）+ `test/render-harness.mjs`（离线渲染冒烟）
- `npm run test:e2e` — 独立端到端：真实 cordis + mock webServer/connection + 真实 profile + 活网络（17 项断言；缓存读写走临时 home，不污染真实安装）

无运行时依赖；peer 仅 `@deepseek-ai/cordis`。

注意：修改代码后重新 `install_bundle` 需先升 `package.json` 版本号（pnpm 按 name+version 缓存 file: 打包）。宿主端自 v0.2.2 起清理经 `ctx.effect` 正确接线，remove+install 热换已验证无需重启；设置页（client/client.js）改动需刷新一次 GUI 页面加载新脚本。

## 📝 更新日志

### v0.3.1（2026-10-18）

- **缓存按 profile 隔离**：`check.last` 的文件回退现在校验文件内 `profileDir` 与当前 profile 一致，多 profile 宿主不再串台。
- **本地领先上游**：新增 `local-ahead` 状态，本地版本高于上游时显示「本地领先上游」，不再与「本地一致」混淆；本地安装行同样区分一致/落后/领先。
- **非 semver 引用判分支**：GitHub 插件安装的是分支或 commit（如 `#main`、commit sha）时判为「跟踪分支」，不再永久挂「无法比较」。
- **更新内容区间修正**：`releasesAfterTag` 改用版本比较确定停止点，上游 tag 无 `v` 前缀时也不会混入更旧版本的 release。
- **GitHub 配额**：支持 `GITHUB_TOKEN` / `GH_TOKEN`（Bearer 头），未设置时保持匿名。
- **可访问性与渲染**：折叠行改为真正的展开按钮（`aria-expanded`/`aria-controls`/`aria-label`，键盘可操作）；更新正文首次展开才解析渲染；无正文的 release 行不再显示空折叠区。
- **页面统计**：结果页底部显示本次扫描的请求数与缓存命中数。
- **样式作用域**：`prefers-reduced-motion` 规则收窄到插件页面，不再影响整个 DSH UI。
- **排序统一**：宿主与客户端使用同一状态排序表。
- 测试：离线 101 断言 + 渲染冒烟；E2E 17 项（缓存读写改用临时 home，不污染真实安装）。

### v0.3.0（2026-10-17）

- 完整重构：统一出站层（限流/单飞/TTL+ETag 缓存/主机熔断）、npm dist-tags 快路径、预发布双保险、原子持久化、useMemo 化；新增 http/integration 测试（离线 58 例 + E2E 17 例全绿）。

### v0.2.3

- 首次开源：设置页「插件更新」页、按安装来源分类检查、Release 更新内容展示、jsDelivr 回退、markdown 渲染。

## 📄 License

MIT © [daha1216](https://github.com/daha1216)

## 🔗 相关

- 收录于 [dsh-plugin-collection](https://github.com/daha1216/dsh-plugin-collection)（DSH 第三方插件精选目录）。
- 同作者的插件：[dsh-retrace](https://github.com/daha1216/dsh-retrace)、[dsh-watcher](https://github.com/daha1216/dsh-watcher)、[dsh-skills-manager](https://github.com/daha1216/dsh-skills-manager)。
