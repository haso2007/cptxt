# copytxt

一个用于在手机和电脑之间快速传输非敏感文本的 Cloudflare Pages 页面。

页面特点：

- 适合手机显示和触控操作。
- 共有 2 个文本框。
- 每个文本框右上角有 `×`，用于快速删除该文本框内容。
- 每个文本框下方有“复制”按钮和眼睛图标按钮。
- 点击眼睛图标可以隐藏/显示文本。
- 点击显示时需要输入密码。
- 密码配置在 Cloudflare Pages 环境变量中，不写在前端代码里。
- 文本内容存储在 Cloudflare KV 中，不会出现在网页 HTML/JS/CSS 源文件里。

> 这个工具适合传输非敏感文本。它防止通过“查看网页源代码”直接看到文本，但不是端到端加密工具。显示后，文本仍会出现在浏览器页面、浏览器内存和 API 响应中。

## 文件结构

```text
copytxt/
├── functions/
│   └── api/
│       └── slots.js       # Cloudflare Pages Function API
├── public/
│   ├── _headers           # 静态资源安全响应头
│   ├── app.js             # 前端交互逻辑
│   ├── index.html         # 页面结构
│   └── styles.css         # 移动端样式
├── README.md
└── wrangler.toml          # Cloudflare Pages / KV 配置
```

## 工作原理

### 前端

用户打开页面后，前端只会调用：

```text
GET /api/slots
```

这个接口只返回两个文本框是否有内容、更新时间等元数据，不返回真实文本内容。

当用户点击眼睛图标显示文本时，页面会要求输入密码。密码验证通过后，前端再调用 API 获取对应文本框的内容。

### 后端

后端由 Cloudflare Pages Functions 提供：

```text
functions/api/slots.js
```

它负责：

- 读取 Cloudflare KV 中的文本。
- 保存文本到 Cloudflare KV。
- 删除文本。
- 校验密码。
- 签发当前标签页使用的临时 token。

### 存储

文本存储在 Cloudflare KV 中，使用 binding：

```text
COPYTXT_KV
```

KV key：

```text
slot:1
slot:2
```

KV value 示例：

```json
{
  "text": "文本内容",
  "updatedAt": "2026-05-11T00:00:00.000Z"
}
```

## 需要配置的 Cloudflare 资源

你需要准备：

1. 一个 Cloudflare Pages 项目。
2. 一个 Cloudflare KV namespace。
3. 两个 Pages 环境变量。

## 环境变量

在 Cloudflare Pages 项目里配置以下环境变量：

| 名称 | 说明 |
| --- | --- |
| `REVEAL_PASSWORD` | 点击显示、保存、删除时用于解锁的密码 |
| `SESSION_SECRET` | 用于签发临时会话 token 的随机密钥 |

建议：

- `REVEAL_PASSWORD` 使用你自己容易输入但不容易猜的密码。
- `SESSION_SECRET` 使用长随机字符串，例如 32 位以上。
- 不要把真实密码写入 Git、README 或前端代码。

## Cloudflare Pages 控制台部署

### 1. 创建 KV namespace

进入 Cloudflare Dashboard：

```text
Workers & Pages -> KV -> Create a namespace
```

可以命名为：

```text
copytxt-storage
```

### 2. 创建 Pages 项目

进入：

```text
Workers & Pages -> Pages -> Create a project
```

必须选择 **Pages** 项目，不要选择 **Workers** 项目。

如果你使用 GitHub/GitLab：

1. 把当前目录提交到一个仓库。
2. 在 Cloudflare Pages 选择该仓库。
3. 构建设置填写：

```text
Framework preset: None
Build command: npm run build
Build output directory: public
Root directory: 如果仓库根目录就是 copytxt，则留空；否则填 copytxt 所在路径
```

不要把构建命令设置为：

```text
npx wrangler deploy
```

`wrangler deploy` 是 Workers 部署命令，会要求 `main = "src/index.ts"` 或 `[assets]` 配置；这个项目使用的是 Cloudflare Pages + Pages Functions，所以应该通过 Pages 的 GitHub 集成部署。

### 3. 绑定 KV

进入 Pages 项目设置：

```text
Settings -> Functions -> KV namespace bindings
```

添加 binding：

```text
Variable name: COPYTXT_KV
KV namespace: copytxt-storage
```

Production 和 Preview 环境都建议绑定。你可以：

