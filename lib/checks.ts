// Verified site checks: things we can measure directly from a site's files and raw HTML,
// with no browser and no TinyFish credit. They complement the agents, whose reports are
// judgement calls, with facts that come out the same every time.

import { parse, type HTMLElement } from "node-html-parser";
import type { Priority } from "@/lib/sites";

export type Check = {
  id: string;
  label: string;
  dim: 0 | 1 | 2 | 3; // index into DIMS: Discoverability, Navigability, Actionability, Reliability
  weight: number; // 0 when the check doesn't apply (e.g. no forms on the page): shown, not scored
  ok: boolean;
  detail: string;
  // Shown as a ranked fix when the check fails.
  severity: Priority;
  fix: string;
};

const UA = "Mozilla/5.0 (compatible; AxolotlBot/1.0; +https://github.com/git-sd/Axoweb)";
const TIMEOUT_MS = 8000;

// User agents of AI crawlers and assistants that browse on someone's behalf.
const AI_AGENTS = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot"];

// schema.org types that tell an agent what each kind of site offers.
const USEFUL_SCHEMA: Record<string, string[]> = {
  booking: ["Hotel", "LodgingBusiness", "Restaurant", "Reservation", "LocalBusiness", "Event", "Offer"],
  shop: ["Product", "Offer", "AggregateOffer", "ItemList", "Organization"],
  saas: ["SoftwareApplication", "WebApplication", "Product", "Offer", "Organization", "FAQPage"],
  docs: ["TechArticle", "Article", "HowTo", "FAQPage", "BreadcrumbList", "WebSite"],
  lead: ["LocalBusiness", "Organization", "ContactPoint", "Service", "ProfessionalService"],
  custom: ["Organization", "WebSite", "Product", "Service", "LocalBusiness"],
};

