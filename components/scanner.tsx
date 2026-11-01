"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import TinyfishLogo from "@/components/tinyfish-logo";
import AxolotlMark from "@/components/axolotl-mark";
import TypeArt from "@/components/type-art";
import Report from "@/components/report";
import { PRESETS, SITES, detect, verdictOf } from "@/lib/sites";
import { tasksFor, type ScanResult } from "@/lib/scan";
import type { ScanEvent } from "@/app/api/scan/route";

type Phase = "pick" | "address" | "loading" | "results";
type TaskState = "queued" | "run" | "pass" | "fail";

function hostOf(u: string) {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : "https://" + u).hostname;
  } catch {
    return null;
  }
}

export default function Scanner() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [sel, setSel] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  // /?url=example.com prefills the address step.
  const params = useSearchParams();
  const [url, setUrl] = useState(() => params.get("url") ?? "");
  const [err, setErr] = useState("");
  const [host, setHost] = useState("");
  const [status, setStatus] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [states, setStates] = useState<TaskState[]>([]);
  // Latest thing each agent reported doing, shown under its task while it runs.
  const [steps, setSteps] = useState<string[]>([]);
  // Verified site checks; null while they are still running.
  const [checks, setChecks] = useState<{ label: string; ok: boolean; detail: string }[] | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  // The server replayed a recent scan of this site instead of running agents again.
  const [fromCache, setFromCache] = useState(false);
  const running = useRef(false);

  const detected = sel === "own" && desc.trim().length >= 10 ? detect(desc) : null;
  const key = sel === "own" ? detected || "custom" : sel || "custom";
  const site = SITES[key];
  const canContinue = sel !== null && (sel !== "own" || desc.trim().length >= 10);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  // Runs the TinyFish agents and site checks through /api/scan and follows their progress live.
  async function scan(h: string) {
    if (running.current) return;
    running.current = true;
    setHost(h);
    setPhase("loading");
    const tasks = tasksFor(key);
    setFromCache(false);
    setTitles(tasks.map((t) => t.title));
    setStates(tasks.map(() => "queued"));
    setSteps(tasks.map(() => ""));
    setChecks(null);
    setStatus(`Sending 6 agents to ${h}…`);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), type: key, description: sel === "own" ? desc : undefined }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "The scan could not start.");
      }
      // One JSON event per line; a chunk can end mid-line, so keep the remainder.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: ScanResult | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as ScanEvent;
          if (e.type === "progress") {
            setSteps((s) => s.map((v, j) => (j === e.task ? e.text : v)));
            setStatus(e.text);
          } else if (e.type === "checks") {
            setChecks(e.checks);
          } else if (e.type === "started") {
            setStates((s) => s.map((v, j) => (j === e.task && v === "queued" ? "run" : v)));
          } else if (e.type === "task") {
            setStates((s) => s.map((v, j) => (j === e.task ? (e.ok ? "pass" : "fail") : v)));
          } else if (e.type === "result") {
            final = e.result;
            setFromCache(!!e.cached);
          } else if (e.type === "error") {
            throw new Error(e.message);
          }
        }
      }
      if (!final) throw new Error("The scan ended without a result.");
      setResult(final);
      setPhase("results");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The scan failed.");
      setPhase("address");
    } finally {
      running.current = false;
    }
  }

  function submit() {
    const h = hostOf(url.trim());
    if (!h || !h.includes(".")) {
      setErr("Enter a valid address, like yoursite.com");
      return;
    }
    setErr("");
    scan(h);
  }

  function reset() {
    setSel(null);
    setDesc("");
    setUrl("");
    setErr("");
    setPhase("pick");
  }

  const score = result?.score ?? 0;
  const shownSite = SITES[result?.type ?? key] ?? site;

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <span className="brand">
            <AxolotlMark size={26} />
            <span>axolotl</span>
            <span className="x">×</span>
            <TinyfishLogo size={24} />
            <span>tinyfish</span>
          </span>
        </div>
      </header>

      <main className="stage">
        {phase === "pick" && (
          <div>
            <h1>
              What kind of site should agents <span>try to use?</span>
            </h1>
            <p className="lede">Choose the closest match so we test the tasks that matter for your site.</p>
            <div className="types">
              {[...PRESETS, "own"].map((k) => {
                const on = sel === k;
                return (
                  <button key={k} className="type" onClick={() => setSel(on ? null : k)} aria-pressed={on} data-own={k === "own"}>
                    <span className="type-art">
                      <TypeArt kind={k} />
                    </span>
                    <b>{k === "own" ? "Describe it yourself" : SITES[k].name}</b>
                    <small>{k === "own" ? "Something else? Tell us." : SITES[k].sub}</small>
                  </button>
                );
              })}
            </div>
            {sel === "own" && (
              <div>
                <textarea
                  className="field"
                  autoFocus
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  aria-label="Describe your website"
                  placeholder="e.g. A marketplace where people book dog walkers, pay deposits and message the walker..."
                />
                <p className="hint" aria-live="polite">
                  {desc.trim().length < 10
                    ? ""
                    : detected
                      ? `Looks like a ${SITES[detected].name} site, so we will test those tasks.`
                      : "No clear match, so we will use a general set of tasks."}
                </p>
              </div>
            )}
            <div className="actions">
              <button className="btn" disabled={!canContinue} onClick={() => setPhase("address")}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {phase === "address" && (
          <div className="address">
            <h1>Where does it live?</h1>
            <p className="lede">
              {sel === "own"
                ? `Scanning as ${detected ? "a " + site.name.toLowerCase() + " site" : "a custom project"}: “${desc.trim().slice(0, 90)}”`
                : `Scanning as a ${site.name.toLowerCase()} site.`}
            </p>
            <input
              className="field"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              aria-label="Site address"
              aria-invalid={!!err}
              aria-describedby="address-err"
              placeholder="https://yoursite.com"
            />
            <p className="err" id="address-err" role="alert">
              {err}
            </p>
            <div className="actions">
              <button className="btn-quiet" onClick={() => setPhase("pick")}>
                ← Back
              </button>
              <button className="btn" onClick={submit}>
                Run scan
              </button>
            </div>
            <p className="fineprint">
              Six TinyFish agents will each try a real task on this site, and 26 checks will read its files. A scan takes about three to five minutes. The agents never submit, pay, book or sign up.
            </p>
          </div>
        )}

        {phase === "loading" && (
          <div>
            <h2>Sending agents to your site</h2>
            <p className="status" aria-live="polite">
              {status}
            </p>
            <div className="checks">
              {titles.map((title, i) => {
                const st = states[i] ?? "run";
                return (
                  <div key={title} className="check" data-state={st}>
                    <span className="dot" data-dot={st}>
                      {st === "pass" ? "✓" : st === "fail" ? "✕" : ""}
                    </span>
                    <span className="check-text">
                      {title}
                      {st === "queued" && <small>Waiting for its turn</small>}
                      {st === "run" && steps[i] && <small>{steps[i]}</small>}
                    </span>
                  </div>
                );
              })}
              <div className="check" data-state={checks ? "done" : "run"}>
                <span className="dot" data-dot={checks ? "pass" : "run"}>
                  {checks ? "✓" : ""}
                </span>
                <span className="check-text">
                  Site checks
                  <small>
                    {checks ? `${checks.filter((c) => c.ok).length} of ${checks.length} passed` : "26 checks: robots.txt, structured data, forms, links, content without JavaScript"}
                  </small>
                </span>
              </div>
            </div>
          </div>
        )}

        {phase === "results" && result && (
          <div>
            <div className="result-head">
              <div className="ring">
                <svg viewBox="0 0 220 220" width="220" height="220">
                  <circle className="track" cx="110" cy="110" r="90" fill="none" strokeWidth="14" />
                  <circle
                    className="fill"
                    cx="110"
                    cy="110"
                    r="90"
                    fill="none"
                    strokeWidth="14"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 90}
                    strokeDashoffset={2 * Math.PI * 90 * (1 - score / 100)}
                  />
                </svg>
                <div className="ring-num">{score}</div>
              </div>
              <div className="verdict-wrap">
                <div className="verdict">{verdictOf(score)[0]}</div>
                <div className="verdict-sub">{verdictOf(score)[1]}</div>
              </div>
              <span className="tag">
                {host} · {shownSite.name}
              </span>
            </div>

            <Report result={result} host={host} fromCache={fromCache} onReset={reset} />
          </div>
        )}
      </main>
    </>
  );
}
