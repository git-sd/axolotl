// Verified site checks: things we can measure directly from a site's files and raw HTML,
// with no browser and no TinyFish credit. They complement the agents, whose reports are
// judgement calls, with facts that come out the same every time.

import { parse, type HTMLElement } from "node-html-parser";
import type { Priority } from "@/lib/sites";

export const DIM_NAMES = ["Discoverability", "Navigability", "Actionability", "Reliability"] as const;

export type Check = {
  id: string;
  label: string;
  dim: 0 | 1 | 2 | 3; // index into DIM_NAMES
  weight: number; // 0 when the check doesn't apply (e.g. no forms on the page): shown, not scored
  ok: boolean;
  detail: string; // what we found on this site
  why: string; // why an agent cares, in plain words (same for every site)
  // Shown as a ranked fix when the check fails.
  severity: Priority;
  fix: string;
};

const UA = "Mozilla/5.0 (compatible; AxolotlBot/1.0; +https://github.com/git-sd/axolotl)";
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

// Link texts that tell an agent (or a screen reader user) nothing about the destination.
const VAGUE_LINK = new Set(["click here", "here", "read more", "more", "learn more", "link", "this", "click", "details", "continue"]);

type Fetched = { status: number; text: string; type: string; ms: number; url: string; headers: Headers };