- Production 使用正式 namespace。
- Preview 使用单独的测试 namespace。

### 4. 配置环境变量

进入 Pages 项目设置：

```text
Settings -> Environment variables
```

添加：

```text
REVEAL_PASSWORD=你的显示密码
SESSION_SECRET=一段长随机字符串
```

Production 和 Preview 环境都需要配置。

### 5. 部署

保存设置后触发部署。

部署完成后访问 Cloudflare Pages 提供的域名即可测试。

## 使用 Wrangler 部署

如果你想用命令行部署，需要先登录：

```bash
npx wrangler login
```

### 1. 创建 KV namespace

创建正式环境 KV：

```bash
npx wrangler kv namespace create COPYTXT_KV
```

创建预览环境 KV：

```bash
npx wrangler kv namespace create COPYTXT_KV --preview
```

命令会输出类似：

```toml
[[kv_namespaces]]
binding = "COPYTXT_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

以及 preview namespace 的 id。

### 2. 更新 `wrangler.toml`

打开 `wrangler.toml`，把占位值替换为真实 id：

```toml
[[kv_namespaces]]
binding = "COPYTXT_KV"
id = "你的-production-kv-id"
preview_id = "你的-preview-kv-id"
```

### 3. 配置 Pages 环境变量

可以在 Cloudflare Dashboard 中配置，也可以用 Wrangler 设置 secret。

推荐直接在 Dashboard 的 Pages 项目设置中配置：

```text
REVEAL_PASSWORD
SESSION_SECRET
```

### 4. 部署 Pages

```bash
npx wrangler pages deploy public --project-name copytxt
```

如果还没有创建 Pages 项目，Wrangler 会提示创建或关联项目。

## 本地开发和测试

### 1. 创建本地环境变量文件

在项目根目录创建 `.dev.vars`：

```text
REVEAL_PASSWORD=test-password
SESSION_SECRET=test-session-secret-change-me
```

不要把 `.dev.vars` 提交到仓库，因为它可能包含真实密码。

### 2. 启动本地 Pages dev

```bash
npx wrangler pages dev public --kv COPYTXT_KV
```

默认访问地址通常是：

```text
http://localhost:8788
```

### 3. 页面测试步骤

打开页面后建议按这个顺序测试：

1. 页面只显示 2 个文本框。
2. 每个文本框右上角都有 `×`。
3. 每个文本框下方只有“复制”和眼睛图标按钮。
4. 在文本框 1 输入一段测试文本。
5. 如果提示输入密码，输入 `.dev.vars` 中的 `REVEAL_PASSWORD`。
6. 等待状态显示“已保存”。
7. 刷新页面。
8. 文本框应处于隐藏状态，不直接显示正文。
9. 点击眼睛图标。
10. 输入正确密码后，文本应恢复显示。
11. 点击复制，确认剪贴板内容正确。
12. 点击右上角 `×`，确认删除后刷新页面，文本不再存在。

## API 测试

本地启动后，可以用 curl 测试 API。

### 获取文本框状态

```bash
curl http://localhost:8788/api/slots
```

预期：

- 返回两个 slot。
- 返回 `hasContent` 和 `updatedAt`。
- 不返回 `text` 字段。
- 不包含真实文本内容。

示例：

```json
{
  "slots": [
    { "id": "1", "hasContent": true, "updatedAt": "2026-05-11T00:00:00.000Z" },
    { "id": "2", "hasContent": false, "updatedAt": null }
  ]
}
```

### 错误密码解锁

```bash
curl -X POST http://localhost:8788/api/slots \
  -H "Content-Type: application/json" \
  -d '{"action":"unlock","password":"wrong"}'
```

预期：

```json
{"error":"Invalid password"}
```

HTTP 状态码应为 `401`。

### 正确密码解锁

```bash
curl -X POST http://localhost:8788/api/slots \
  -H "Content-Type: application/json" \
  -d '{"action":"unlock","password":"test-password"}'
