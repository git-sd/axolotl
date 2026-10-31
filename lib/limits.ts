// Guards on /api/scan, which spends TinyFish credit on every scan it starts.
//
// State lives in this server process's memory: it resets on restart and isn't shared
// between instances. That's enough for one server; behind several (e.g. serverless),
// move these counters to a shared store such as Redis.

import type { ScanResult } from "@/lib/scan";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// All overridable from .env.local.
export const LIMITS = {
  perIpPerHour: num(process.env.SCAN_LIMIT_PER_HOUR, 3),
  dailyBudget: num(process.env.SCAN_DAILY_BUDGET, 40),
  maxConcurrent: num(process.env.SCAN_MAX_CONCURRENT, 3),
  cacheMinutes: num(process.env.SCAN_CACHE_MINUTES, 60),
};

const HOUR = 60 * 60 * 1000;

const byIp = new Map<string, number[]>(); // start times of each IP's scans in the last hour
const running = new Set<string>(); // IPs with a scan in progress
let day = "";
let today = 0; // scans started today, across everyone
const cache = new Map<string, { at: number; result: ScanResult }>();

export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}

// Browsers send Origin on cross-site requests; refuse ones from other websites so the API
// can't be embedded elsewhere. (Scripts can fake it, which is what the other limits are for.)
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

function minutes(ms: number) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m === 1 ? "a minute" : `${m} minutes`;
}

// Reserves a scan slot for this IP, or explains why not. Call release() when the scan ends.
export function reserve(ip: string): { ok: true; release: () => void } | { ok: false; message: string } {
  const now = Date.now();
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    today = 0;
  }

  if (LIMITS.perIpPerHour === 0 || LIMITS.dailyBudget === 0 || LIMITS.maxConcurrent === 0) {
    return { ok: false, message: "Live scans are paused right now. Try again later." };
  }
  if (running.has(ip)) return { ok: false, message: "You already have a scan running. Wait for it to finish." };
  if (running.size >= LIMITS.maxConcurrent) {
    return { ok: false, message: "Axolotl is busy with other scans right now. Try again in a minute." };
  }
  if (today >= LIMITS.dailyBudget) {
    return { ok: false, message: "Today's scan limit has been reached. Try again tomorrow." };
  }
  const recent = (byIp.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= LIMITS.perIpPerHour) {
    return {
      ok: false,
      message: `You've used your ${LIMITS.perIpPerHour} scans for this hour. Try again in ${minutes(HOUR - (now - recent[0]))}.`,
    };
  }

  recent.push(now);
  byIp.set(ip, recent);
  running.add(ip);
  today++;
  return { ok: true, release: () => running.delete(ip) };
}

// Recent results, so scanning the same site again soon is free.
const cacheKey = (url: string, type: string, description?: string) => `${type}|${new URL(url).host}${new URL(url).pathname}|${description ?? ""}`;

export function cached(url: string, type: string, description?: string): ScanResult | null {
  const hit = cache.get(cacheKey(url, type, description));
  if (!hit) return null;
  if (Date.now() - hit.at > LIMITS.cacheMinutes * 60000) {
    cache.delete(cacheKey(url, type, description));
    return null;
  }
  return hit.result;
}

export function remember(url: string, type: string, description: string | undefined, result: ScanResult) {
  if (LIMITS.cacheMinutes <= 0) return;
  cache.set(cacheKey(url, type, description), { at: Date.now(), result });
  // Keep memory bounded.
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
}
