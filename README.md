# Axolotl

An agent experience scanner: SEO for AI agents. Axolotl sends three real [TinyFish](https://tinyfish.ai) web agents to a website, has them attempt the tasks that matter for that kind of site (booking, e-commerce, SaaS, docs or lead-gen forms), runs nine free checks on the site's files and HTML, and scores the result out of 100 with a ranked list of fixes.

Agents never submit, pay, book, sign up or type personal details on the sites they test.

## How the score works

- **Four dimensions**: Discoverability, Navigability, Actionability and Reliability. How much each counts depends on the site type (for a shop, Actionability carries 35%).
- **70% from the agents.** Each of the three tasks earns marks; the final goal (checkout, booking, submit) is worth the most (25% / 35% / 40%).
- **30% from nine verified checks** that need no browser and cost nothing: AI agents allowed in `robots.txt`, sitemap, `llms.txt`, structured data, title/description/language, content present without JavaScript, form labels, button names and image alt text.
- Every task and check shows its marks earned out of marks available, and they add up to the score.

## Run it

You need Node 18+ and a TinyFish API key from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).

```bash
git clone https://github.com/git-sd/axolotl.git
cd axolotl
npm install
cp .env.example .env.local   # then put your key in .env.local
npm run dev
```

Open http://localhost:3000. You can prefill the address step with `/?url=example.com`.

A scan takes a minute or two and costs about 30 TinyFish agent steps (roughly $0.50).

## Configuration

Set these in `.env.local`, or in your host's environment variables (on Vercel: Project → Settings → Environment Variables).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TINYFISH_API_KEY` | none | Required. Server-only; never sent to the browser. |
| `SCAN_LIMIT_PER_HOUR` | `3` | Scans each visitor (by IP) can start per hour |
| `SCAN_DAILY_BUDGET` | `40` | Scans everyone together can start per day |
| `SCAN_MAX_CONCURRENT` | `3` | Scans running at the same time |
| `SCAN_CACHE_MINUTES` | `60` | Re-scanning the same site within this window reuses the result, free |

Setting any of the first three limits to `0` pauses scans.

The limits are kept in server memory. On hosts that run several instances (such as Vercel) each instance counts separately; for strict limits, move the counters to a shared store such as Redis.

## Where things are

- `components/scanner.tsx`: the four steps (pick a site type, enter an address, live progress, results)
- `app/api/scan/route.ts`: runs the three agents and the site checks, streams progress to the browser
- `lib/scan.ts`: the tasks per site type, the agents' safety rules, and the scoring
- `lib/checks.ts`: the nine verified site checks
- `lib/limits.ts`: rate limits, daily budget, result cache and same-origin check
- `lib/sites.ts`: site types and how much each dimension counts for them
