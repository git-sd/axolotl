---
name: axolotl
description: Check how ready a website is for AI agents (agent experience optimization). Use when the user asks whether a site is agent-friendly, wants an agent-readiness score, or wants fixes so AI agents can find, navigate and complete tasks on their site.
---

# Axolotl

Needs the Axolotl MCP server (`axolotl_check`, `axolotl_scan`).

1. Ask for the site address and what kind of site it is: booking, shop, saas, docs, lead (lead-gen forms) or custom. Guess from the URL if it is obvious.
2. Run `axolotl_check` first. It is free and takes seconds.
3. Report the score out of 100, the four dimension scores (Discoverability, Navigability, Actionability, Reliability), and the failed checks with their fixes, highest severity first.
4. Offer `axolotl_scan` only if the user wants proof that real tasks (checkout, booking, sign-up) work. It takes 3 to 4 minutes and spends the user's own TinyFish credits and needs `TINYFISH_API_KEY` set for the MCP server, so get a clear yes before running it. If the tool says the key is missing, tell the user to set it; never ask them to paste the key into chat.
5. In a scan result, a task marked not scored or not run was left out of the score because of time, not counted against the site. Say so.

Do not claim the checks-only score covers whether agents can complete tasks; it only covers what the site's pages and files show.
