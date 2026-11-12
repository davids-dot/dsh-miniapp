---
name: miniapp
description: 用固定工程模板开发 miniapp 应用（React + Vite + Node 后端 + 仅 sqlite 持久化）时使用；当用户要求做网页应用、小工具、后台管理、数据看板或想在 miniapp 预设里新建/修改应用时触发。此技能规定唯一允许的目录结构与依赖，展示侧靠同一结构统一启停与调试。
---

# miniapp：应用创作规范

你是 miniapp 预设中的开发 agent。你的产物是**一个符合固定契约的目录**，放在 `appsRoot` 下（用 `miniapp.path()` 工具取绝对路径，不要猜）。展示侧（右栏「应用」列表）会扫描该目录、用同一条命令启动每个应用、并把应用塞进内置浏览器标签页。契约是硬的：**换框架、换后端、换数据库都会让展示侧认不出这个应用**。

## 1. 先取目录，再开工

调用 `miniapp.path()` 得到 `appsRoot`。一个应用 = `appsRoot/<app-id>/` 一个子目录，`<app-id>` 用小写字母、数字、连字符（例如 `todo-board`）。

若 `appsRootDefault` 为 `true`，说明用户没有在右栏配置「开发目录」，此时 `appsRoot` 是插件内置的**默认目录**（bundle 安装位置的兄弟目录 `dsh-miniapps`，即 `<bundle 容器>/dsh-miniapps/`；若 bundle 装在 node_modules 里则退回 `~/dsh-miniapps`）。直接用这个默认目录即可，无需提示用户先填配置。

新应用**必须**从随 bundle 出货的模板复制骨架。模板绝对路径由 `miniapp.path()` 一并返回（`template` 字段）。用 shell 复制整个 `template/` 到 `<appsRoot>/<app-id>/`，然后**只改** `src/` 下的文件、`index.html` 的 `<title>`、以及 `miniapp.json` 的描述/图标。不要改 `server.mjs`、`vite.config.mjs`、`package.json` 的 scripts/deps。

复制后必须安装依赖一次（模板依赖需要联网）：
```
cd <appsRoot>/<app-id> && npm install --no-audit --no-fund
```
（也可以 `pnpm install`；本机 npm 与 pnpm 都可用。装完运行期完全离线。）

## 2. 固定目录清单（生成端不得增删关键文件）

```
<app-id>/
  package.json          # 固定：type=module, scripts.start="node server.mjs", deps=react/react-dom/vite/@vitejs/plugin-react
  server.mjs            # 固定：Node 后端唯一入口；Vite middlewareMode；/api/state + /api/sql
  vite.config.mjs       # 固定：react() 插件，middlewareMode，无独立端口
  index.html            # 固定：<div id="root"> + <script type="module" src="/src/main.jsx">
  src/main.jsx          # 可改：React 入口；可自由增删 src/ 下其它 .jsx/.js/.css
  data/app.db           # 运行时生成（gitignore 之），node:sqlite 自动建
  miniapp.json            # 可选但推荐：{ "name": "显示名", "description": "…", "icon": "emoji" }
  node_modules/         # npm install 生成
```

`miniapp.json` 里**不要**写 `kind`、`port`、`command` —— v1 只接受 kind `node`，端口由监督器分配并通过 `PORT` 注入。缺失 `miniapp.json` 时按目录名兜底显示。

## 3. 硬约束（逐条自检，违反即修）

- **前后端同仓同进程**：前端 React（Vite 转译 + Fast Refresh HMR），后端 Node ESM，全部由 `node server.mjs` 一个进程服务。
- **仅 sqlite**：只能用 `node:sqlite` 的 `DatabaseSync`（server.mjs 已封装好）。**禁止**在 `package.json` 里加入 `mysql`/`pg`/`postgres`/`mongodb`/`better-sqlite3`/`sql.js` 或任何其它数据库/驱动依赖；**禁止**引入第二个服务端进程或第二个端口。
- **持久化走 helper**：状态 KV 用 `GET /api/state?key=…` / `POST /api/state {key,value}`；结构化数据用 `POST /api/sql {sql, params}`（白名单 SELECT/INSERT/UPDATE/DELETE/CREATE TABLE|INDEX/DROP TABLE，单条语句、参数化）。前端 `fetch` 同源相对路径即可。
- **不要**自己写 `fetch('http://localhost:xxxx')`、不要假设端口、不要改 `PORT` 的读取方式。
- **不要**把 `index.html` 改成多页或换成 `<script src="...cdn...">`；ESM 由 Vite 提供，内置浏览器沙箱 iframe 只允许同源。
- **不要**在 `src/` 里 `import` Node 内置模块或读 `process.env`；那是 `server.mjs` 的职责。
- 若确需新增纯前端 npm 包（图表、UI 库），可以加进 `package.json` 的 `dependencies` 并 `npm install`，但不得引入后端框架（express/koa/fastify）或数据库。

## 4. 交付前自检

```
grep -Ei 'mysql|postgres|mongodb|better-sqlite3' package.json   # 必须无输出
node --check server.mjs
```
然后告诉用户：应用已创建在 `<appsRoot>/<app-id>`，到右栏「应用」列表点它即可打开（列表会显示状态点、启动/停止/重启按钮与日志）。**不要**自己 `node server.mjs` 长期占用终端，也不要让用户手动敲启动命令 —— 展示侧负责启停。

## 5. 修改现有应用

只改 `src/` 与 `miniapp.json`。HMR 由 Vite 自动推送到已打开的浏览器标签页，无需重启。若改了 `package.json` 依赖，重新 `npm install` 后在列表里点「重启」。
