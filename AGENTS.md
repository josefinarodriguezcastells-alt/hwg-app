# Agent workflow

Every task moves through the same four beats, each backed by a skill from
this collection (or installed alongside it — see [Skill sources](#skill-sources)).
This file governs work in this repo (`hwg-app`, the candidate-facing app).

## Workflow

1. **Isolate — `/new-feature`.** Every new task starts in a fresh Git
   worktree branched from `origin/main` so agents can work in parallel
   without conflicts. Never build on `main`.
2. **Build — `/code-structure`.** Write code to the service-layer
   architecture: actions/boundaries orchestrate the "why/when", a service
   layer owns the reusable "how", with explicit inputs and structured
   returns.
   - **Repo override:** this is a static HTML app (`index.html`,
     `perfil.html`) backed by Vercel serverless functions under `api/`. Each
     file in `api/` is its own endpoint — keep the "why/when" (validate the
     request, check auth, call the right thing) in the endpoint file, and
     put shared operational logic (PDF/DOCX generation, mail sending, auth
     checks) in a module other endpoints can import, following the existing
     `api/_auth.js`, `api/_pdf-text.js` pattern (underscore prefix = shared
     helper, not its own endpoint).
3. **Prove — `/evidence-driven-testing`.** Verify with the repo's checks
   plus runtime evidence.
   - **Repo override:** there is no test suite, no linter, and no build step
     (`package.json` has no scripts at all). Evidence here means exercising
     the actual endpoint — with `curl` for API behavior (this is the
     established way to verify auth/permission fixes in this repo, e.g. the
     `users` table lockdown was confirmed with a raw `curl -X DELETE`) or a
     browser for `index.html`/`perfil.html` flows — against real data, since
     there's no seed/fixture database.
   - **Production-data safeguard (required, not optional):** "against real
     data" means read-only by default. A `curl` that verifies an
     auth/permission fix should hit a GET, or a mutating method with a
     bogus/expired token expected to be rejected (the `users` DELETE
     precedent) — never a `curl` that actually succeeds in writing,
     updating, or deleting a real row, unless the person running it has
     explicitly said to and understands a real record will change. Endpoints
     that write through `api/owner-data.js` (POST/PATCH/DELETE) or publish
     through `api/save-profile.js` are exactly the ones this applies to.
     Same for browser flows: a UI test that would submit a real form,
     confirm a hire, or publish a profile needs either an explicit go-ahead
     to mutate a real record, or a write-guard (intercept `window.fetch` in
     the page for mutating methods and return a mocked success instead of
     letting it hit the API). This repo's frontend uses plain `fetch()`,
     not the `@supabase/supabase-js` client (unlike `hwg_ats` — see its own
     `AGENTS.md`, the two need different approaches), so a `window.fetch`
     override does catch the request mechanically. **That is not enough on
     its own**, though: `perfil.html` calls `markViewed()` automatically on
     page load — a plain `fetch()` PATCH straight to the Supabase REST API
     (`candidate_presentations`, sets `viewed_at`), no user action required
     — and it fires before an agent driving a browser gets a chance to
     inject any override at all. Simply loading a real candidate's
     `perfil.html` link, guard installed or not, already mutates that row.
     For this specific page, don't navigate to a real token's perfil link
     during verification at all (use a throwaway/test presentation row, or
     just read the code path) unless marking it "viewed" is an accepted,
     explicitly agreed side effect.
4. **Ship — `/before-and-after`, then `/greploop`.** Open the PR with
   before/after proof embedded in the description (a `curl` request/response
   pair counts as evidence when there's no visible UI surface). Run
   `/greploop` — or `/greploop-apps` on huge PRs — until Greptile reports
   **5/5 with zero unresolved comments**. Finish by presenting the PR URL.
   - **Tooling reality check (2026-09-22):** Greptile **is** installed as a
     GitHub App on this repo (confirmed in the Greptile dashboard —
     `josefinarodriguezcastells-alt/hwg-app` shows Enabled) — open the PR
     and wait for its review comment; don't skip straight to asking for a
     merge. The named skills still aren't installed in every environment
     this repo is worked from, though — where one isn't available, do the
     step by hand instead of skipping it: branch, PR, before/after
     evidence via plain `git`/`gh`, and a deliberate self-review of the
     whole diff written into the PR description, in place of whatever the
     missing skill would have automated. Checking Greptile's actual
     verdict on the PR is not optional regardless of which skills are
     installed.

## Writing for humans

Run `/unslop` over anything a person will read before you commit, post, or
send it: commit messages, PR title and body, and the closing reply. Where
`/unslop` isn't installed, do an equivalent manual pass: cut hedging and
filler, keep sentences concrete, make sure a reader outside this
conversation could follow it without missing context.

## Multi-agent rules

- Never commit directly to `main`.
- One worktree and one branch per task and per agent.
- **Scope check** before starting: skim open PRs (`gh pr list`) and look for
  uncommitted work in shared checkouts. On overlap, stop and ask for
  direction.
- Never force-push to `main`; only `--force-with-lease`, only on your own
  branch.
- If a conflict can't be resolved confidently, stop and report instead of
  guessing.

## Completing a task

1. Keep changes limited to the assigned task.
2. There's no automated check to run — verify manually per the Prove
   section above and capture the evidence as you go.
3. Commit with a clear message, rebase onto `origin/main`, and re-verify.
4. Push and open the PR. The body must explain what changed, how it was
   tested (every claim backed by evidence — `curl` output or a screenshot),
   before/after proof, and any risks or follow-up work.
5. Run `/greploop` until **5/5 with zero unresolved comments**.
6. End by presenting the PR URL.

Do not merge the PR unless explicitly instructed. Do not change production
Vercel env vars or Supabase RLS/GRANT settings without calling that out
explicitly and getting confirmation first — several past incidents in this
app came from exactly that kind of change (see `sql/` for the lockdown
scripts from the last two).

## Hard invariants

- Any new endpoint that touches Supabase directly (not through
  `api/owner-data.js`/`api/login.js`'s `service_role` pattern) needs its own
  look at RLS: the default of "readable and writable by anon" is how the
  `users` table got exposed to unauthenticated DELETE/INSERT before it was
  locked down (`sql/lockdown-users-table.sql`). New tables/endpoints should
  default to locked down, not open.
- Auth flows (`api/login.js`, `api/_auth.js`) and anything issuing or
  checking a JWT are security-sensitive — treat changes there as needing
  explicit verification (a `curl` showing the unauthorized case is rejected
  and the authorized case still works), not just "it compiles."
- New `api/*.js` functions that need more than the default duration or bundle
  extra files (e.g. the `pdfjs-dist` worker, like `api/generate.js` does)
  need a matching entry in `vercel.json`'s `functions` block — a function
  that times out or can't find its worker file in production is usually a
  missing `vercel.json` entry, not an app bug.
- Don't reintroduce the `HWG_SECRET` header check — it was removed after
  confirming no RLS policy depended on it (see the git history around
  2026-09-16); reintroducing it without re-auditing RLS would give a false
  sense of security.

## Environment quick reference

- No dev server script; this is deployed via Vercel (`vercel dev` locally if
  needed to exercise `api/`).
- Needs `.env.local` for API keys/secrets used by `api/` (mail, DB, JWT
  signing) — not committed.
- Deploy config: `vercel.json` (rewrites, per-function `maxDuration` /
  `includeFiles`, CORS headers on `/api/*`).
- SQL migrations/lockdowns live in `sql/` as plain `.sql` files, run by hand
  against Supabase — there's no migration runner. A new one should follow
  the naming of the existing two (`lockdown-<table>-table.sql`).
- Testing is done against real production data directly; there is no
  seed/fixture database for this app.

## Skill sources

| Skill | Source |
|---|---|
| `new-feature`, `code-structure`, `evidence-driven-testing` | [michaelshimeles/skills](https://github.com/michaelshimeles/skills) |
| `before-and-after` | vendored from [vercel-labs/before-and-after](https://github.com/vercel-labs/before-and-after) |
| `greploop` | vendored from [greptileai/skills](https://github.com/greptileai/skills) |
| `greploop-apps` | local variant of greploop for huge PRs |
| `unslop` | vendored from [cursor/plugins (pstack)](https://github.com/cursor/plugins/tree/main/pstack/skills/unslop) |
