import { TinyFish } from "@tiny-fish/sdk";
import { goalFor, parseReport, REPORT_SCHEMA, scoreOutcomes, tasksFor, type ScanResult, type TaskOutcome } from "@/lib/scan";
import { cached, clientIp, remember, reserve, sameOrigin } from "@/lib/limits";
import { runChecks, type Check } from "@/lib/checks";

// Hosts cap how long a request may run (Vercel's free plan: 300 seconds). The scan has to
// finish, and send its result, inside this, so the time budgets below are worked out from it.
export const maxDuration = 300;

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
// How many agents work at once. All six at once gives each the most time inside the host's
// limit; lower it if your TinyFish plan caps concurrent runs (excess tasks then wait their turn).
const CONCURRENCY = num(process.env.SCAN_AGENT_CONCURRENCY, 6);
// The longest any one agent may work before it is stopped. A stopped agent has no verdict, so
// its task is left out of the score rather than counted against the site.
const TASK_MS = num(process.env.SCAN_AGENT_SECONDS, 230) * 1000;
// The whole scan must be wrapped up by here, leaving room to score and send the result.
const BUDGET_MS = num(process.env.SCAN_TOTAL_SECONDS, 270) * 1000;
// An agent that would get less than this is not started: it could not do anything useful.
const MIN_TASK_MS = 25_000;

// Stream events, one JSON object per line:
//   { type: "started", task }               an agent began working (it may have been waiting)
//   { type: "progress", task, text }        an agent did something
//   { type: "task", task, ok }              an agent finished
//   { type: "checks", checks }              the verified site checks finished
//   { type: "result", result, cached? }     final ScanResult (cached: replayed from a recent scan)
//   { type: "error", message }
export type ScanEvent =
  | { type: "started"; task: number }
  | { type: "progress"; task: number; text: string }
  | { type: "task"; task: number; ok: boolean }
  | { type: "checks"; checks: { label: string; ok: boolean; detail: string }[] }
  | { type: "result"; result: ScanResult; cached?: boolean }
  | { type: "error"; message: string };

const STREAM_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };

function normaliseUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    // Public sites only: no localhost, bare hostnames or IP addresses.
    if (!u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname) || u.hostname.endsWith(".local")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// The SDK cannot cancel a run, so stop it through the API. Without this an agent we gave up
