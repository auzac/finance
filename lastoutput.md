# Session Transcript — Financial Calculator

Record of the working session on 2026-10-10, written at the end of the day as a
handoff. Chronological log of what was built, why, and where things stand.

## Project

Personal finance web app, FARE-inspired minimal UI. Two tools share one shell:

- **Projection** — annual savings/wealth projection (salary, tax, increments,
  AWS/performance bonuses as months of salary, expenses + inflation, funds with
  fixed or % allocations and returns) with table, chart, and warnings.
- **Salary growth** — income projected year by year between a low and a high
  yearly increase estimate (percent compounding or fixed-value steps).

Stack per `structure.md`: static HTML/CSS/vanilla JS, pure Python engines,
one endpoint per tool, pytest, Vercel target. `context.md` / `instructions.md` /
`structure.md` remain the source-of-truth docs (updated along the way).

## Timeline

1. **Docs committed** — context.md, instructions.md, structure.md, README.
2. **Built V1 (Projection)** — `api/projection.py` engine + `api/calculate.py`
   endpoint + `dev_server.py` (single-origin local server) + `assets/` UI +
   29 tests. Conventions: annual fund return applied as
   `(open + contributions) × (1 + r)`; deficit years allocate 0 to percentage
   funds; over-allocation returned as 200 + per-year `warnings` (never
   auto-capped); unrounded math, rounded display only.
3. **UI iterations** (same tool) — bonuses became AWS + performance entered as
   months of gross salary; debounced live recalculation + per-year affordability
   strips; sticky sidebar with take-home/commitments/surplus/remaining; fixed
   the hero offset (CSS grid min-width blowout); money shown once per table via
   an "Amounts in …" pill; breakdown restructured (dropped commitments rows,
   funds split into contributions/balance, wealth section reconciles to total);
   input sections compacted; expense/fund rows became striped grid-tables with
   one shared heading row; fund % allocation chips in the section header
   (green allocated / grey unallocated / red over); green "+ Add" pills moved
   into section headers; sticky topbar with the single Calculate action;
   sidebar nav restructured with "Projection" as an expandable parent.
4. **Revamp (user-supplied, another Claude)** — page intro hero with ribbon,
   per-field hints, aria wiring, form styling. Two things fixed after it:
   `assets/app.js` had been overwritten with a copy of index.html (restored
   from git, verified all 43 ids still matched), and the Calculate buttons
   were bound directly to `calculate` so the click Event made `manual` always
   false (silent errors) — fixed with wrapper arrows.
5. **Second tool: Salary growth** — `api/salary_growth.py` + `api/salary.py`
   (`POST /api/salary`, both routed by dev_server) + tests + UI with tool
   switching (`setTool`), band chart for the range (single line + fill when
   low = high), vertical year-by-year table (years as rows, Low/High estimate
   groups with equal-width columns via `table-layout: fixed`), per-tool drafts.
   The fixed-increase mode was dropped at the user's request — low/high only.
6. **Committed & pushed** — `ad47ee4` "Add salary growth tool and refine the
   UI" on `main`.

## Current state

- Tests: **41/41 passing** (`python -m pytest`).
- App runs via `dev_server.py` → http://localhost:8000 serving both tools and
  both endpoints on one origin.
- Working tree: clean, everything committed and pushed through `ad47ee4`.

## Environment notes (Windows)

- Python is Anaconda, not on PATH:
  `& "$env:USERPROFILE\anaconda3\python.exe" dev_server.py`
- **Restart the dev server after engine changes** — Python caches imports at
  startup (this bit us once: bonuses showed 0 until restart).
- Drafts persist in localStorage: `growth-calculator-draft-v3` (projection),
  `salary-growth-draft-v1` (salary).
- Design references are gitignored: `financial-growth-ui-sample.html`,
  `sample.jpg`.
- On first Vercel deploy, verify the `api/*.py` import paths (two endpoints
  now; `calculate.py`/`salary.py` insert their own dir on `sys.path` and fall
  back to relative imports).

## Last conversation (end of session)

Prompt: *"i feel like index.html was meant for just the home, while the tools
should have its own pages? or what am I missing in our current structure
currently?"*

Answer given: `index.html` is not a home page — it is the whole app (shell +
both tools' markup, switched by toggling `hidden` via `setTool()`), i.e. a
single-page app with view switching and **no URL state**. What is genuinely
missing is real URLs: switching tools doesn't change the address bar, so
refresh always lands on Projection and deep links/bookmarks/back-button don't
work. A true multi-page split has a real cost here because the repo has no
build step or templating: the shared shell (sidebar/topbar, ~60 lines) would
be duplicated per page and `app.js` would need splitting. Recommendation:
**(1)** add hash routing (`#projection` / `#salary`, read on load, write on
switch, handle `hashchange`) now — ~15 lines; **(2)** reconsider multi-page
when a third tool arrives (shared `shell.js` injecting the sidebar);
**(3)** add a real home page only once several tools exist.

**Pending (not done — offered, awaiting go-ahead):** implement the hash
routing so each tool has a bookmarkable URL.
