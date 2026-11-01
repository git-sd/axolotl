// The full scan report, laid out like an audit: a summary with headline figures, a scorecard per
// dimension, the agent tasks and site checks as labelled tables, and the fixes ranked by priority
// and impact. Every status is a word as well as a colour. No motion; expandable rows are native
// <details>.

import { DIMS, SITES, verdictOf } from "@/lib/sites";
import { gradeOf, impactOf, PRIORITY_LABEL } from "@/lib/grade";
import type { ScanResult } from "@/lib/scan";

const round = (n: number) => Math.round(n * 10) / 10;

const BLOCKED_LABEL: Record<string, string> = {
  none: "Nothing blocked it",
  captcha_or_bot_check: "A CAPTCHA or bot check",
  login_required: "A login wall",
  element_not_usable: "A control it could not use",
  content_not_found: "The content it needed was not there",
  page_error: "A page error",
  timed_out: "It ran out of time",
  other: "Something else",
};

const PRIORITY_TONE: Record<"high" | "med" | "low", string> = { high: "bad", med: "warn", low: "info" };

// A status word in a coloured chip. The word carries the meaning; colour only reinforces it.
function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="rp-badge" data-tone={tone}>
      {children}
    </span>
  );
}

function Marks({ earned, max }: { earned?: number; max?: number }) {
  if (earned === undefined || !max) return <span className="rp-marks rp-none">–</span>;
  return (
    <span className="rp-marks" title="Marks earned out of marks available, from a total of 100">
      <b>{earned}</b>
      <span> / {max}</span>
    </span>
  );
}

// A card heading with an optional summary figure on the right.
function Head({ title, note }: { title: string; note?: string }) {
  return (
    <header className="rp-head">
      <h2>{title}</h2>
      {note && <span>{note}</span>}
    </header>
  );
}

function taskStatus(t: ScanResult["tasks"][number], unscored?: boolean, notRun?: boolean): { tone: string; label: string } {
  if (unscored) return { tone: "muted", label: notRun ? "Not run" : "Not scored" };
  return t[2] ? { tone: "good", label: "Passed" } : { tone: "bad", label: "Failed" };
}

// Two or three plain sentences: how it went overall, where it was strong and weak, and where to
// start. Built only from the numbers in the result.
export function summarise(result: ScanResult, host: string): string {
  const score = result.score;
  const g = gradeOf(score);
  const [verdict] = verdictOf(score);
  const order = result.dims.map((v, i) => [DIMS[i], v] as const).sort((a, b) => b[1] - a[1]);
  const done = result.tasks.filter((t) => t[2]).length;
  const unscored = result.stats?.unscored ?? 0;
  const notRun = result.stats?.notRun ?? 0;
  const outOfTime = unscored - notRun;
  const counted = result.tasks.length - unscored;
  const left = [notRun ? `${notRun} not run for lack of time` : "", outOfTime ? `${outOfTime} did not finish in time` : ""].filter(Boolean).join(" and ");
  const parts = [
    `${host} scored ${score} out of 100, grade ${g.letter} (${verdict.toLowerCase()}). The agents completed ${done} of ${counted} scored tasks${unscored ? `; ${left}, so ${unscored === 1 ? "it was" : "they were"} left out of the score. Run the scan again, or on a host with longer time limits, to include ${unscored === 1 ? "it" : "them"}` : ""}.`,
    `It is strongest on ${order[0][0]} (${order[0][1]}) and weakest on ${order[3][0]} (${order[3][1]}).`,
  ];
  const top = result.fixes[0];
  if (top) parts.push(`Start with the highest-priority finding: ${top[1].replace(/\.$/, "").slice(0, 140)}${top[1].length > 140 ? "…" : ""}.`);
  return parts.join(" ");
}

