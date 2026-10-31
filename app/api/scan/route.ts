import { TinyFish } from "@tiny-fish/sdk";
import { goalFor, parseReport, REPORT_SCHEMA, scoreOutcomes, tasksFor, type TaskOutcome } from "@/lib/scan";
import { cached, clientIp, remember, reserve, sameOrigin } from "@/lib/limits";
import { runChecks, type Check } from "@/lib/checks";

// Agent runs take a minute or more; the response streams progress the whole time.
export const maxDuration = 300;

// Stream events, one JSON object per line:
//   { type: "progress", task, text }        an agent did something
//   { type: "task", task, ok }              an agent finished
//   { type: "checks", checks }              the verified site checks finished
//   { type: "result", result, cached? }     final ScanResult (cached: replayed from a recent scan)
//   { type: "error", message }
export type ScanEvent =
  | { type: "progress"; task: number; text: string }
  | { type: "task"; task: number; ok: boolean }
  | { type: "checks"; checks: { label: string; ok: boolean; detail: string }[] }
  | { type: "result"; result: ReturnType<typeof scoreOutcomes>; cached?: boolean }
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

export async function POST(req: Request) {
  if (!process.env.TINYFISH_API_KEY) {
    return Response.json({ error: "No TinyFish API key is set. Add TINYFISH_API_KEY to .env.local and restart." }, { status: 503 });
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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ScanEvent) => controller.enqueue(line(e));

      const runTask = async (i: number): Promise<TaskOutcome> => {
        const task = tasks[i];
        const outcome: TaskOutcome = { title: task.title, detail: task.detail, status: "FAILED", report: null, steps: 0 };
        try {
          const events = await client.agent.stream(
            {
              url,
              goal: goalFor(task, description),
              output_schema: REPORT_SCHEMA,
              // agent_config.max_steps would hard-cap cost, but it is a beta feature this
              // account lacks; the step budget is in the goal text (see RULES) instead.
            },
            { signal: req.signal },
          );
          for await (const event of events) {
            if (event.type === "PROGRESS") {
              outcome.steps++;
              send({ type: "progress", task: i, text: event.purpose });
            }
            if (event.type === "COMPLETE") {
              outcome.status = event.status;
              outcome.report = parseReport(event.result);
              if (event.error) outcome.error = event.error.message;
            }
          }
        } catch (err) {
          outcome.error = err instanceof Error ? err.message : "The agent run failed.";
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
        const [outcomes, checks] = await Promise.all([Promise.all(tasks.map((_, i) => runTask(i))), checksDone]);
        if (outcomes.every((o) => !o.report && o.error)) {
          send({ type: "error", message: outcomes[0].error ?? "Every agent run failed." });
        } else {
          const result = scoreOutcomes(type, outcomes, checks);
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
