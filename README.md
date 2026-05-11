# cptxt

一个运行在 **Cloudflare Workers + Static Assets** 上的文本中转小工具，用于在手机和电脑之间快速传输非敏感文本。

当前实现：

- Workers 项目，不是 Pages 项目。
- 静态页面放在 `public/`。
- Worker 入口是 `src/index.js`。
- 前端访问 `/api/slots` 读写文本。
- 文本存储在 Cloudflare KV。
- 密码存储在 Cloudflare Worker 环境变量中。
- GitHub 更新后可以由 Cloudflare 自动执行 `wrangler deploy` 部署。

> 这个工具适合传输非敏感文本。它防止通过“查看网页源代码”直接看到文本，但不是端到端加密工具。

## 文件结构

```text
cptxt/
├── public/
│   ├── _headers
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   └── index.js        # Worker 入口，处理 API 并转发静态资源
├── package.json
├── README.md
└── wrangler.toml       # Workers 部署配置
```

## Cloudflare Workers 部署配置

`wrangler.toml` 当前使用 Workers Static Assets：

```toml
name = "cptxt"
main = "src/index.js"
compatibility_date = "2026-05-11"

[assets]
directory = "./public"
binding = "ASSETS"

[[kv_namespaces]]
binding = "COPYTXT_KV"
id = "replace-with-production-kv-namespace-id"
preview_id = "replace-with-preview-kv-namespace-id"
```

需要把 `id` 和 `preview_id` 替换成你自己的 KV namespace ID。

## 需要配置的 Cloudflare 资源

你需要：

1. 一个 Cloudflare Workers 项目。
2. 一个 KV namespace。
3. 两个环境变量 / secrets：
   - `REVEAL_PASSWORD`
   - `SESSION_SECRET`

## 第一步：创建 KV namespace

在 Cloudflare Dashboard：

```text
Workers & Pages -> KV -> Create a namespace
```

建议命名：

```text
cptxt-storage
```

也可以用 Wrangler 创建：

```bash
npx wrangler kv namespace create COPYTXT_KV
npx wrangler kv namespace create COPYTXT_KV --preview
```

命令会输出 KV namespace id。把输出填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "COPYTXT_KV"
id = "你的-production-kv-id"
preview_id = "你的-preview-kv-id"
```

修改后提交并推送到 GitHub。

## 第二步：创建 Workers 项目并连接 GitHub

进入 Cloudflare Dashboard：

```text
Workers & Pages -> Create application -> Workers
```

选择从 GitHub 仓库导入 / 连接仓库，选择：

```text
https://github.com/haso2007/cptxt
```

如果界面让你选择部署命令，使用：

```text
npm run deploy
```

或者直接使用：

```text
npx wrangler deploy
```

这个项目现在就是 Workers 项目，`wrangler deploy` 会读取：

```text
main = "src/index.js"
[assets]
directory = "./public"
```

因此不会再出现缺少 `main = "src/index.ts"` 的问题。

## 第三步：配置环境变量 / secrets

Worker 需要两个变量：

| 名称 | 说明 |
| --- | --- |
| `REVEAL_PASSWORD` | 点击显示、保存、删除时用于解锁的密码 |
| `SESSION_SECRET` | 用于签发临时会话 token 的随机密钥 |

推荐在 Cloudflare Dashboard 的 Worker 设置中添加 secret / variable。

也可以用 Wrangler 设置 secret：

```bash
npx wrangler secret put REVEAL_PASSWORD
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 建议使用 32 位以上随机字符串。

## 第四步：绑定 KV 到 Worker

如果 `wrangler.toml` 里的 KV id 已经填好，`wrangler deploy` 会自动使用该 binding。

你也可以在 Cloudflare Dashboard 中检查 Worker 的绑定：

```text
Worker -> Settings -> Bindings
```

确认存在：

```text
COPYTXT_KV
```

类型为 KV namespace。

## GitHub 自动部署

当 Cloudflare Workers 项目已经连接 GitHub 后：

