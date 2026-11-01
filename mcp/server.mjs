#!/usr/bin/env node
// Axolotl MCP server: lets an agent check a website's agent-readiness over stdio.
//   axolotl_check  free, seconds: 26 site checks (no TinyFish agents)
//   axolotl_scan   full scan: TinyFish agents try real tasks (3-4 minutes, uses TinyFish credits)
// Set AXOLOTL_URL to the address of a running Axolotl deployment, and TINYFISH_API_KEY to your own
// TinyFish key (axolotl_scan runs on your TinyFish account; axolotl_check needs no key).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.AXOLOTL_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = (process.env.TINYFISH_API_KEY || "").trim();
const TYPES = ["booking", "shop", "saas", "docs", "lead", "custom"];

const server = new McpServer({ name: "axolotl", version: "0.1.0" });

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

const input = {
  url: z.string().describe("Public address of the site, e.g. example.com"),
  type: z.enum(TYPES).default("custom").describe("booking, shop, saas, docs, lead (lead-gen forms) or custom"),
};

server.registerTool(
  "axolotl_check",
  {
    title: "Check a site for agent-readiness (free)",
    description:
      "Runs Axolotl's 26 site checks (structured data, headings, labels, robots.txt, sitemap, llms.txt, speed, CAPTCHAs and more) and returns a score out of 100 with failed checks and fixes. Takes seconds and uses no TinyFish credits. Does not run agents, so it cannot say whether a task like checkout actually works.",
    inputSchema: input,
  },
  async ({ url, type }) => {
    try {
      const res = await fetch(`${BASE}/api/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, type }), signal: AbortSignal.timeout(60_000) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? text(data) : fail(data.error || `Axolotl returned ${res.status}`);
    } catch (e) {
      return fail(`Could not reach Axolotl at ${BASE}: ${e.message}`);
    }
  },
);

server.registerTool(
  "axolotl_scan",
  {
    title: "Full agent-experience scan (uses credits)",
    description:
      "Sends real TinyFish web agents to the site to attempt tasks that matter for its type (find a product, reach checkout, and so on) plus the 26 site checks. Returns the score, grade-ready dimension scores, per-task results and ranked fixes. Takes 3-4 minutes and spends the user's own TinyFish credits (roughly $1; needs TINYFISH_API_KEY set in this server's environment), so use axolotl_check first and only run this when the user wants the full scan. The agents never submit, pay or sign up.",
    inputSchema: { ...input, description: z.string().optional().describe("For type=custom: what the site is and what visitors should be able to do") },
  },
  async ({ url, type, description }) => {
    if (!KEY) return fail("axolotl_scan needs your TinyFish key. Set TINYFISH_API_KEY in this MCP server's environment (get one at tinyfish.ai), then restart it. axolotl_check works without a key.");
    try {
      const res = await fetch(`${BASE}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json", "X-TinyFish-Key": KEY }, body: JSON.stringify({ url, type, description }), signal: AbortSignal.timeout(320_000) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        return fail(data.error || `Axolotl returned ${res.status}`);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let result = null;
      let error = null;
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "result") result = event;
          if (event.type === "error") error = event.message;
        }
      }
      if (result) return text({ cached: !!result.cached, ...result.result });
      return fail(error || "The scan ended without a result.");
    } catch (e) {
      return fail(`Scan failed: ${e.message}`);
    }
  },
);

await server.connect(new StdioServerTransport());