```

预期返回 token：

```json
{"token":"..."}
```

后续保存、显示、删除时需要把 token 放到请求头：

```text
Authorization: Bearer <token>
```

### 保存文本

```bash
curl -X POST http://localhost:8788/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"slot":"1","text":"hello"}'
```

### 显示文本

```bash
curl -X POST http://localhost:8788/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"action":"reveal","slot":"1"}'
```

预期返回：

```json
{
  "slot": "1",
  "text": "hello",
  "updatedAt": "...",
  "token": "..."
}
```

### 删除文本

```bash
curl -X DELETE http://localhost:8788/api/slots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"slot":"1"}'
```

## 源码不可见性检查

部署后可以检查：

```text
view-source:https://你的域名/
```

预期：

- 看不到你保存的文本内容。
- 看不到 `REVEAL_PASSWORD`。
- 看不到 `SESSION_SECRET`。

再打开浏览器开发者工具检查：

```text
Network -> /api/slots
```

预期：

- `/api/slots` 初始请求只返回元数据。
- 不返回 `text` 字段。

注意：当你点击眼睛图标并成功显示文本时，`POST /api/slots` 的 reveal 响应会包含文本，这是正常的，因为浏览器需要拿到正文才能显示。

## 安全说明

这个项目做到了：

- 密码不在前端源码中。
- 文本不在 HTML/JS/CSS 静态文件中。
- 初始页面加载不会返回文本正文。
- 显示、保存、删除需要先通过密码解锁。
- API 响应设置了 `Cache-Control: no-store`。
- 静态文件设置了基础安全响应头。

这个项目没有做到：

- 端到端加密。
- 防止已经解锁的浏览器查看 Network 响应。
- 防止拥有 Cloudflare 账户权限的人查看 KV 内容。
- 防止终端设备本身被恶意软件读取剪贴板或页面内容。

所以请只用于非敏感文本。

## 常见问题

### 部署后页面能打开，但保存或显示失败

检查：

1. Pages Functions 是否启用。
2. `functions/api/slots.js` 是否已经随项目部署。
3. KV binding 名称是否正好是 `COPYTXT_KV`。
4. 是否在 Production 环境配置了 `REVEAL_PASSWORD`。
5. 是否在 Production 环境配置了 `SESSION_SECRET`。

### 部署日志提示需要 `main = "src/index.ts"` 或 `[assets]`

这说明当前项目被当作 Cloudflare Workers 部署了，或者构建命令错误地设置成了：

```text
npx wrangler deploy
```

处理方式：

1. 回到 Cloudflare Dashboard。
2. 创建或进入 **Workers & Pages -> Pages** 项目。
3. 确认不是 Workers 项目。
4. Settings / Build settings 中确认：

```text
Build command: npm run build
Build output directory: public
```

5. 重新部署。

不要按日志提示给本项目添加 `main = "src/index.ts"`，因为本项目使用的是 Pages Functions，不是单个 Worker 入口文件。

### API 返回 `KV binding is not configured`

说明 Cloudflare Pages 项目没有正确绑定 KV。

到：

```text
Settings -> Functions -> KV namespace bindings
```

确认变量名必须是：

```text
COPYTXT_KV
```

### API 返回 `Password is not configured`

说明没有配置：

```text
REVEAL_PASSWORD
```

注意 Preview 和 Production 环境变量是分开的。

### API 返回 `Session secret is not configured`

说明没有配置：

```text
SESSION_SECRET
```

### 手机输入后没有保存

可能原因：

1. 没有输入正确密码解锁。
2. 网络请求失败。
3. KV binding 没配置。
4. 文本超过 50000 字符。

页面每个文本框底部会显示简短状态，例如“已保存”“保存失败”“需要密码”。

### 为什么隐藏后刷新页面仍需要点显示

这是设计行为。页面初始加载只返回元数据，不返回正文，防止打开页面或查看初始网络请求时直接拿到文本。

### 为什么保存和删除也需要密码

虽然最初需求只要求“显示”时输入密码，但如果保存和删除不需要密码，任何知道页面 URL 的人都可以覆盖或删除文本。因此当前实现会在保存、显示、删除前都要求当前标签页先解锁一次。

## 修改密码

在 Cloudflare Pages 项目中修改环境变量：

```text
REVEAL_PASSWORD
```

保存后重新部署或等待 Cloudflare 应用配置。

已经打开的浏览器标签页如果之前解锁过，可能仍有短期 token。关闭标签页或清除 sessionStorage 后会重新要求输入密码。

## 修改文本框数量

当前实现固定为 2 个文本框。

如果以后要改数量，需要同步修改：

- `public/index.html`
- `public/app.js` 中的 `slots`
- `functions/api/slots.js` 中的 `SLOT_IDS`
