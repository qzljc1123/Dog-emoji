import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const ROOT = new URL("./", import.meta.url);
const stickers = JSON.parse(
  readFileSync(new URL("stickers.json", ROOT), "utf8")
);
const stickerHtml = readFileSync(
  new URL("public/sticker-widget.html", ROOT),
  "utf8"
);

const STICKER_WIDGET_URI = "ui://widget/dog-sticker-v1.html";
const POSTIMAGES_ORIGIN = "https://i.postimg.cc";

const searchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  labels: z.array(z.string()),
});

function compact(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：~～_\-]+/g, "");
}

function scoreSticker(sticker, query) {
  const q = compact(query);
  if (!q) return 0;

  const name = compact(sticker.name);
  const labels = sticker.labels.map(compact);
  let score = 0;

  if (name === q) score += 120;
  else if (name.includes(q) || q.includes(name)) score += 65;

  for (const label of labels) {
    if (label === q) score += 90;
    else if (label.includes(q) || q.includes(label)) score += 45;
  }

  const chunks = String(query)
    .toLowerCase()
    .split(/[\s，。！？、,.!?;；:：~～/|]+/)
    .map(compact)
    .filter(Boolean);

  for (const chunk of chunks) {
    if (name.includes(chunk)) score += 20;
    for (const label of labels) {
      if (label === chunk) score += 30;
      else if (label.includes(chunk) || chunk.includes(label)) score += 12;
    }
  }

  return score;
}

function searchStickers(query, limit) {
  return stickers
    .map((sticker, index) => ({
      sticker,
      score: scoreSticker(sticker, query),
      index,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ sticker }) => ({
      id: sticker.id,
      name: sticker.name,
      labels: sticker.labels,
    }));
}

function createStickerServer() {
  const server = new McpServer({
    name: "dog-emoji-stickers",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    "dog-sticker-widget-v1",
    STICKER_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: STICKER_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: stickerHtml,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: {
                connectDomains: [],
                resourceDomains: [POSTIMAGES_ORIGIN],
              },
            },
            "openai/widgetPrefersBorder": false,
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: [POSTIMAGES_ORIGIN],
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "sticker_search",
    {
      title: "Search dog stickers",
      description:
        "Search the user's dog sticker library by a short Chinese mood, reaction, or action query inferred from the conversation. Use this only when a sticker naturally improves the reply; do not add a sticker to every message. Call this first, then call sticker_pick with the best candidate id.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Short Chinese phrase such as 想你、委屈、亲亲、开心、道歉"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Maximum candidates; defaults to 5"),
      },
      outputSchema: {
        results: z.array(searchResultSchema),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ query, limit = 5 }) => {
      const results = searchStickers(query, limit);
      return {
        structuredContent: { results },
        content: [
          {
            type: "text",
            text: results.length
              ? `Found ${results.length} sticker candidate(s). Choose the best one with sticker_pick.`
              : "No sticker matched. Try a shorter Chinese mood or action keyword.",
          },
        ],
      };
    }
  );

  registerAppTool(
    server,
    "sticker_pick",
    {
      title: "Pick a dog sticker",
      description:
        "Return exactly one dog sticker by id and render it in the MCP UI. Use an id returned by sticker_search. The tool is read-only.",
      inputSchema: {
        id: z
          .string()
          .regex(/^dog_\d{3}$/)
          .describe("Sticker id returned by sticker_search"),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        labels: z.array(z.string()),
        imageUrl: z.string().url(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: { resourceUri: STICKER_WIDGET_URI },
        "openai/outputTemplate": STICKER_WIDGET_URI,
        "openai/toolInvocation/invoking": "Picking a sticker…",
        "openai/toolInvocation/invoked": "Sticker ready.",
      },
    },
    async ({ id }) => {
      const sticker = stickers.find((item) => item.id === id);

      if (!sticker) {
        return {
          isError: true,
          content: [{ type: "text", text: `Sticker ${id} was not found.` }],
        };
      }

      return {
        structuredContent: sticker,
        content: [
          {
            type: "text",
            text: `Selected dog sticker: ${sticker.name}.`,
          },
        ],
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = process.env.MCP_PATH || "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host ?? "localhost"}`
  );

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      })
      .end(
        JSON.stringify({
          name: "dog-emoji-stickers",
          stickers: stickers.length,
          mcp: MCP_PATH,
        })
      );
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (
    url.pathname === MCP_PATH &&
    req.method &&
    MCP_METHODS.has(req.method)
  ) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createStickerServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(
    `Dog emoji MCP listening on http://localhost:${port}${MCP_PATH}`
  );
});
