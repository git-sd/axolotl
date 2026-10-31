export const DIMS = ["Discoverability", "Navigability", "Actionability", "Reliability"] as const;

export type Priority = "high" | "med" | "low";

// w: the share of the final score each dimension carries for this kind of site (sums to 1).
export type SiteType = {
  name: string;
  sub: string;
  w: number[];
};

export const SITES: Record<string, SiteType> = {
  booking: { name: "Booking", sub: "Hotels, tables, appointments", w: [0.2, 0.25, 0.35, 0.2] },
  shop: { name: "E-commerce", sub: "Products, cart, checkout", w: [0.25, 0.2, 0.35, 0.2] },
  saas: { name: "SaaS", sub: "Trials, pricing, onboarding", w: [0.2, 0.2, 0.4, 0.2] },
  docs: { name: "Content & docs", sub: "Articles, help centres, docs", w: [0.4, 0.3, 0.1, 0.2] },
  lead: { name: "Lead-gen forms", sub: "Quotes, contact, applications", w: [0.15, 0.2, 0.45, 0.2] },
  custom: { name: "Custom project", sub: "", w: [0.25, 0.25, 0.3, 0.2] },
};

export const PRESETS = ["booking", "shop", "saas", "docs", "lead"] as const;

export const KEYS: Record<string, string[]> = {
  booking: ["book", "reserv", "hotel", "appointment", "table", "ticket", "stay", "rental", "schedule", "slot", "dog walker"],
  shop: ["shop", "store", "cart", "checkout", "product", "buy", "sell", "ecommerce", "e-commerce", "retail", "merch", "marketplace"],
  saas: ["saas", "software", "app", "trial", "subscription", "dashboard", "platform", "tool", "sign up", "signup", "api"],
  docs: ["blog", "docs", "documentation", "article", "news", "tutorial", "help centre", "help center", "guide", "wiki", "content"],
  lead: ["quote", "lead", "contact", "enquir", "inquiry", "apply", "application", "consult", "agency", "insurance", "loan", "form"],
};

export function detect(text: string): string | null {
  const t = text.toLowerCase();
  let best: string | null = null;
  let n = 0;
  for (const k in KEYS) {
    const c = KEYS[k].filter((w) => t.includes(w)).length;
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return best;
}

export const verdictOf = (n: number): [string, string] =>
  n >= 80
    ? ["Agent-ready", "Agents complete most tasks without help."]
    : n >= 60
      ? ["Partly usable", "Agents get through, but trip on key steps."]
      : ["Hard for agents", "Agents fail at critical steps."];