async function get(url: string): Promise<{ status: number; text: string; type: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Cap what we read: we only need the start of a page.
    const text = (await res.text()).slice(0, 1_500_000);
    return { status: res.status, text, type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

// Which AI agents does robots.txt shut out of the whole site? Uses each agent's own
// group if it has one, otherwise the "*" group, as crawlers do.
export function blockedAgents(robots: string): string[] {
  const groups: { agents: string[]; rules: [string, string][] }[] = [];
  let current: { agents: string[]; rules: [string, string][] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push([key, value]);
    }
  }
  const blocksRoot = (rules: [string, string][]) =>
    rules.some(([k, v]) => k === "disallow" && v === "/") && !rules.some(([k, v]) => k === "allow" && v === "/");
  const star = groups.find((g) => g.agents.includes("*"));
  return AI_AGENTS.filter((agent) => {
    const own = groups.find((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
    const group = own ?? star;
    return group ? blocksRoot(group.rules) : false;
  });
}

function hasName(el: HTMLElement) {
  return !!(el.getAttribute("aria-label")?.trim() || el.getAttribute("aria-labelledby") || el.getAttribute("title")?.trim() || el.text.trim() || el.querySelector("img[alt]:not([alt=''])"));
}

export async function runChecks(url: string, type: string): Promise<Check[]> {
  const origin = new URL(url).origin;
  const [page, robots, llms, sitemap] = await Promise.all([
    get(url),
    get(`${origin}/robots.txt`),
    get(`${origin}/llms.txt`),
    get(`${origin}/sitemap.xml`),
  ]);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // --- Files at the root of the site ---------------------------------------------------
  const robotsText = robots && robots.status === 200 && !/<html/i.test(robots.text.slice(0, 500)) ? robots.text : "";
  const blocked = robotsText ? blockedAgents(robotsText) : [];
  add({
    id: "robots",
    label: "AI agents allowed in robots.txt",
    dim: 0,
    weight: 3,
    ok: blocked.length === 0,
    detail: blocked.length ? `Blocks ${blocked.join(", ")}` : robotsText ? "No AI agents are blocked" : "No robots.txt, so nothing is blocked",
    severity: blocked.length > 3 ? "high" : "med",
    fix: `Allow the agents you want to reach you in robots.txt. It currently disallows ${blocked.slice(0, 4).join(", ")}${blocked.length > 4 ? " and others" : ""} from the whole site.`,
  });

  const sitemapInRobots = /^\s*sitemap\s*:/im.test(robotsText);
  const sitemapOk = sitemapInRobots || (!!sitemap && sitemap.status === 200 && /<(urlset|sitemapindex)/i.test(sitemap.text.slice(0, 2000)));
  add({
    id: "sitemap",
    label: "Sitemap available",
    dim: 0,
    weight: 1,
    ok: sitemapOk,
    detail: sitemapOk ? (sitemapInRobots ? "Listed in robots.txt" : "Found at /sitemap.xml") : "No sitemap found",
    severity: "low",
    fix: "Publish a sitemap.xml listing your key pages and reference it from robots.txt with a Sitemap: line.",
  });

  const llmsOk = !!llms && llms.status === 200 && llms.text.trim().length > 20 && !/<html/i.test(llms.text.slice(0, 500));
  add({
    id: "llms",
    label: "llms.txt for AI agents",
    dim: 0,
    weight: 1,
    ok: llmsOk,
    detail: llmsOk ? "Found at /llms.txt" : "No /llms.txt",
    severity: "low",
    fix: "Add an /llms.txt file: a short plain-text guide to what your site offers and links to its most important pages.",
  });

  // --- The page itself, as delivered before any JavaScript runs ------------------------
  if (!page || page.status >= 400 || !/html/i.test(page.type)) {
    add({
      id: "fetch",
      label: "Page loads for automated visitors",
      dim: 3,
      weight: 4,
      ok: false,
      detail: page ? `The server answered ${page.status}` : "The page did not respond in time",
      severity: "high",
      fix: "Make sure the page returns its content to automated visitors instead of an error or a block page. Bot protection that rejects all non-browser traffic also locks out AI agents.",
    });
    return checks;
  }

  const root = parse(page.text, { blockTextElements: { script: true, style: true, noscript: false } });
  const html = root.querySelector("html");

  // Structured data
  const types = new Set<string>();
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    for (const m of s.text.matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
      for (const t of m[1].match(/"([^"]+)"/g) ?? []) types.add(t.replace(/"/g, "").replace(/^.*[/:]/, ""));
    }
  }
  const wanted = USEFUL_SCHEMA[type] ?? USEFUL_SCHEMA.custom;
  const useful = [...types].filter((t) => wanted.includes(t));
  add({
    id: "schema",
    label: "Structured data (schema.org)",
    dim: 0,
    weight: 2,
    ok: useful.length > 0,
    detail: types.size ? `Found ${[...types].slice(0, 5).join(", ")}` : "No JSON-LD structured data",
    severity: "med",
    fix: `Add schema.org JSON-LD describing what you offer, for example ${wanted.slice(0, 3).join(", ")}, so agents can read prices, availability and details without guessing.`,
  });

  // Title, description, language
  const title = root.querySelector("title")?.text.trim() ?? "";
  const description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  const lang = html?.getAttribute("lang") ?? "";
  const missing = [!title && "title", !description && "meta description", !lang && "language"].filter(Boolean);
  add({
    id: "meta",
    label: "Page title, description and language",
    dim: 0,
    weight: 1,
    ok: missing.length === 0,
    detail: missing.length ? `Missing ${missing.join(", ")}` : "All present",
    severity: "low",
    fix: `Add the missing ${missing.join(", ")} so agents can tell what the page is and which language it uses.`,
  });

  // Content before JavaScript
  const body = root.querySelector("body") ?? root;
  const words = body.text.replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length > 1).length;
  add({
    id: "nojs",
    label: "Content present without JavaScript",
    dim: 3,
    weight: 3,
    ok: words >= 80,
    detail: `${words} words in the page as first delivered`,
    severity: words < 20 ? "high" : "med",
    fix: "Render your main content on the server (or pre-render it) so it is in the HTML. Many agents and AI crawlers read the page before, or without, running JavaScript.",
  });

  // Form fields with labels
  const inputs = root
    .querySelectorAll("input, select, textarea")
    .filter((el) => !/^(hidden|submit|button|reset|image)$/i.test(el.getAttribute("type") ?? ""));
  const labelFor = new Set(root.querySelectorAll("label[for]").map((l) => l.getAttribute("for")));
  const unlabelled = inputs.filter((el) => {
    const id = el.getAttribute("id");
    if (id && labelFor.has(id)) return false;
    if (el.getAttribute("aria-label")?.trim() || el.getAttribute("aria-labelledby") || el.getAttribute("title")?.trim()) return false;
    let p = el.parentNode as HTMLElement | null;
    for (let i = 0; p && i < 4; i++, p = p.parentNode as HTMLElement | null) if (p.rawTagName?.toLowerCase() === "label") return false;
    return true;
  });
  add({
    id: "labels",
    label: "Form fields have labels",
    dim: 2,
    weight: inputs.length ? 3 : 0,
    ok: unlabelled.length === 0,
    detail: inputs.length ? `${inputs.length - unlabelled.length} of ${inputs.length} fields labelled` : "No form fields on this page",
    severity: unlabelled.length > 2 ? "high" : "med",
    fix: `Give every form field a label (a <label for> element or an aria-label). ${unlabelled.length} field${unlabelled.length === 1 ? " has" : "s have"} none, so an agent has to guess what to type where.`,
  });

  // Buttons with names
  const buttons = root.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
  const nameless = buttons.filter((b) => b.rawTagName?.toLowerCase() === "input" ? !(b.getAttribute("value")?.trim() || b.getAttribute("aria-label")) : !hasName(b));
  add({
    id: "buttons",
    label: "Buttons have names",
    dim: 2,
    weight: buttons.length ? 2 : 0,
    ok: nameless.length === 0,
    detail: buttons.length ? `${buttons.length - nameless.length} of ${buttons.length} buttons named` : "No buttons on this page",
    severity: nameless.length > 3 ? "high" : "med",
    fix: `Give icon-only buttons an aria-label describing what they do. ${nameless.length} button${nameless.length === 1 ? " has" : "s have"} no text or label an agent can read.`,
  });

  // Images with alt text
  const imgs = root.querySelectorAll("img");
  const noAlt = imgs.filter((i) => i.getAttribute("alt") === undefined);
  add({
    id: "alt",
    label: "Images have alt text",
    dim: 1,
    weight: imgs.length ? 1 : 0,
    ok: imgs.length === 0 || noAlt.length / imgs.length <= 0.2,
    detail: imgs.length ? `${imgs.length - noAlt.length} of ${imgs.length} images have alt text` : "No images on this page",
    severity: "low",
    fix: `Add alt text to images, especially product photos and image links. ${noAlt.length} image${noAlt.length === 1 ? " has" : "s have"} none.`,
  });

  return checks;
}
