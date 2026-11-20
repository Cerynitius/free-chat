<!-- sections: intro features quickstart connect deploy settings design dev contribute license -->

# Hippocrene's Model Chat

[英文](README.md) | [简体中文](README.zh-CN.md)

![许可证 MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)
![版本 0.1.0](https://img.shields.io/badge/version-0.1.0-111111?style=flat-square)
![部署 GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-111111?style=flat-square)
[![一键部署到 Cloudflare](https://deploy.workers.dev/button)](https://deploy.workers.dev/?url=https://github.com/JiHuiYiYou/hippocrenes-model-chat)

一个 DeepSeek 风格的流式对话前端，接的是 OpenAI 兼容的 SSE 接口，带独立思考面板、代码高亮、KaTeX 公式，手机和桌面都能用。

<a id="intro"></a>
## 项目简介

**Hippocrene's Model Chat** 是一个单页对话客户端，对接 OpenAI 兼容的流式接口。界面参照 DeepSeek.com：桌面上是常驻侧边栏，手机上是底部抽屉，答案流式吐字时右下角有闪烁光标，模型的思考过程单独放在一个可折叠面板里，与正文分开显示。

它对接的上游是 `https://182.92.245.176:1920` 上的 `dsv4-flash`（DeepSeek-V4-Flash-0731-CRACK）。这个接口用 Server-Sent Events 讲 OpenAI 的 chat-completions 协议，用 `curl` 完全正常，但它一个 CORS 响应头都不给，浏览器页面没法直接调。所以仓库里带了一份零依赖的反向代理，放在 `proxy/` 目录下，专门解决浏览器需要的三件事：自己应答 CORS 预检、在服务端注入 API key、把 SSE 原样流式透传。

这个仓库里全是静态的东西：构建产物就是纯 HTML、CSS 和 JavaScript，扔到 GitHub Pages 或者任意静态服务器都能跑。没有自带的后端，没有数据库，也没有账号体系。

<a id="features"></a>
## 功能清单

| 分类 | 能力 |
|---|---|
| 流式输出 | SSE 流式返回，带打字光标；分片攒到每秒 12 次刷新，长答案也不卡 |
| 思考过程 | `reasoning_content` 单独渲染成可折叠面板，与正文分开，显示「已思考 X.X 秒」 |
| 思考档位 | 关闭 / 无 / 低 / 高 / 极限五档，作为 `reasoning_effort` 发送；服务端默认是 `low` |
| 上下文 | 每次请求把完整的多轮历史一起发回去 |
| Markdown | 支持 GitHub 风格 Markdown（含表格），用 `markdown-it` 渲染，DOMPurify 消毒 |
| 代码 | 14 种语言的语法高亮，每个代码块都带一个能用的复制按钮 |
| 数学公式 | KaTeX 渲染，行内 `$...$` 与独立成块的 `$$...$$` 都支持 |
| 消息操作 | 重新生成、随时停止生成、复制回答、把整段会话导出为 Markdown |
| 本地历史 | 会话存在本地，按今天 / 昨天 / 本周 / 更早分组，支持新建与删除 |
| 设置面板 | 连接方式、代理地址、源站地址、API key、模型、思考档位、temperature、top_p、max_tokens、系统提示词、主题、字号 |
| 诊断 | 连接测试，加上对 `/__ping` 的代理自检，报延迟、报代理手里有没有 key |
| 主题 | 浅色 / 深色 / 跟随系统 |
| 布局 | 桌面常驻侧边栏，手机抽屉，移动端用 `visualViewport` 适配软键盘 |
| 用量条 | 基于客户端估算的上下文 token 用量条 |
| 分享 | 会话编码进 URL hash，共享完全不需要后端 |
| 响应式 | 一套布局，从窄屏手机一直适配到宽屏桌面 |

明确不做：tool calling（服务端不支持）、图片输入（这个 API 没有视觉能力）、多模型切换（只有一个模型）。

<a id="quickstart"></a>
## 快速开始

跑起来有三条路。第一条是最快看到效果的路。

### 一、起本地代理（推荐第一次先走这条）

代理是一份可移植、零依赖的 Node 服务，不用注册，也不用在任何地方开账号。

```bash
git clone https://github.com/JiHuiYiYou/hippocrenes-model-chat.git
cd hippocrenes-model-chat
npm install

# Linux 与 macOS
API_KEY=sk-your-key npm run proxy
```

```powershell
# Windows PowerShell
$env:API_KEY = "sk-your-key"; npm run proxy
```

代理默认监听 `127.0.0.1:8787`，key 从 `API_KEY` 环境变量读。在碰前端之前先确认它是活的：

```bash
curl http://127.0.0.1:8787/__ping
```

然后另开一个终端起前端：

```bash
npm run dev
```

打开 `http://localhost:5173`，进设置面板，把连接方式选成**代理**，代理地址填 `http://127.0.0.1:8787`。点连接测试，源站应答之后顶部的状态点会变绿。

### 二、本地开发

```bash
npm install
npm run dev
```

开发服务器跑在 `http://localhost:5173`。聊天要用起来还是得有代理，所以把第一步的代理在另一个终端留着。只改界面的话前端自己也能跑，只是没配代理之前会报连接错误。

### 三、部署到 GitHub Pages

把仓库推到 GitHub，仓库里自带的 workflow 会自动发版。它负责构建站点、从仓库 secret 注入 key、把产物传到 Pages。

完整流程见[部署](#deploy)一节。

<a id="connect"></a>
## 接入接口

### 上游的真实契约

| 项目 | 值 |
|---|---|
| 基址 | `https://182.92.245.176:1920` |
| 协议 | 只能 https。这个端口上的明文 http 会被 nginx 挡掉。 |
| 证书 | 有效的 Let's Encrypt IP 证书，SAN 里含这个 IP，浏览器直接认，没有证书告警，也不需要任何证书绕过手段。 |
| 放行的路由 | `POST /v1/chat/completions`、`GET /v1/models`、`GET /health`。其余路径一律 `403`。 |
| 鉴权 | 每个请求都要带 `Authorization: Bearer <key>`。 |
| 流式 | 强制要求。`stream: false` 会直接被 `400 stream_required` 挡掉。 |
| 思考通道 | `delta.content`（正文）和 `delta.reasoning_content`（思考）是同一帧里两个彼此独立的字段。 |
| 结束标记 | `finish_reason: "stop"`。任何一帧里都没有 `usage` 字段。 |
| 思考档位 | 接受 `off`、`none`、`low`、`high`、`max`。 |
| 采样参数 | 支持 `system` 角色、`temperature`、`top_p`、`stop`。 |
| 工具调用 | 服务端不支持。 |

服务端永远不报 token 用量，所以用量条只能是客户端估算：中文大约 1.6 个字一个 token，拉丁文大约 4 个字符一个 token。界面上始终标成「估算」，不装成精确值。

### CORS 问题

这是理解上游最重要的一件事，所以在这里讲透。

从 `https://jihuiyiyou.github.io` 打开的页面去请求 `https://182.92.245.176:1920` 属于跨源请求。浏览器对结果按同源策略处理：请求可以发出去，但只有响应里带着匹配的 `Access-Control-Allow-Origin` 时，JavaScript 才被允许读取。上游一个这种头都没有，而且它的预检是被鉴权层应答的，不是被 CORS 处理器应答的。实测结果：

```
OPTIONS /v1/chat/completions  ->  401 Unauthorized
   （nginx 的鉴权层在预检阶段就拦掉了，压根没走到 CORS 判断）

GET /v1/models  ->  200 OK，但响应头里一个 CORS 头都没有
   （没有 Access-Control-Allow-Origin / Allow-Headers / Allow-Methods）

POST /v1/chat/completions  ->  同样零 CORS 头
```

两个互相独立的失败叠在一起：

1. **预检根本没走到 CORS 处理器。** 凡是带了 `Authorization` 或者 `Content-Type: application/json` 的请求都要先过一遍 `OPTIONS` 预检。上游的 nginx 对每个请求都鉴权，预检也不例外，直接回 `401` 加一个 HTML 错误页。浏览器到这儿就停了，真正的请求压根不会发出去。
2. **真实响应里也没有 CORS 头。** 就算预检被绕过去了，`GET /v1/models` 会带着 `200` 回来，然后被浏览器丢掉——因为响应里没有 `Access-Control-Allow-Origin`。在 JavaScript 看来，被丢掉的响应和网络失败长得一模一样：控制台里只有一句 "Failed to fetch"。

出路有三条。A 和 B 两条都不需要服务器管理员配合。

#### A、本地代理（零注册，推荐先用这条）

`proxy/` 目录里是一份可移植、零依赖的代理。`npm run proxy` 就能起，默认 `127.0.0.1:8787`，key 从 `API_KEY` 读。它自己本地应答预检并回 `204`，给每个响应补上缺失的 CORS 头，在服务端注入 key，然后把 SSE 当活流转发，不攒着。

同一份核心还能跑在 Deno Deploy 和 Vercel Edge 上，详见 `proxy/README.md`。

#### B、Cloudflare Workers（公开部署）

同一份核心适配了 Cloudflare Workers，API key 存成加密的 Worker secret，浏览器永远读不到。

```bash
cd proxy
npm install
npx wrangler login
npx wrangler secret put API_KEY     # 按提示输入 key
npx wrangler deploy
```

部署完会拿到一个 `https://<你的子域名>.workers.dev` 地址，填进**设置**里的代理地址。key 此刻在 Worker secret 里，浏览器完全接触不到。

[![一键部署到 Cloudflare](https://deploy.workers.dev/button)](https://deploy.workers.dev/?url=https://github.com/JiHuiYiYou/hippocrenes-model-chat)

用真探针验一下部署：

```bash
curl https://<你的子域名>.workers.dev/__ping
```

#### C、直连源站（可选，需要管理员改 nginx）

源站不改也能用 A 和 B。但如果想让浏览器直接调源站，把下面这段加到 `listen 1920 ssl;` 那个 server 块里：

```nginx
    # 预检短路：server 级 if 在 rewrite 阶段执行，早于 access(鉴权) 阶段
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
        add_header Access-Control-Max-Age       86400 always;
        return 204;
    }
    # 真实请求也要带 CORS 头；always 不可省（源站会回 401/403/500）
    add_header Access-Control-Allow-Origin  "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
    add_header Access-Control-Expose-Headers "Content-Type" always;
    # SSE：关掉缓冲，否则流会被攒成一坨再一次性吐出来
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 3600s;
```

有两个坑必须知道：

- **nginx 的 `add_header` 继承规则。** `location` 块里只要自己声明了一条 `add_header`，server 级的整套在这个 `location` 里**全部失效**。所以每个 `location` 都要挨个检查，把这些头手工复制进去。
- **`if` 里只能用 `return` 和 `rewrite`。** `proxy_pass` 写在 `if` 块里是非法的，nginx 会直接起不来。

用预检验证结果：

```bash
curl -i -X OPTIONS https://182.92.245.176:1920/v1/chat/completions \
  -H "Origin: https://jihuiyiyou.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

期望的答案是 `204`，外加四个 CORS 头。

### API key 的可见性

编进网页里的 key 就是发布出去的 key。key 一旦写进 JavaScript bundle，任何人打开 DevTools 都能读出来，任何人下载 bundle 也能读出来。这事没法绕开：浏览器能发出去的东西，浏览器同样能让人看见。

key 可以放在三个地方：

| 存放位置 | 浏览器能看见吗 | 建议 |
|---|---|---|
| 浏览器 `localStorage`（直连模式） | 能，拿到这台浏览器的人就能拿到 | 只用于本地开发 |
| Worker secret（代理模式） | 不能。key 由服务端在每次上游请求时注入 | 推荐 |
| 构建期仓库 secret `VITE_API_KEY`（Pages） | 能。值会出现在公开的 bundle 里 | 只能接受，前提是定期轮换、权限收窄 |

代理模式下前端压根不发 `Authorization` 头。它先问 `/__ping` 代理手里有没有 key，只有代理说自己没有的时候才退回用自己的。

不管走哪条路，都要定期轮换 key。已经躺进公开 bundle 里的 key，应当当成已经泄露处理。

<a id="deploy"></a>
## 部署

### 部署到 GitHub Pages

仓库自带一条自动构建发布的 workflow。

1. **把仓库推到 GitHub。** 目标仓库是 `https://github.com/JiHuiYiYou/hippocrenes-model-chat`。
2. **加仓库 secret。** 在**设置**、**Secrets and variables**、**Actions** 里新建一个仓库 secret，名字叫 `VITE_API_KEY`，把上游 key 填进去。这个 secret 在构建期注入，绝不会进仓库。
3. **（可选）加仓库变量。** 新建一个仓库变量 `VITE_PROXY_URL`，填你的代理地址，例如 `https://hippocrenes-model-chat-proxy.<你的子域名>.workers.dev`。填了之后访客打开站点就是「已经配好」的可用状态，不用先进设置面板；只想靠 `VITE_API_KEY` 里那个 key 就够用的话，可以不填。
4. **启用 Pages。** workflow 用的是 `enablement: true`，第一次跑就会把站点建出来。也可以自己在**设置**、**Pages** 里手动选 GitHub Actions 作为来源。
5. **推 `main` 分支。** `Deploy to GitHub Pages` 这条 workflow 会构建并发布，站点地址形如 `https://<用户名>.github.io/<仓库名>/`。

构建用的是相对路径基准（`./`），所以同一份 `dist/` 也能丢到任意静态服务器、本地磁盘，或者别的域名的子目录里跑。

### 自建部署

`dist/` 里的构建产物是纯静态站点，服务端没有任何要求，拿什么 Web 服务器托管都行。唯一需要一直活着的是代理，最省事的就是本地开发用的那份 Node runner：

```bash
API_KEY=sk-your-key node proxy/server.mjs --host 0.0.0.0 --port 8787
```

前面再套一层做 TLS 终止的反向代理。整条链必须留在 HTTPS 上：HTTPS 加载的页面不允许调用 `http://` 的接口（混合内容），而且 key 会以明文过网络。

### 部署不做的事

部署只发布静态文件。它不转发接口，不在服务端存会话，也不做限流。会话存在访客自己的浏览器里，唯一可能进浏览器的 key，只有你自己决定编译进去的那一个。

<a id="settings"></a>
## 设置项对照表

顶栏可以打开设置面板。界面目前是中文的，下表按功能列出每一项。

| 设置项 | 默认值 | 说明 |
|---|---|---|
| 连接方式 | `proxy` | `proxy` 表示所有请求都走代理地址；`direct` 表示浏览器直接调源站，只有源站给了 CORS 头才用得了。 |
| 源站地址 | `https://182.92.245.176:1920` | 上游基址，直连模式用。只能 https。 |
| 代理地址 | 构建期的 `VITE_PROXY_URL`，默认为空 | 代理基址，代理模式用。本地 Node 代理是 `http://127.0.0.1:8787`，Worker 就是它的 `workers.dev` 地址。 |
| API key | 空，回落到构建期的 `VITE_API_KEY` | Bearer 令牌。代理模式下可以留空，因为 key 由代理在服务端注入。运行时手输的会存进 `localStorage`。 |
| 模型 | `dsv4-flash` | 请求体里带的模型标识。 |
| 思考档位 | `low` | 取 `off`、`none`、`low`、`high`、`max`，作为 `reasoning_effort` 发送。 |
| temperature | `0.7` | 采样温度，作为 `temperature` 发送。 |
| top_p | `1` | 核采样截断值，作为 `top_p` 发送。 |
| max_tokens | `4096` | 生成长度上限，作为 `max_tokens` 发送。 |
| 系统提示词 | 空 | 非空时作为 `system` 消息插在最前面。 |
| 主题 | `system` | `light`、`dark`，或者跟随操作系统。 |
| 字号 | `md` | `sm`、`md`、`lg`，整体缩放界面。 |

面板底部有两个按钮。**连接测试**会调一次模型列表接口并报延迟。**代理自检**探的是 `/__ping`，它会真的打到上游，报通不通、报延迟，还报代理手里有没有 key。

<a id="design"></a>
## 设计系统

视觉语言刻意做得很安静：用发丝线代替阴影，近黑的字配浅色底，不放任何跟答案抢注意力的装饰。

### 配色 token

统一定义在 `src/styles.css` 里，暗色模式整块覆盖，工具类自动跟着变。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--color-canvas` | `#FFFFFF` | `#0E0E0D` | 页面底色 |
| `--color-canvas-2` | `#F7F6F3` | `#141413` | 次级底色 |
| `--color-canvas-3` | `#FBFBFA` | `#121211` | 三级底色 |
| `--color-surface` | `#FFFFFF` | `#161615` | 卡片、面板表面 |
| `--color-surface-2` | `#F9F9F8` | `#1C1C1A` | 弱化的表面，行内代码 |
| `--color-line` | `#EAEAEA` | `#2A2A27` | 发丝描边 |
| `--color-ink` | `#111111` | `#F2F1ED` | 主文字 |
| `--color-ink-2` | `#2F3437` | `#D6D5D0` | 次级文字 |
| `--color-muted` | `#787774` | `#8E8D87` | 三级文字 |
| `--color-faint` | `#A8A7A3` | `#6E6D68` | 四级文字 |

四组语义淡彩各有一份底色和一份字色，用来表示状态，也用来做代码高亮主题。

| 淡彩 | 底色（浅色） | 字色（浅色） | 底色（深色） | 字色（深色） |
|---|---|---|---|---|
| 红 | `#FDEBEC` | `#9F2F2D` | `#3A1E1E` | `#E3A3A1` |
| 蓝 | `#E1F3FE` | `#1F6C9F` | `#14303F` | `#8FC4E4` |
| 绿 | `#EDF3EC` | `#346538` | `#1D2E1C` | `#9CC79A` |
| 黄 | `#FBF3DB` | `#956400` | `#332912` | `#D9B570` |

### 字体

| 用途 | 字体栈 |
|---|---|
| 无衬线 | `SF Pro Display`、`Geist Variable`、`Helvetica Neue`、`PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`、`Noto Sans SC`、`system-ui`、`sans-serif` |
| 衬线 | `Newsreader`、`Lyon Text`、`Songti SC`、`Source Han Serif SC`、`Noto Serif SC`、`Georgia`、`Times New Roman`、`serif` |
| 等宽 | `Geist Mono Variable`、`SF Mono`、`JetBrains Mono`、`Cascadia Code`、`Consolas`、`PingFang SC`、`monospace` |

拉丁文字和数字走 Geist，中文交给系统字体，两边都是几何无衬线，混排不打架。字体全部自托管，运行时不请求任何 CDN。正文字号 15 像素，行高 1.6。

### 形状、层次与动效

| token | 值 | 规矩 |
|---|---|---|
| 描边 | `1px solid #EAEAEA` | 界面里所有描边都用这一条发丝线。 |
| 圆角 | 4、6、8、12 像素 | 大容器最多 12 像素，pill 圆角只留给小标签。 |
| 阴影 | `0 2px 8px rgba(0, 0, 0, 0.04)` | 全系统只有这一档层次。 |
| 主操作按钮 | `#111111` 底、白字、圆角 4 到 6 像素、无阴影 | 按下时是 `transform: scale(0.98)`。 |
| 缓动 | `cubic-bezier(0.16, 1, 0.3, 1)` | 所有过渡都用它。 |
| 动效 | 只动 `transform` 和 `opacity` | 宽高和颜色一律不参与动画。 |

不要渐变、不要霓虹、不要玻璃拟态，界面上一个 emoji 都不放。图标只用 Phosphor 的 Bold 和 Fill 两种字重。

<a id="dev"></a>
## 开发

### 技术栈

| 层 | 选型 |
|---|---|
| 界面 | React 19 配 TypeScript 5.9 |
| 构建 | Vite 8，带 React 插件和 Tailwind CSS v4 插件 |
| 样式 | Tailwind CSS v4，`src/styles.css` 里自定义 `@theme` 块 |
| 状态 | Zustand 5，三个 slice 共用一份类型模块 |
| Markdown | `markdown-it` 配 DOMPurify 消毒 |
| 代码高亮 | `highlight.js`，只注册 14 种语言 |
| 数学公式 | KaTeX，行内与块级规则是手写的插件 |
| 图标 | `@phosphor-icons/react` |
| 字体 | `@fontsource-variable/geist` 与 `@fontsource-variable/geist-mono`，自托管 |

### 命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器，http://localhost:5173
npm run proxy      # 本地代理，http://127.0.0.1:8787
npm run typecheck  # TypeScript 检查，不产出文件
npm run build      # 类型检查加生产构建，产物在 dist/
npm run preview    # 本地预览生产构建
npm run check:readme  # 检查两份 README 是否同步
```

### 目录结构

```
hippocrenes-model-chat/
├── index.html            # HTML 外壳
├── vite.config.ts        # Vite 配置，相对路径基准，@ 别名
├── tsconfig.json
├── src/
│   ├── main.tsx          # 入口
│   ├── App.tsx           # 应用外壳
│   ├── styles.css        # 设计 token 与组件类
│   ├── lib/              # api、chat、sse、markdown、hljs、tokens、
│   │                     # storage、share、export、date、clipboard
│   ├── state/            # store、三个 slice、类型、持久化
│   └── ui/               # 展示型组件
├── proxy/
│   ├── handler.js        # 共享核心：CORS、注入 key、SSE 透传
│   ├── server.mjs        # Node runner
│   ├── deno.ts           # Deno Deploy 入口
│   ├── vercel/edge.ts    # Vercel Edge 入口
│   └── wrangler.toml     # Cloudflare Workers 配置
├── tools/
│   └── check-readme-parity.mjs
└── .github/workflows/
    ├── ci.yml            # 类型检查、README 同步检查、构建
    └── deploy.yml        # 构建并发布到 GitHub Pages
```

### 状态是怎么分的

状态拆成三个 slice，共用一份类型模块，所以任何 slice 都不用 import 另一个 slice：

- `settingsSlice` 放设置和连接状态，连接测试也在这里。
- `chatSlice` 放会话和流式生命周期。收到的 SSE 分片先进缓冲，再以每秒 12 次的频率刷进 store，这样长答案不会每来一个 token 就重渲染一遍。
- `uiSlice` 放侧边栏和面板的开关、滚动位置、未读计数和 toast。

会话与设置持久化在 `localStorage` 的 `hippocrenes.chat.v1` 键下，写入有 400 毫秒防抖，最多留 50 条会话。

<a id="contribute"></a>
## 参与贡献

欢迎贡献。请先读 [CONTRIBUTING.md](CONTRIBUTING.md)：里面写了开发环境要求、提交前必须过的检查、视觉红线，以及发布流程。

<a id="license"></a>
## 许可证

以 MIT 许可证发布，完整文本见 [LICENSE](LICENSE)。

当前版本：`0.1.0`