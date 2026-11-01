// How the report names things: a letter grade for a score, and a plain impact level for a fix.
// Pure, so it is tested without a browser.

export type Tone = "good" | "ok" | "warn" | "bad";

// The usual school scale. 80 and 60 line up with the "Agent-ready" and "Partly usable" cut-offs
// used elsewhere (a B- is the lowest agent-ready grade, a D- the lowest partly usable).
const SCALE: [number, string][] = [
  [97, "A+"],
  [93, "A"],
  [90, "A-"],
  [87, "B+"],
  [83, "B"],
  [80, "B-"],
  [77, "C+"],
  [73, "C"],
  [70, "C-"],
  [67, "D+"],
  [63, "D"],
  [60, "D-"],
];

export function gradeOf(score: number): { letter: string; tone: Tone } {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const letter = SCALE.find(([min]) => s >= min)?.[1] ?? "F";
  const tone: Tone = s >= 80 ? "good" : s >= 70 ? "ok" : s >= 60 ? "warn" : "bad";
  return { letter, tone };
}

// How much a fix is likely to move the score, from its estimated points.
export function impactOf(points: number): { label: "Large" | "Medium" | "Small"; level: 1 | 2 | 3 } {
  if (points >= 10) return { label: "Large", level: 3 };
  if (points >= 5) return { label: "Medium", level: 2 };
  return { label: "Small", level: 1 };
}

export const PRIORITY_LABEL: Record<"high" | "med" | "low", string> = { high: "High", med: "Medium", low: "Low" };
