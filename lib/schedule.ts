// How much agent work fits in one scan. TinyFish runs only a few agents at once (2 on the
// standard plan), and a host caps how long a request may last, so the number of agent-seconds
// per scan is fixed: concurrency x time budget. These functions turn that into a plan.
// Pure, so they can be tested without a network.

// Time kept back at the end of a scan for the site checks to land and the result to be
// scored and sent.
export const OVERHEAD_MS = 15_000;

// How many tasks can run in one scan while still giving each at least `minTaskMs`. With 2
// agents, a 270s budget and 110s minimum that is 4 of the 6 tasks.
export function tasksThatFit(total: number, concurrency: number, budgetMs: number, minTaskMs: number): number {
  const agentMs = Math.max(0, budgetMs - OVERHEAD_MS) * Math.max(1, concurrency);
  return Math.max(1, Math.min(total, Math.floor(agentMs / Math.max(1, minTaskMs))));
}

// How long the next agent may work. Tasks still to start (including this one) run in waves of
// `concurrency`, so each gets an equal share of the time left, up to its own cap. When early
// agents finish quickly, later ones inherit the spare time automatically.
export function timeAllowed(opts: {
  remainingIncludingThis: number;
  concurrency: number;
  budgetMs: number;
  elapsedMs: number;
  capMs: number;
}): number {
  const wavesLeft = Math.max(1, Math.ceil(opts.remainingIncludingThis / Math.max(1, opts.concurrency)));
  const left = opts.budgetMs - OVERHEAD_MS - opts.elapsedMs;
  return Math.max(0, Math.min(opts.capMs, Math.floor(left / wavesLeft)));
}

// Task indexes to run, most important first, and those left out. `weights` are per task in
// display order; ties keep display order.
export function chooseTasks(weights: number[], fit: number): { run: number[]; skipped: number[] } {
  const order = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a] || a - b);
  return { run: order.slice(0, fit), skipped: order.slice(fit).sort((a, b) => a - b) };
}
