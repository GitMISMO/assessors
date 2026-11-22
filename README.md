# MISMO Assessor Portal

The page served at **https://resources.mismo.org/assessors/**. Each assessor firm (Falcon, Actualize, Viant Eye) signs in
and sees only its own engagements: the companies it is assessing, their questionnaire answers and documents, the
certification script, its schedule, and the steps it records. MISMO administrators see any firm's screen read-only
through **View As** (opened from the CMS, "Assessor Portal" firm cards).

## Which repository serves this page

**This one.** `resources.mismo.org` is the organization's Pages domain (held by `GitMISMO.github.io`); this repository
is a project site published under it, so it owns the `/assessors/` path. A folder of the same name inside
`GitMISMO.github.io` would be shadowed by this repository and serve nothing.

## This repository is public: no records in it

GitHub Pages needs a public repository, so this one holds the page's code only. Every firm's records live in its own
**private** repository (`GitMISMO/as-<firm>-data`) and are read through MISMO's save relay with the firm's own sign-in:

| What | Where it lives | Who writes it |
|---|---|---|
| The firm's engagements, scripts and earlier certifications | `as-<firm>-data`: `engagements/<firm>.json`, `engagements/scripts/` | The CMS jobs in `GitMISMO/cms-data` (build-engagements.js), after every change |
| Steps the firm records, holds, progress notes | `as-<firm>-data`: `notify/assessment/moves.json` | This page; `cms-data` reads them back (assessor-inbox.js) |
| Weekly times for demonstrations | `as-<firm>-data`: `notify/assessment/availability.json` | This page; the CMS scheduling job reads them |
| Uploaded documents | SharePoint (MISMO Certifications site), through the Power Automate flow "MISMO Assessor Documents - Upload"; the list in `notify/assessment/uploads.json` | This page, through the flow |

Never put a company name, an email address (other than mismo.org / mba.org), a fee or an invoice number in this
repository, including in code comments. The automatic checks look for them.

## Version and health

The foot of **Help** shows which copy of the page is open (a fingerprint and when it was published); every 15 minutes the
page checks for a newer copy and offers a reload. MISMO administrators also see **System Health** in the menu: whether the
relay answers, when each firm's engagements last arrived from the CMS (amber after a day and a half), whether a firm's
latest step is newer than its engagements (not picked up yet), its latest upload and weekly times, and any script problem
since the page opened. It reads only.

## Files

- `index.html`: the whole portal (layout, styles in `portal.css`, and the application script).
- `relay.js`: signing in and reading/saving through the relay (`window.RELAY` in `index.html` lists the only keys it
  may use: `as-falcon`, `as-actualize`, `as-vianteye`).
- `portal.css`: the portal's look.
- `tests/`: the automatic checks (below). `tests/fixtures/engagements.json` is a made-up firm with made-up companies.
- `CHANGELOG.md`: one line for each change people would notice. Add one with every change.

## How this is updated

Edit the files here (on GitHub, or upload a changed file) and commit to `main`. Pages publishes the change within a
minute or two. Before uploading, compare the live copy with the one you started from so newer work is never
overwritten, and check afterward that the live file matches what you uploaded.

Every change runs **Checks** (`.github/workflows/checks.yml`):

1. `tests/check-scripts.js`: every script parses, and no function is defined twice in the same scope.
2. `tests/check-public.py`: nothing private in the page (addresses, invoice numbers, dollar figures, GitHub keys),
   the relay settings are intact and point only at the assessor keys, and the test fixture is made up.
3. `tests/click-through.js`: opens the portal as an assessor and as an administrator (View As), at desktop width in
   light mode and phone width in dark mode, and clicks every menu item, every engagement and every tab. Any script
   error, "NaN" on screen or a page wider than the screen fails the run. Saves are refused, so nothing is written.

To run them yourself: `npm install acorn acorn-walk playwright`, `npx playwright install chromium`, then the three
commands above. A red run means the change needs a look; the page is served whatever the checks say, so fix it promptly.

## Connections

Listed in the MISMO Connections Map (rows owned by "CMS & Assessor Portal"): engagements out to the firms, steps back
to the CMS, the documents flow, availability for the booking pages, and Service Orders reading each firm's finished
reviews for its invoices. If a connection changes, update the map and the CMS Help page (Connections) in the same change.

Questions: certifications@mismo.org.