export function buildMarkdown(result: ScanResult, host: string, siteName: string): string {
  const g = gradeOf(result.score);
  const L: string[] = [];
  L.push(`# Agent experience report: ${host}`, "", `**Grade ${g.letter} · ${result.score} / 100** (${verdictOf(result.score)[0]}) · Site type: ${siteName}`, "", summarise(result, host), "");
  if (result.stats) {
    L.push(`Scan: ${result.stats.agents} agents, ${result.stats.steps} actions${result.stats.seconds ? `, ${result.stats.seconds}s` : ""}${result.checks ? `, ${result.checks.length} site checks` : ""}.`, "");
  }
  L.push("## Scorecard", "", "| Dimension | Grade | Score | Weight |", "| --- | --- | --- | --- |");
  DIMS.forEach((d, i) => {
    const dg = gradeOf(result.dims[i]);
    L.push(`| ${d} | ${dg.letter} | ${result.dims[i]} | ${result.weights ? `${Math.round(result.weights[i] * 100)}%` : "–"} |`);
  });
  L.push("");
  DIMS.forEach((d, i) => result.dimNotes?.[i] && L.push(`- **${d}:** ${result.dimNotes[i]}`));
  L.push("", "## Agent tasks", "");
  result.tasks.forEach((t, i) => {
    const d = result.taskDetails?.[i];
    const st = taskStatus(t, d?.unscored, d?.notRun);
    L.push(`### ${t[0]} — ${st.label}${t[3] !== undefined && t[4] ? ` (${t[3]} / ${t[4]} marks)` : ""}`, "", t[1], "");
    if (d?.evidence) L.push(`**What the agent saw:** ${d.evidence}`, "");
    if (d?.pages.length) L.push(`**Pages visited:** ${d.pages.join(" → ")}`, "");
    if (d && !t[2] && !d.unscored) L.push(`**What stopped it:** ${BLOCKED_LABEL[d.blockedBy] ?? d.blockedBy}`, "");
    if (d?.problems.length) {
      L.push("**Problems it found:**", "");
      d.problems.forEach((p) => L.push(`- **${p.severity[0].toUpperCase()}${p.severity.slice(1)}:** ${p.problem}${p.where ? ` _(${p.where})_` : ""}. Fix: ${p.fix}`));
      L.push("");
    }
  });
  if (result.checks?.length) {
    L.push("## Site checks", "");
    DIMS.forEach((d) => {
      const mine = result.checks!.filter((c) => c.dim === d);
      if (!mine.length) return;
      L.push(`### ${d}`, "", "| Check | Result | Detail |", "| --- | --- | --- |");
      mine.forEach((c) => L.push(`| ${c.label} | ${!c.max ? "N/A" : c.ok ? "Pass" : "Fail"} | ${c.detail.replace(/\|/g, "/")} |`));
      L.push("");
      mine.filter((c) => c.max && !c.ok && c.fix).forEach((c) => L.push(`- **${c.label}:** ${c.fix}`));
      L.push("");
    });
  }
  L.push("## Ranked fixes", "", "| # | Priority | Impact | Finding | Fix |", "| --- | --- | --- | --- | --- |");
  result.fixes.forEach((f, i) => {
    const clean = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
    L.push(`| ${i + 1} | ${PRIORITY_LABEL[f[0]]} | ${impactOf(f[3]).label} | ${clean(f[1])}${f[4] ? " (verified)" : ""} | ${clean(f[2])} |`);
  });
  L.push("", "_Generated by Axolotl with TinyFish web agents. Impact levels are estimates._", "");
  return L.join("\n");
}