async function get(url: string): Promise<Fetched | null> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Cap what we read: we only need the start of a page.
    const text = (await res.text()).slice(0, 1_500_000);
    return { status: res.status, text, type: res.headers.get("content-type") ?? "", ms: Date.now() - t0, url: res.url || url, headers: res.headers };
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Pure: all the checks that read a page's HTML. Exported so they can be tested without a network.
export function pageChecks(html: string, type: string, pageUrl: string): Check[] {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: false } });
  const htmlEl = root.querySelector("html");

  // ---- Discoverability -----------------------------------------------------------------
  const types = new Set<string>();
  const ld = root.querySelectorAll('script[type="application/ld+json"]');
  let ldBroken = 0;
  for (const s of ld) {
    try {
      JSON.parse(s.text);
    } catch {
      ldBroken++;
    }
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
    why: "Structured data lets an agent read prices, availability, hours and what you offer directly, instead of guessing from the page layout.",
    severity: "med",
    fix: `Add schema.org JSON-LD describing what you offer, for example ${wanted.slice(0, 3).join(", ")}, so agents can read prices, availability and details without guessing.`,
  });
  add({
    id: "jsonld",
    label: "Structured data is valid JSON",
    dim: 0,
    weight: ld.length ? 1 : 0,
    ok: ldBroken === 0,
    detail: ld.length ? (ldBroken ? `${plural(ldBroken, "block")} of ${ld.length} could not be parsed` : `${plural(ld.length, "block")} parsed cleanly`) : "No structured data to check",
    why: "A broken JSON-LD block is silently ignored, so the information in it never reaches agents.",
    severity: "med",
    fix: "Fix the syntax of your JSON-LD blocks (a missing comma or quote is the usual cause). Paste each one into a JSON validator to find it.",
  });

  const title = root.querySelector("title")?.text.trim() ?? "";
  const description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  const missing = [!title && "title", !description && "meta description"].filter(Boolean);
  add({
    id: "meta",
    label: "Page title and meta description",
    dim: 0,
    weight: 2,
    ok: missing.length === 0,
    detail: missing.length ? `Missing ${missing.join(" and ")}` : `Title "${title.slice(0, 50)}${title.length > 50 ? "…" : ""}" and a description`,
    why: "The title and description are the first summary an agent gets of a page, before it reads anything else.",
    severity: "med",
    fix: `Add the missing ${missing.join(" and ")}: one clear sentence about what this page offers.`,
  });

  const lang = htmlEl?.getAttribute("lang") ?? "";
  add({
    id: "lang",
    label: "Page language declared",
    dim: 0,
    weight: 1,
    ok: !!lang,
    detail: lang ? `lang="${lang}"` : "No lang attribute on <html>",
    why: "Agents use the declared language to decide how to read and translate the page.",
    severity: "low",
    fix: 'Add a lang attribute to the <html> element, for example <html lang="en">.',
  });

  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute("content");
  add({
    id: "og",
    label: "Open Graph tags",
    dim: 0,
    weight: 1,
    ok: !!ogTitle && !!ogDesc,
    detail: ogTitle && ogDesc ? "og:title and og:description present" : `Missing ${[!ogTitle && "og:title", !ogDesc && "og:description"].filter(Boolean).join(" and ")}`,
    why: "Open Graph tags are the summary used when an assistant or app previews or quotes your page.",
    severity: "low",
    fix: "Add og:title and og:description meta tags (and og:image) to the page head.",
  });

  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href");
  add({
    id: "canonical",
    label: "Canonical address set",
    dim: 0,
    weight: 1,
    ok: !!canonical,
    detail: canonical ? `Points to ${canonical.slice(0, 60)}` : "No canonical link",
    why: "A canonical link tells agents which address is the real one when the same page is reachable several ways.",
    severity: "low",
    fix: 'Add <link rel="canonical" href="…"> pointing at the preferred address of each page.',
  });

  const robotsMeta = root.querySelector('meta[name="robots"]')?.getAttribute("content")?.toLowerCase() ?? "";
  const noindex = /noindex|nofollow|none/.test(robotsMeta);
  add({
    id: "noindex",
    label: "Page open to indexing",
    dim: 0,
    weight: 3,
    ok: !noindex,
    detail: noindex ? `robots meta says "${robotsMeta}"` : "No noindex or nofollow instruction",
    why: "A noindex or nofollow instruction tells agents and crawlers to ignore the page or not follow its links.",
    severity: "high",
    fix: "Remove noindex / nofollow from the robots meta tag on pages you want agents to use (keep it only on private pages).",
  });

  const h1s = root.querySelectorAll("h1");
  add({
    id: "h1",
    label: "One clear main heading",
    dim: 0,
    weight: 2,
    ok: h1s.length === 1,
    detail: h1s.length === 1 ? `"${h1s[0].text.trim().slice(0, 60)}"` : `${plural(h1s.length, "h1 element")} on the page`,
    why: "The main heading is how an agent knows what a page is about. None, or several competing ones, make that unclear.",
    severity: "med",
    fix: "Give each page exactly one <h1> that says what the page is about, and use <h2>/<h3> for the sections beneath it.",
  });

  // ---- Navigability --------------------------------------------------------------------
  const levels = root.querySelectorAll("h1, h2, h3, h4, h5, h6").map((h) => Number(h.rawTagName.slice(1)));
  let skips = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips++;
  add({
    id: "headings",
    label: "Headings in order",
    dim: 1,
    weight: levels.length ? 1 : 0,
    ok: skips === 0,
    detail: levels.length ? (skips ? `${plural(skips, "jump")} in heading levels (for example h2 to h4)` : `${levels.length} headings, no skipped levels`) : "No headings on this page",
    why: "Agents skim headings like a table of contents. Skipped levels make the outline unreliable.",
    severity: "low",
    fix: "Keep heading levels in sequence: h1, then h2, then h3, without skipping levels for styling reasons.",
  });

  const hasMain = !!root.querySelector("main, [role='main']");
  const hasNav = !!root.querySelector("nav, [role='navigation']");
  add({
    id: "landmarks",
    label: "Page landmarks (main and nav)",
    dim: 1,
    weight: 2,
    ok: hasMain && hasNav,
    detail: hasMain && hasNav ? "<main> and <nav> present" : `Missing ${[!hasMain && "<main>", !hasNav && "<nav>"].filter(Boolean).join(" and ")}`,
    why: "Landmarks let an agent jump straight to the main content or the menu instead of reading the whole page.",
    severity: "med",
    fix: "Wrap the primary content in <main> and the site menu in <nav>.",
  });

  const navLinks = root.querySelectorAll("nav a[href], [role='navigation'] a[href]").length;
  add({
    id: "navlinks",
    label: "Navigation links present",
    dim: 1,
    weight: 2,
    ok: navLinks >= 3,
    detail: navLinks ? `${plural(navLinks, "link")} in the navigation` : "No links found inside a navigation element",
    why: "The menu is the map of the site. Without real links in it, an agent cannot tell what sections exist.",
    severity: "med",
    fix: "Put your main sections in a <nav> element as ordinary <a href> links (not click handlers on <div>s).",
  });

  const anchors = root.querySelectorAll("a[href]").filter((a) => !/^(#|javascript:)/i.test(a.getAttribute("href") ?? ""));
  const vague = anchors.filter((a) => {
    const text = a.text.trim().toLowerCase().replace(/[.:→>»]+$/g, "");
    if (!text) return !(a.getAttribute("aria-label")?.trim() || a.querySelector("img[alt]:not([alt=''])") || a.querySelector("svg title"));
    return VAGUE_LINK.has(text);
  });
  add({
    id: "linktext",
    label: "Links say where they go",
    dim: 1,
    weight: anchors.length ? 2 : 0,
    ok: anchors.length === 0 || vague.length / anchors.length <= 0.15,
    detail: anchors.length ? `${vague.length} of ${anchors.length} links have empty or vague text` : "No links on this page",
    why: "An agent chooses where to click from the link text. 'Click here' and empty icon links give it nothing to go on.",
    severity: vague.length > 5 ? "high" : "med",
    fix: `Rewrite links like "Read more" or icon-only links so the text or an aria-label says the destination (for example "Pricing plans"). ${vague.length} need it.`,
  });

  const imgs = root.querySelectorAll("img");
  const noAlt = imgs.filter((i) => i.getAttribute("alt") === undefined);
  add({
    id: "alt",
    label: "Images have alt text",
    dim: 1,
    weight: imgs.length ? 1 : 0,
    ok: imgs.length === 0 || noAlt.length / imgs.length <= 0.2,
    detail: imgs.length ? `${imgs.length - noAlt.length} of ${imgs.length} images have alt text` : "No images on this page",
    why: "Agents cannot see images. Alt text is how they learn what a product photo or an image link shows.",
    severity: "low",
    fix: `Add alt text to images, especially product photos and image links. ${noAlt.length} image${noAlt.length === 1 ? " has" : "s have"} none.`,
  });

  const contactLinks = root.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]').length;
  add({
    id: "contact",
    label: "Contact details on the page",
    dim: 1,
    weight: 1,
    ok: contactLinks > 0,
    detail: contactLinks ? `${plural(contactLinks, "email or phone link")} found` : "No mailto: or tel: links on this page",
    why: "When an agent gets stuck, a plain email or phone link is the way out (and the way it hands over to a human).",
    severity: "low",
    fix: "Show an email address and/or phone number as mailto: and tel: links, for example in the footer.",
  });

  // ---- Actionability -------------------------------------------------------------------
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
    why: "A label is how an agent knows what to type where. Placeholder text alone often disappears or is not read.",
    severity: unlabelled.length > 2 ? "high" : "med",
    fix: `Give every form field a label (a <label for> element or an aria-label). ${unlabelled.length} field${unlabelled.length === 1 ? " has" : "s have"} none, so an agent has to guess what to type where.`,
  });

  const personal = inputs.filter((el) => /^(email|tel)$/i.test(el.getAttribute("type") ?? "") || /name|email|phone|address|zip|postal|city/i.test(el.getAttribute("name") ?? el.getAttribute("id") ?? ""));
  const noAuto = personal.filter((el) => !el.getAttribute("autocomplete"));
  add({
    id: "autocomplete",
    label: "Personal fields use autocomplete hints",
    dim: 2,
    weight: personal.length ? 1 : 0,
    ok: noAuto.length === 0,
    detail: personal.length ? `${personal.length - noAuto.length} of ${personal.length} personal-detail fields carry an autocomplete hint` : "No name, email or address fields on this page",
    why: "An autocomplete hint (name, email, tel) tells an agent exactly which of its stored details belongs in the field.",
    severity: "low",
    fix: 'Add autocomplete attributes to personal-detail fields, for example autocomplete="email", "given-name", "tel".',
  });

  const buttons = root.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
  const nameless = buttons.filter((b) => (b.rawTagName?.toLowerCase() === "input" ? !(b.getAttribute("value")?.trim() || b.getAttribute("aria-label")) : !hasName(b)));
  add({
    id: "buttons",
    label: "Buttons have names",
    dim: 2,
    weight: buttons.length ? 2 : 0,
    ok: nameless.length === 0,
    detail: buttons.length ? `${buttons.length - nameless.length} of ${buttons.length} buttons named` : "No buttons on this page",
    why: "An icon-only button with no name is invisible to an agent: it cannot tell 'Add to cart' from 'Close'.",
    severity: nameless.length > 3 ? "high" : "med",
    fix: `Give icon-only buttons an aria-label describing what they do. ${nameless.length} button${nameless.length === 1 ? " has" : "s have"} no text or label an agent can read.`,
  });

  const captcha = /recaptcha|hcaptcha|cf-turnstile|g-recaptcha|arkoselabs|funcaptcha/i.test(html);
  add({
    id: "captcha",
    label: "No CAPTCHA on the first page",
    dim: 2,
    weight: 3,
    ok: !captcha,
    detail: captcha ? "A CAPTCHA or bot-challenge script is loaded on this page" : "No CAPTCHA script found",
    why: "A CAPTCHA is built to stop automated visitors, so it stops customers' AI agents too, and they simply take their business elsewhere.",
    severity: "high",
    fix: "Avoid CAPTCHAs on the main path. Use risk-based checks that only challenge suspicious traffic, or offer an API or a verified-agent route.",
  });

  // ---- Reliability ---------------------------------------------------------------------
  const body = root.querySelector("body") ?? root;
  const words = body.text.replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length > 1).length;
  add({
    id: "nojs",
    label: "Content present without JavaScript",
    dim: 3,
    weight: 3,
    ok: words >= 80,
    detail: `${words} words in the page as first delivered`,
    why: "Many agents and AI crawlers read the page before, or without, running JavaScript. If the content only appears afterwards, they see an empty page.",
    severity: words < 20 ? "high" : "med",
    fix: "Render your main content on the server (or pre-render it) so it is in the HTML. Many agents and AI crawlers read the page before, or without, running JavaScript.",
  });

  const viewport = root.querySelector('meta[name="viewport"]');
  add({
    id: "viewport",
    label: "Mobile viewport set",
    dim: 3,
    weight: 1,
    ok: !!viewport,
    detail: viewport ? "Viewport meta tag present" : "No viewport meta tag",
    why: "Without it, the page lays out as a shrunken desktop site on a phone, and agents working in a mobile view may misread or miss controls.",
    severity: "low",
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the page head.',
  });

  const size = html.length;
  add({
    id: "size",
    label: "Page is a reasonable size",
    dim: 3,
    weight: 1,
    ok: size < 800_000,
    detail: `${Math.round(size / 1024)} KB of HTML${size >= 1_500_000 ? " (capped at 1.5 MB when reading)" : ""}`,
    why: "Very large pages are slow for an agent to read and can exceed what it is able to take in at once.",
    severity: "low",
    fix: "Trim the HTML: avoid inlining large scripts, data blobs or thousands of repeated elements, and paginate long lists.",
  });

  const https = pageUrl.startsWith("https://");
  add({
    id: "https",
    label: "Served over HTTPS",
    dim: 3,
    weight: 2,
    ok: https,
    detail: https ? "The page is served over HTTPS" : "The page is served over plain HTTP",
    why: "Agents and browsers warn about, or refuse, sites that are not served over HTTPS, and forms on them are not safe to fill.",
    severity: "high",
    fix: "Serve the whole site over HTTPS and redirect http:// addresses to https://.",
  });

  return checks;
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
    why: "robots.txt is the first file well-behaved agents read. If it shuts them out, they leave without trying your site.",
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
    why: "A sitemap is a complete list of your pages, so an agent can go straight to the right one instead of crawling.",
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
    why: "llms.txt is a plain-text briefing written for AI agents: what the site is and where the important pages are.",
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
      why: "If the page itself will not load for an automated visitor, nothing else about the site matters to an agent.",
      severity: "high",
      fix: "Make sure the page returns its content to automated visitors instead of an error or a block page. Bot protection that rejects all non-browser traffic also locks out AI agents.",
    });
    return checks;
  }

  checks.push(...pageChecks(page.text, type, page.url));

  // Response headers can also say noindex.
  const xrobots = page.headers.get("x-robots-tag")?.toLowerCase() ?? "";
  if (/noindex|nofollow|none/.test(xrobots)) {
    const c = checks.find((x) => x.id === "noindex");
    if (c) {
      c.ok = false;
      c.detail = `X-Robots-Tag header says "${xrobots}"`;
    }
  }

  add({
    id: "speed",
    label: "Page responds quickly",
    dim: 3,
    weight: 2,
    ok: page.ms < 2500,
    detail: `Loaded in ${(page.ms / 1000).toFixed(1)}s (measured from our server)`,
    why: "Agents work against time limits. A slow first response means they time out or give up before the page is usable.",
    severity: page.ms > 5000 ? "high" : "med",
    fix: "Speed up the first response: cache the page at the edge, trim server work before the HTML is sent, and avoid long redirect chains.",
  });

  return checks;
}
