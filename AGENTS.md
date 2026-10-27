# AGENTS.md

## 项目定位

DSH（DeepSeek Harness）插件更新巡检器：只读扫描 profile 依赖，聚合 npm registry / GitHub Releases，提供设置页扫描、后台定时巡检与侧边栏提醒。宿主端在 `index.js`，客户端在 `client/client.js`。

## 怎么跑

```bash
npm install        # 只为 lifecycle / reminder-scheduler 套件安装 devDependency @deepseek-ai/cordis
npm test           # 11 个离线套件
npm run test:e2e   # test/harness.mjs：真实 cordis + 真实 socket
```

安装到 DSH：`dsh plugin --profile desktop add github:daha1216/dsh-update-checker`（完整命令见 README）。

## 技术栈与约定

- Node >= 22，纯 ESM，无运行时依赖；Cordis 4 宿主插件，`inject: ['webServer','connection','profileContext']`。
- 客户端由 `window.__ModuleLoader__.load` 加载，React 由宿主提供；接口文案走内联 zh/en 字典。
- 测试是原生 `node:assert` 脚本，没有测试框架；每个修复必须带回归断言。
- 新增测试套件要同时加进 `package.json` 的 `test` 链和两份 README 的测试矩阵。
- 用户可见变更写进 `README.md` 的「未发布」小节（中文为准），英文 README 同步数字与要点。

## 目录

- `index.js`：路由注册、RPC 分发、后台调度器、fiber 生命周期；新路由必须经过 `connection.requestRejection` / loopback 栅栏。
- `lib/checker.js`：纯函数（版本比较、spec 解析）与检查编排；`lib/http.js`：出站层（TTL 缓存、单飞、超时、熔断）；`lib/reminder.js`：提醒状态与原子写。
- `client/client.js`：设置页与侧边栏提醒；外链必须走 `safeHref`，Markdown 只渲染文本节点。
- `test/host.test.mjs` 是需要真实 socket 的宿主半边测试；`test/harness.mjs` 是 e2e，不进 `npm test`。

## 当前状态（2026-10-27）

- `v0.7.1` 已发布；工作区上是未发布的安全/健壮性巡检修复，尚未打新 tag。
- 测试：11 套件 / 362 断言 + e2e 17 场景全绿。
- 已知限制：RPC 没有速率限制；无 `requestRejection` 的旧构建走回退栅栏时无鉴权；批量更新的成功提示在异步新建会话失败时无法回改（只能兜底保住 prompt）。