1. 你更新代码并 push 到 GitHub。
2. Cloudflare 自动拉取最新代码。
3. 自动执行部署命令，例如 `npm run deploy`。
4. `npm run deploy` 会运行 `wrangler deploy`。
5. `wrangler deploy` 根据 `wrangler.toml` 部署 Worker 和 `public/` 静态资源。

本仓库的 `package.json`：

```json
{
  "scripts": {
    "build": "node -e \"console.log('Static assets are served from public/')\"",
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  }
}
```

## 本地开发

### 1. 创建 `.dev.vars`

在项目根目录创建 `.dev.vars`：

```text
REVEAL_PASSWORD=test-password
SESSION_SECRET=test-session-secret-change-me
```

不要提交 `.dev.vars`。

### 2. 启动本地 Worker

```bash
npm install
npm run dev
```

或：

```bash
npx wrangler dev
```

默认会启动本地 Worker，并通过 `[assets]` 提供 `public/` 下的静态页面。

## 页面测试步骤

1. 打开 Worker 地址。
2. 页面应该只显示两个文本框，没有顶部标题说明。
3. 每个文本框右上角都有 `×`。
4. 每个文本框下面有“复制”和眼睛图标。
5. 输入文本，按提示输入密码解锁。
6. 等待状态显示“已保存”。
7. 点击眼睛图标隐藏，文本框内应显示类似密码的圆点。
8. 再点眼睛图标显示，输入密码后恢复文本。
9. 点击复制，确认剪贴板内容正确。
10. 点击 `×`，确认删除后刷新仍为空。

## API 测试

### 获取状态

```bash
curl https://你的-worker域名/api/slots
```

预期：

- 返回 2 个 slot。
- 只返回 `hasContent` 和 `updatedAt`。
- 不返回真实 `text`。

### 解锁

```bash
curl -X POST https://你的-worker域名/api/slots \
  -H "Content-Type: application/json" \
  -d '{"action":"unlock","password":"你的密码"}'
```

成功后返回：

```json
{"token":"..."}
```

### 保存文本

```bash
curl -X POST https://你的-worker域名/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"slot":"1","text":"hello"}'
```

### 显示文本

```bash
curl -X POST https://你的-worker域名/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"action":"reveal","slot":"1"}'
```

### 删除文本

```bash
curl -X DELETE https://你的-worker域名/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"slot":"1"}'
```

## 源码不可见性检查

访问：

```text
view-source:https://你的-worker域名/
```

预期：

- 看不到保存的文本。
- 看不到 `REVEAL_PASSWORD`。
- 看不到 `SESSION_SECRET`。

初始请求 `/api/slots` 也不会返回正文。只有点击显示并通过密码验证后，reveal API 才会返回文本。

## 常见错误

### 报错：需要 `main = "src/index.ts"` 或 `[assets]`

现在仓库已经是 Workers 格式。如果仍然看到这个错误，检查 Cloudflare 使用的是不是最新 GitHub commit。

确认 `wrangler.toml` 包含：

```toml
main = "src/index.js"

[assets]
directory = "./public"
binding = "ASSETS"
```

### API 返回 `KV binding is not configured`

说明 KV binding 没有生效。

检查：

1. `wrangler.toml` 中 `COPYTXT_KV` 的 `id` 是否已经替换。
2. Worker Settings -> Bindings 是否存在 `COPYTXT_KV`。

### API 返回 `Password is not configured`

说明没有配置：

```text
REVEAL_PASSWORD
```

### API 返回 `Session secret is not configured`

说明没有配置：

```text
SESSION_SECRET
```

## 安全说明

这个项目做到：

- 文本不在静态页面源代码中。
- 密码不在前端代码中。
- 初始 `/api/slots` 不返回文本正文。
- 显示、保存、删除需要先通过密码解锁。
- API 响应使用 `Cache-Control: no-store`。

这个项目没有做到：

- 端到端加密。
- 防止已解锁浏览器查看 Network 响应。
- 防止 Cloudflare 账户管理员查看 KV 内容。
- 防止本机恶意软件读取剪贴板或页面内容。

请只用于非敏感文本。
