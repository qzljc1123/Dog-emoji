# Dog Emoji MCP

把现有的 43 张小狗表情接成一个只读 MCP App：ChatGPT 先按语境搜索候选，再选择一张表情，MCP UI 卡片直接加载 Postimages 图片。

## 数据

- `stickers.json`：运行时唯一数据源，字段为 `id / name / labels / imageUrl`
- `emojis.json`：原始图片索引，保留兼容
- `emoji-tags.json`：原始中文语义标签，保留兼容

当前 `stickers.json` 由原有两份 JSON 按 `id` 合并生成，因此不用重新上传任何图片。

## 工具

### `sticker_search`

输入短中文语境，例如“想你”“委屈”“亲亲”“开心”“道歉”，返回最多 5 个候选的：

```json
{
  "id": "dog_027",
  "name": "我好想你呀",
  "labels": ["想念", "想你", "思念", "撒娇"]
}
```

这个工具不渲染图片。工具描述也明确要求：只有表情自然适合当前回复时才使用，不要每条消息都发。

### `sticker_pick`

输入 `sticker_search` 返回的 `id`，在 `structuredContent` 中返回：

```json
{
  "id": "dog_027",
  "name": "我好想你呀",
  "labels": ["想念", "想你", "思念", "撒娇"],
  "imageUrl": "https://i.postimg.cc/..."
}
```

该工具绑定 `ui://widget/dog-sticker-v1.html`。UI 直接把 `imageUrl` 放进 `<img src>`，不会为了取图再调用第二个工具。

## UI / CSP / 刷新恢复

卡片在标准 MCP Apps 元数据中放行：

```text
https://i.postimg.cc
```

并保留 ChatGPT 兼容 CSP 字段。卡片同时支持：

- MCP Apps 标准 `ui/initialize` / `ui/notifications/tool-result` bridge
- ChatGPT 的 `window.openai.toolOutput`
- `window.openai.setWidgetState({ sticker })` 持久化
- 刷新时从 `window.openai.widgetState` 恢复

如果修改 UI、CSP 或恢复逻辑，请把 `server.js` 里的：

```text
ui://widget/dog-sticker-v1.html
```

升级成 `v2`、`v3`……然后重启 MCP，并在 ChatGPT 端刷新/更新连接，避免命中旧资源缓存。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm start
```

默认：

```text
http://localhost:8787/mcp
```

可选环境变量：

```bash
PORT=8787
MCP_PATH=/mcp
```

推荐用 MCP Inspector 先测：

```bash
npx @modelcontextprotocol/inspector@latest
```

然后依次调用：

```text
sticker_search({"query":"想你"})
sticker_pick({"id":"dog_027"})
```

## VPS 部署

在 VPS 上 clone 仓库并切到部署分支/合并后的 main：

```bash
npm install --omit=dev
PORT=8787 npm start
```

再用 Caddy 或 Nginx 把 8787 反代到公网 HTTPS 域名。例如：

```caddy
stickers.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

最终 MCP 地址：

```text
https://stickers.example.com/mcp
```

不需要 OpenAI API Key；模型仍然运行在 ChatGPT 里，这个服务只负责表情搜索、选择和 UI 展示。
