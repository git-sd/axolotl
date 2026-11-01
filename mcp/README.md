# Axolotl MCP server

Lets an AI agent check how ready a website is for AI agents, using a running Axolotl deployment.

| Tool | Cost | Time | What it does |
| --- | --- | --- | --- |
| `axolotl_check` | Free | Seconds | Runs the 26 site checks and returns a score, per-dimension scores, failed checks and fixes. No agents run. |
| `axolotl_scan` | Uses your TinyFish credits (about $1) | 3 to 4 minutes | Full scan: TinyFish agents attempt real tasks, plus the checks. Returns the score, task results and ranked fixes. Needs your TinyFish key. |

## Set up

```bash
cd mcp
npm install
```

Point it at your Axolotl deployment with `AXOLOTL_URL` (default `http://localhost:3000`). For `axolotl_scan`, also set `TINYFISH_API_KEY` to your own TinyFish key; the scan then runs on your TinyFish account and does not use the deployment's budget. Without a key only `axolotl_check` works. The key is sent to your Axolotl deployment in the `X-TinyFish-Key` header, so only point `AXOLOTL_URL` at a deployment you trust, over https.

**Claude Code**

```bash
claude mcp add axolotl --env AXOLOTL_URL=https://your-axolotl.vercel.app --env TINYFISH_API_KEY=your-key -- node /path/to/axolotl/mcp/server.mjs
```

**Claude desktop, Cursor and others** (`mcpServers` in the client's config):

```json
{
  "mcpServers": {
    "axolotl": {
      "command": "node",
      "args": ["/path/to/axolotl/mcp/server.mjs"],
      "env": { "AXOLOTL_URL": "https://your-axolotl.vercel.app", "TINYFISH_API_KEY": "your-key" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.axolotl]
command = "node"
args = ["/path/to/axolotl/mcp/server.mjs"]

[mcp_servers.axolotl.env]
AXOLOTL_URL = "https://your-axolotl.vercel.app"
TINYFISH_API_KEY = "your-key"
```

**Cursor** (`.cursor/mcp.json`), **Gemini CLI** (`~/.gemini/settings.json`) and **Windsurf** (`~/.codeium/windsurf/mcp_config.json`) use the same `mcpServers` JSON as above. **VS Code** (`.vscode/mcp.json`) uses `"servers"` with `"type": "stdio"` added to the server entry.

## Teach the model when to use it

Claude: copy `skill/SKILL.md` to `~/.claude/skills/axolotl/SKILL.md`. Other tools: paste the instructions from `skill/SKILL.md` into `AGENTS.md`, `GEMINI.md` or your rules file.

## Notes

- `axolotl_scan` runs on the caller's TinyFish account, so it skips the website's scan limits and isn't cached for other visitors. Agents should run `axolotl_check` first.
- `axolotl_check` has its own limit (`CHECK_LIMIT_PER_HOUR`, default 30 per address).
- `skill/SKILL.md` is a Claude skill that tells an agent when to use these tools and how to read the results.