// on would carry on working (and billing) in the background.
async function cancelRun(runId: string) {
  try {
    await fetch(`https://agent.tinyfish.ai/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "X-API-Key": process.env.TINYFISH_API_KEY ?? "", "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Best effort: the run also ends by itself once its own limits are reached.
  }
}

// Runs fn over items with at most `limit` in flight, keeping results in order.
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export async function POST(req: Request) {
  if (!process.env.TINYFISH_API_KEY) {
    return Response.json({ error: "No TinyFish API key is set. Add TINYFISH_API_KEY and restart." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { url?: unknown; type?: unknown; description?: unknown };
  const url = normaliseUrl(body.url);
  if (!url) return Response.json({ error: "Enter a valid public address, like yoursite.com" }, { status: 400 });
  const type = typeof body.type === "string" ? body.type : "custom";
  const description = type === "custom" && typeof body.description === "string" ? body.description.trim() : undefined;

  if (!sameOrigin(req)) return Response.json({ error: "Scans can only be started from Axolotl itself." }, { status: 403 });

  const tasks = tasksFor(type);
  const encoder = new TextEncoder();
  const line = (e: ScanEvent) => encoder.encode(JSON.stringify(e) + "\n");

  // Same site scanned recently: replay that result instead of paying for a new scan.
  const hit = cached(url, type, description);
  if (hit) {
    const replay = new ReadableStream({
      start(controller) {
        hit.tasks.forEach((t, i) => controller.enqueue(line({ type: "task", task: i, ok: t[2] === 1 })));
        if (hit.checks) controller.enqueue(line({ type: "checks", checks: hit.checks }));
        controller.enqueue(line({ type: "result", result: hit, cached: true }));
        controller.close();
      },
    });
    return new Response(replay, { headers: STREAM_HEADERS });
  }

  const slot = reserve(clientIp(req));
  if (!slot.ok) return Response.json({ error: slot.message }, { status: 429 });

  const client = new TinyFish();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ScanEvent) => controller.enqueue(line(e));

      const runTask = async (task: (typeof tasks)[number], i: number): Promise<TaskOutcome> => {
        const outcome: TaskOutcome = { title: task.title, detail: task.detail, weight: task.weight, status: "FAILED", report: null, steps: 0, log: [] };

        // How long this agent may work: its own cap, or whatever is left of the whole scan.
        const left = BUDGET_MS - (Date.now() - startedAt);
        const allowed = Math.min(TASK_MS, left);
        if (allowed < MIN_TASK_MS) {
          outcome.timedOut = true;
          outcome.inconclusive = true;
          outcome.error = "The scan ran out of time before this task could start.";
          send({ type: "task", task: i, ok: false });
          return outcome;
        }

        const controller2 = new AbortController();
        const onClientGone = () => controller2.abort();
        req.signal.addEventListener("abort", onClientGone);
        let runId = "";
        const timer = setTimeout(() => {
          outcome.timedOut = true;
          controller2.abort();
        }, allowed);

        try {
          const events = await client.agent.stream(
            {
              url,
              goal: goalFor(task, description),
              output_schema: REPORT_SCHEMA,
              // agent_config.max_steps would hard-cap cost, but it is a beta feature this
              // account lacks; the step budget is in the goal text (see RULES) and the time
              // cap above stops an agent that overruns it.
            },
            { signal: controller2.signal },
          );
          for await (const event of events) {
            if (event.type === "STARTED") {
              runId = event.run_id;
              // TinyFish may hold a run in its own queue, so announce it only when it truly begins.
              send({ type: "started", task: i });
            }
            if (event.type === "PROGRESS") {
              outcome.steps++;
              if (outcome.log.length < 40) outcome.log.push(event.purpose.slice(0, 160));
              send({ type: "progress", task: i, text: event.purpose });
            }
            if (event.type === "COMPLETE") {
              outcome.status = event.status;
              outcome.report = parseReport(event.result);
              if (event.error) {
                outcome.error = event.error.message;
                // A failure of TinyFish itself, or of billing, says nothing about the site.
                if (event.error.category !== "AGENT_FAILURE") outcome.inconclusive = true;
              }
            }
          }
        } catch (err) {
          // The run never gave a verdict. If we stopped it, or TinyFish could not start it
          // (rate limit, outage), that is not the site's doing.
          outcome.inconclusive = true;
          outcome.error = outcome.timedOut
            ? `Stopped after ${Math.round(allowed / 1000)} seconds without finishing.`
            : err instanceof Error
              ? err.message
              : "The agent run failed.";
        } finally {
          clearTimeout(timer);
          req.signal.removeEventListener("abort", onClientGone);
        }
        if (outcome.timedOut && runId) await cancelRun(runId);
        // A run that finished with a report before the timer fired has a verdict after all.
        if (outcome.report) {
          outcome.timedOut = false;
          outcome.inconclusive = false;
        }
        send({ type: "task", task: i, ok: !!outcome.report?.task_achievable });
        return outcome;
      };

      try {
        // Free, fast checks run alongside the agents; a failure there never sinks the scan.
        const checksDone = runChecks(url, type)
          .catch((): Check[] => [])
          .then((checks) => {
            send({ type: "checks", checks: checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail })) });
            return checks;
          });
        // Start the tasks that matter most first. If TinyFish queues some runs, or time runs out,
        // it is the lighter tasks at the back that go unscored, not the final goal.
        const order = tasks.map((_, i) => i).sort((a, b) => tasks[b].weight - tasks[a].weight);
        const [ranOrder, checks] = await Promise.all([pool(order, CONCURRENCY, (i) => runTask(tasks[i], i)), checksDone]);
        const outcomes: TaskOutcome[] = new Array(tasks.length);
        order.forEach((taskIndex, k) => (outcomes[taskIndex] = ranOrder[k]));
        if (outcomes.every((o) => !o.report && o.error)) {
          send({ type: "error", message: outcomes[0].error ?? "Every agent run failed." });
        } else {
          const result = scoreOutcomes(type, outcomes, checks);
          result.stats = { ...(result.stats ?? { agents: outcomes.length, steps: 0 }), seconds: Math.round((Date.now() - startedAt) / 1000) };
          remember(url, type, description, result);
          send({ type: "result", result });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Scan failed." });
      } finally {
        slot.release();
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
