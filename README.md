# Axolotl

An agent experience scanner: SEO for AI agents. Axolotl sends real [TinyFish](https://tinyfish.ai) web agents to a website (two at a time), has them attempt up to six tasks that matter for that kind of site (booking, e-commerce, SaaS, docs or lead-gen forms), runs 26 free checks on the site's files and HTML, and scores the result out of 100. The report shows exactly what each agent saw and did, why each check matters, and up to 12 ranked fixes.

Agents never submit, pay, book, sign up or type personal details on the sites they test.

## How the score works

- **Four dimensions**: Discoverability, Navigability, Actionability and Reliability. How much each counts depends on the site type (for a shop, Actionability carries 35%).
- **70% from up to six agent tasks.** Each task is weighted; the final goal (checkout, booking, submit) is worth the most, for example 35 to 40 of the 100 marks. TinyFish allows 2 agents at a time per run, so a scan only has so much agent time: on the default 270-second budget it runs the 4 most important tasks, and the rest are marked "not run".
- **30% from 26 verified checks** that need no browser and cost nothing: AI agents allowed in `robots.txt`, sitemap, `llms.txt`, structured data (and that it parses), title and description, language, Open Graph, canonical link, noindex, a single main heading, heading order, page landmarks, navigation links, link text, image alt text, contact details, form labels, autocomplete hints, button names, CAPTCHA, content without JavaScript, mobile viewport, page size, HTTPS and response time.
- Every task and check shows its marks earned out of marks available, and they add up to the score.
- **A task with no verdict is not scored.** If a task is not run for lack of time, an agent runs out of time, or TinyFish can't run it, that task is left out and flagged, and the other marks still add up to 100. It is never counted against the site.
- **The report** opens each task to show what the agent saw, the pages it visited, the problems it found (with where and how to fix) and a step-by-step log; lists every check with why it matters; and can be downloaded as Markdown.

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

A scan takes about three to four minutes and uses roughly 40 to 80 TinyFish agent steps (about $0.70 to $1.30). Two agents run at a time; the most important tasks start first, and each agent gets a fair share of the time left, so early finishers pass spare time to the later ones.

## Configuration

Set these in `.env.local`, or in your host's environment variables (on Vercel: Project → Settings → Environment Variables).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TINYFISH_API_KEY` | none | Required. Server-only; never sent to the browser. |
| `SCAN_LIMIT_PER_HOUR` | `3` | Scans each visitor (by IP) can start per hour |
| `SCAN_DAILY_BUDGET` | `20` | Scans everyone together can start per day |
| `SCAN_MAX_CONCURRENT` | `3` | Scans running at the same time |
| `SCAN_CACHE_MINUTES` | `60` | Re-scanning the same site within this window reuses the result, free |
| `SCAN_AGENT_CONCURRENCY` | `2` | Agents running at once within one scan (TinyFish allows 2 per run on the standard plan) |
| `SCAN_AGENT_SECONDS` | `230` | The longest one agent may work before it is stopped |
| `SCAN_TOTAL_SECONDS` | `270` | Time budget for the whole scan |
| `SCAN_MIN_AGENT_SECONDS` | `110` | The least time worth giving an agent; decides how many tasks fit (concurrency x budget / this) |

Setting any of the first three limits to `0` pauses scans.

**Time limits.** The defaults fit inside Vercel's free-plan cap of 300 seconds per request (`maxDuration` in `app/api/scan/route.ts`). If you host somewhere with no such cap, or on a plan that allows longer (raise `maxDuration` too), increase `SCAN_AGENT_SECONDS` and `SCAN_TOTAL_SECONDS`: slower agents can then finish, and all six tasks run (for example, a 600-second budget fits all six at 2 agents at a time).

The limits are kept in server memory. On hosts that run several instances (such as Vercel) each instance counts separately; for strict limits, move the counters to a shared store such as Redis.

## Where things are

- `components/scanner.tsx`: the four steps (pick a site type, enter an address, live progress, results)
- `components/report.tsx`: the full report, with expandable tasks and checks and a Markdown download
- `app/api/scan/route.ts`: runs the six agents and the 26 site checks, streams progress to the browser
- `lib/scan.ts`: the tasks per site type, the agents' safety rules, and the scoring
- `lib/checks.ts`: the 26 verified site checks
- `lib/limits.ts`: rate limits, daily budget, result cache and same-origin check
- `lib/schedule.ts`: how many tasks fit the time, and how long each agent gets
- `lib/sites.ts`: site types and how much each dimension counts for them