export default function Report({
  result,
  host,
  fromCache,
  onReset,
}: {
  result: ScanResult;
  host: string;
  fromCache: boolean;
  onReset: () => void;
}) {
  const siteName = (SITES[result.type] ?? SITES.custom).name;
  const overall = gradeOf(result.score);
  const taskMarks = result.tasks.some((t) => t[4] !== undefined);
  const high = result.fixes.filter((f) => f[0] === "high").length;
  const med = result.fixes.filter((f) => f[0] === "med").length;
  const low = result.fixes.filter((f) => f[0] === "low").length;
  const scored = result.tasks.filter((_, i) => !result.taskDetails?.[i]?.unscored);
  const passed = scored.filter((t) => t[2]).length;
  const checksScored = result.checks?.filter((c) => c.max) ?? [];
  const checksPassed = checksScored.filter((c) => c.ok).length;
  const seconds = result.stats?.seconds;
  const time = seconds ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : null;

  function download() {
    const blob = new Blob([buildMarkdown(result, host, siteName)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `axolotl-report-${host.replace(/[^a-z0-9.-]/gi, "")}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="report">
      {/* ---- Summary: the headline figures first, then the reading of them ---- */}
      <section className="rp-card">
        <Head title="Summary" />
        <dl className="rp-figures">
          <div data-tone={overall.tone}>
            <dt>Overall grade</dt>
            <dd>
              <b className="rp-letter">{overall.letter}</b>
              <span>{result.score} / 100</span>
            </dd>
          </div>
          <div>
            <dt>Agent tasks passed</dt>
            <dd>
              <b>
                {passed}
                <small> of {scored.length}</small>
              </b>
              {scored.length < result.tasks.length && <span>{result.tasks.length - scored.length} left out</span>}
            </dd>
          </div>
          {result.checks && (
            <div>
              <dt>Site checks passed</dt>
              <dd>
                <b>
                  {checksPassed}
                  <small> of {checksScored.length}</small>
                </b>
                <span>{result.checks.length - checksScored.length} not applicable</span>
              </dd>
            </div>
          )}
          {result.stats && (
            <div>
              <dt>Scan</dt>
              <dd>
                <b>{time ?? `${result.stats.agents} agents`}</b>
                <span>
                  {result.stats.agents} agents · {result.stats.steps} actions
                </span>
              </dd>
            </div>
          )}
        </dl>
        <p className="rp-lede">{summarise(result, host)}</p>
      </section>

      {/* ---- Scorecard: one tile per dimension ---- */}
      <section className="rp-card">
        <Head title="Scorecard" note="Grade, score and share of the total" />
        <div className="rp-scores">
          {DIMS.map((d, i) => {
            const g = gradeOf(result.dims[i]);
            return (
              <div key={d} className="rp-score" data-tone={g.tone}>
                <div className="rp-score-top">
                  <h3>{d}</h3>
                  <b className="rp-letter">{g.letter}</b>
                </div>
                <div className="rp-score-num">
                  {result.dims[i]}
                  <small> / 100</small>
                  {result.weights && <span>{Math.round(result.weights[i] * 100)}% of the total</span>}
                </div>
                <div className="rp-meter" role="img" aria-label={`${d}: ${result.dims[i]} out of 100`}>
                  <i style={{ width: `${result.dims[i]}%` }} />
                </div>
                {result.dimNotes?.[i] && <p>{result.dimNotes[i]}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Agent tasks ---- */}
      <section className="rp-card">
        <Head
          title="Agent tasks"
          note={taskMarks ? `${round(result.tasks.reduce((a, t) => a + (t[3] ?? 0), 0))} of ${round(result.tasks.reduce((a, t) => a + (t[4] ?? 0), 0))} marks` : undefined}
        />
        <div className="rp-cols" aria-hidden="true">
          <span>Result</span>
          <span>Task</span>
          <span>Marks</span>
        </div>
        {result.tasks.map((t, i) => {
          const d = result.taskDetails?.[i];
          const st = taskStatus(t, d?.unscored, d?.notRun);
          return (
            <details key={t[0]} className="rp-row" open={!t[2] && !!d && !d.unscored}>
              <summary>
                <Badge tone={st.tone}>{st.label}</Badge>
                <span className="rp-main">
                  <b>{t[0]}</b>
                  <span>{t[1]}</span>
                </span>
                <Marks earned={t[3]} max={t[4]} />
              </summary>
              {d && (
                <div className="rp-body">
                  {d.evidence && (
                    <div className="rp-field">
                      <h4>What the agent saw</h4>
                      <p>{d.evidence}</p>
                    </div>
                  )}
                  {!t[2] && !d.unscored && (
                    <div className="rp-field">
                      <h4>What stopped it</h4>
                      <p>{BLOCKED_LABEL[d.blockedBy] ?? d.blockedBy}</p>
                    </div>
                  )}
                  {d.pages.length > 0 && (
                    <div className="rp-field">
                      <h4>Pages visited</h4>
                      <ol>
                        {d.pages.map((p, k) => (
                          <li key={k}>{p}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {d.problems.length > 0 && (
                    <div className="rp-field">
                      <h4>Problems it found</h4>
                      {d.problems.map((p, k) => {
                        const pri = p.severity === "medium" ? "med" : (p.severity as "high" | "low");
                        return (
                          <div key={k} className="rp-problem">
                            <Badge tone={PRIORITY_TONE[pri]}>{PRIORITY_LABEL[pri]}</Badge>
                            <div>
                              <b>{p.problem}</b>
                              {p.where && <span className="rp-where">{p.where}</span>}
                              <span>Fix: {p.fix}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {d.log.length > 0 && (
                    <details className="rp-log">
                      <summary>
                        Step-by-step log ({d.steps} action{d.steps === 1 ? "" : "s"})
                      </summary>
                      <ol>
                        {d.log.map((l, k) => (
                          <li key={k}>{l}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              )}
            </details>
          );
        })}
      </section>

      {/* ---- Site checks, grouped by dimension ---- */}
      {!!result.checks?.length && (
        <section className="rp-card">
          <Head title="Site checks" note={`${checksPassed} of ${checksScored.length} passed`} />
          {DIMS.map((dim) => {
            const mine = result.checks!.filter((c) => c.dim === dim);
            if (!mine.length) return null;
            const applicable = mine.filter((c) => c.max);
            return (
              <div key={dim} className="rp-group">
                <h3>
                  {dim}
                  <span>
                    {applicable.filter((c) => c.ok).length} of {applicable.length} passed
                  </span>
                </h3>
                <div className="rp-cols" aria-hidden="true">
                  <span>Result</span>
                  <span>Check</span>
                  <span>Marks</span>
                </div>
                {mine.map((c) => (
                  <details key={c.label} className="rp-row">
                    <summary>
                      <Badge tone={!c.max ? "muted" : c.ok ? "good" : "bad"}>{!c.max ? "N/A" : c.ok ? "Pass" : "Fail"}</Badge>
                      <span className="rp-main">
                        <b>{c.label}</b>
                        <span>{c.detail}</span>
                      </span>
                      <Marks earned={c.marks} max={c.max} />
                    </summary>
                    <div className="rp-body">
                      {c.why && (
                        <div className="rp-field">
                          <h4>Why it matters</h4>
                          <p>{c.why}</p>
                        </div>
                      )}
                      {c.max && !c.ok && c.fix ? (
                        <div className="rp-field">
                          <h4>How to fix it</h4>
                          <p>{c.fix}</p>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            );
          })}
        </section>
      )}

      {/* ---- Ranked fixes ---- */}
      <section className="rp-card">
        <Head title="Ranked fixes" note={result.fixes.length ? `${result.fixes.length} findings · ${high} high · ${med} medium · ${low} low` : undefined} />
        {result.fixes.length === 0 ? (
          <p className="rp-empty">No problems found.</p>
        ) : (
          <>
            <div className="rp-cols rp-cols-fix" aria-hidden="true">
              <span>Priority</span>
              <span>Finding and fix</span>
              <span>Impact</span>
            </div>
            {result.fixes.map((f, i) => {
              const impact = impactOf(f[3]);
              return (
                <article key={f[1]} className="rp-fix">
                  <div className="rp-fix-pri">
                    <span className="rp-num">{i + 1}</span>
                    <Badge tone={PRIORITY_TONE[f[0]]}>{PRIORITY_LABEL[f[0]]}</Badge>
                  </div>
                  <div className="rp-fix-main">
                    <h3>
                      {f[1]}
                      {f[4] && <Badge tone="verified">Verified</Badge>}
                    </h3>
                    <p>{f[2]}</p>
                    {f[5] && <span className="rp-source">{f[5]}</span>}
                  </div>
                  <div className="rp-impact" aria-label={`Impact: ${impact.label}`}>
                    <span className="rp-bars" aria-hidden="true" data-level={impact.level}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{impact.label}</span>
                  </div>
                </article>
              );
            })}
          </>
        )}
      </section>

      <div className="result-foot">
        <div className="actions">
          <button className="btn" onClick={onReset}>
            Scan another site
          </button>
          <button className="btn btn-ghost" onClick={download}>
            Download report (.md)
          </button>
        </div>
        <p className="fineprint">
          {fromCache
            ? "This site was scanned in the last hour, so these are those results. Impact levels are estimates."
            : "Live results from TinyFish web agents and verified site checks. Impact levels are estimates."}
        </p>
      </div>
    </div>
  );
}
