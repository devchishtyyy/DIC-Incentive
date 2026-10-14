# Production Incentive App — Phase 1 prototype

DIC Pakistan Limited · Production / Output KPI (20 of the 100 incentive marks) from the
Production Incentive Policy, revision 30 June 2026.

A working front-end prototype, running entirely on dummy data in the browser, that replaces
the current three-sheet Excel process (Production Report → Monthly Prod Score Card →
Employee KPI). There is no backend and no real authentication: the app opens on a login
screen listing one test account per role, and picking one sets the role for the whole app.

```
npm install
npm run dev      # http://localhost:5173
npm test         # 469 tests
npm run build    # static bundle in dist/
```

`dist/` uses relative asset paths and hash routing, so it can be dropped on any static host
or subfolder with no server rewrite rules.

---

## What it does

| Formula | |
|---|---|
| Daily Score | `min(Output Batch ÷ Daily Target × 20, 20)` |
| Employee-day score | plain average of that employee's rows for the date (the Excel's AVERAGEIFS) |
| Monthly Production Score | average of the employee-day scores over days that have a score |

A score never exceeds 20 — 4.75 batches against a target of 4 shows **118.8%** and a score of
**20.00**, never 23.75. A day with no entry is never counted as a zero; absence belongs to
the Attendance KPI in a later phase.

### The incentive period

**The 16th of one month to the 15th of the next** — not a calendar month. That span is
where the policy's "÷ 26" comes from: 30 or 31 days, Sundays off, 26 working days left.

Periods are generated from a **start day** setting (Settings → Period starts on day,
default 16) rather than maintained by hand, so moving it moves every period together,
keeping their ids and statuses. DIC used the 17th at least once, which is why it is a
setting; 1 turns a period into a calendar month. Days above 28 are refused, because
February cannot honour them.

One consequence worth knowing: **26 is a fixed divisor, not a count of the period's
working days.** They agree in most months and part company across February, where
16 Feb – 15 Mar is 28 days and yields 24 Mon–Sat days. Attendance divides by the fixed 26
either way — that is the policy's rule, and `periods.test.ts` pins the difference so it
cannot be "fixed" into something that changes people's pay.

### The nine screens

Navigation is grouped by when you use it, not by what the data is called.

| Group | Screen | Who |
|---|---|---|
| Every day | **Daily Entry** — target and output per employee and point, live %age and Score, inline target editing, bulk add and delete, paste Emp IDs from Excel | Office Exec, HOD |
| Every day | **Scorecard** — the Excel grid: employees down, dates across, Total Avg Score | all |
| Month end | **Period marks** — the six KPIs that are not production: one set per department (waste, variance, quality, EHS, WCM & 5S), days absent per person, and submitted totals | Office Exec, HOD |
| Month end | **Review & sign-off** — checklist, two sign-offs, both return loops, step history | Office Exec, HOD, Ops |
| Month end | **Export** — approved periods only, CSV and XLSX in Employee KPI sheet column order | Finance, Ops |
| Setup | **Targets** — type default targets down the column; the HOD's dated changes with reason and history | HOD and Admin edit, others view |
| Setup | **People** — SAP directory, incentive list with bulk MD approval, points, users, day calendar | Admin, MD |
| Setup | **Audit log** — who, when, what changed, old value, new value, reason | HOD, Ops, Finance, MD, Admin |
| Setup | **Settings** — policy constants, open policy questions, permission matrix | Admin edits, all view |

Opening an employee from the scorecard gives **Employee Detail** — trend chart, every
entry, and the six Phase 2 KPIs as placeholders.

Plus a **Demo Guide** screen that links straight to each of the thirteen seeded scenarios
and the fourteen acceptance tests, so a tester never has to read code to find one.

### The workflow

```
HOD sets the target  →  Office Exec enters batches  →  app scores each row (capped at 20)
                                      ↓  all working days entered
Office Exec submits the month
        ↓                    ↑ returned with a comment
HOD signs off  ──────────────┘
        ↓                    ↑ returned with a comment
Ops Manager approves  ───────┘
        ↓
Month Locked  →  Finance exports        (reopen: Ops Manager or MD, with a reason)
```

Each step is blocked until the one before it is done. The Operations Manager's Approve
button is disabled, with the reason in a tooltip, until the HOD has signed.

---

## How it is built

React 19 · TypeScript · Tailwind CSS 4 · Vite · Vitest. No backend, no UI framework
dependency, and no runtime library for the XLSX export.

```
src/
  config/policy.ts        Every policy constant — cap 20, divisor 26, deadline day 20,
                          outlier thresholds, base incentive rates, open assumptions
  domain/
    types.ts              Entities, shaped as future database tables; IDs, never names
    calc.ts               calcScore · calcEmployeeDay · calcMonthly · validateEntry
    permissions.ts        can(role, action, resource) — the whole matrix, in one place
    dates.ts  format.ts   ISO dates in, dd.mm.yyyy out; rounding only at display time
    exporters.ts          CSV, and a dependency-free Office Open XML writer
  data/
    masters.ts            Areas, points, users, 35 employees — all invented
    seed.ts               The demo dataset, from a fixed seed
  store/
    writes.ts             applyWrite — the ONLY way to change data; emits its own audit rows
    selectors.ts          Every read the screens make
    AppStore.tsx          Context, browser-storage persistence, Reset demo data
  components/  screens/
```

Four rules the code keeps:

1. **The maths lives in one module.** The UI, the export and the tests all call
   `calcScore` / `calcEmployeeDay` / `calcMonthly`. Nothing re-implements them, so the
   Daily Entry, the Scorecard and the Finance export cannot disagree about a number.
2. **Access control lives in one function.** Every screen and every button calls
   `can(role, action, resource)`. A denied decision carries a `reason`, which the UI shows
   as the tooltip on the disabled control — so "why can't I click this?" always has an answer.
3. **Every write goes through `applyWrite`,** which produces the matching audit rows. An
   unaudited edit is impossible by construction.
4. **Policy numbers are never hard-coded.** They sit in `config/policy.ts` and are mirrored,
   editable, on the Settings screen. Base incentive rates are a table because the next
   revision is due Dec 2026 – Jan 2027.

### Validation — the real Excel's mistakes, prevented

Blocks Save: blank point · zero or blank target (division by zero never reaches the
calculation) · negative output · more than 2 decimals.
A row is one employee, on one point, on one day: bulk add skips anything already on the
sheet rather than creating it twice. The duplicate *warning* below still covers duplicates
that arrive another way — a changed point, or a later import.

Blocks Submit until merged or confirmed: possible duplicate row · output above 3× target ·
target below 20% of the point default · a non-working day · an employee still pending MD
approval.

Employees and points are always chosen from a list, never typed, and the Emp ID always
shows beside the name — because the real sheet contains "abid", "Abid " and "ABID", and two
different people both called Tahir.

---

## Where the employees come from

**The app ships with the 42 people DIC supplied, all waiting for MD approval.** They are
there by Emp ID only — the four-digit floor number, which is SAP's `4000xxxx` with the
prefix off. They have **no name** until the first SAP sync, which fills in the real
name, pay grade and joining date by Emp ID — the screens say "Name not synced yet" rather
than inventing one, and Daily Entry offers a **Fetch names from SAP** button while any row
is missing one.

**Two of them — 6290 and 6717 — do not come back from SuccessFactors at all.** They are not
in the active set for the 40000000–40009999 range, so no sync will ever name them. For those,
the Office Executive or the HOD types the name straight into the cell: an **Add name** button
on the Daily Entry row and on People → Incentive list, commit on Enter. A typed name sticks —
`directory.sync` only ever writes into blanks, so the weekly sync cannot overwrite it. Once a
name exists only the Admin may change it, so filling a gap never becomes renaming somebody by
accident. Thirty-five of them came with a Point
assignment; **seven did not** (2902, 2903, 2961, 3054, 3983, 4198 and 9535) and cannot be
posted for until somebody gives them one — People → Incentive list says so on the screen.

Nobody on that list counts for anything until the MD approves them. The MD's view of
People → Incentive list has a tick box per row and an **Approve all 42** button, so that
is one action, not forty-two.

There are two separate things, and keeping them separate is the point:

**The SAP directory** is everyone SuccessFactors knows about. The weekly sync fills it.
Nobody in it is scored or paid anything.

**The incentive list** is who the Production KPI actually applies to. The System Admin
picks people off the directory, which proposes them to the MD; only the MD puts them on
the list (policy section 10). An import can never pay someone nobody approved.

```
SAP  ──weekly sync──▶  Directory  ──Admin picks──▶  Pending MD  ──MD approves──▶  Incentive list
```

### Syncing the directory

**On every app start.** Opening the app pulls the roster from SuccessFactors, so the names,
pay grades and joining dates on screen are the ones SAP holds now. Nobody has to remember
to press anything. The weekly Saturday slot remains as a catch-up for a session left open
for days — a browser has no cron, so the app re-checks every five minutes and syncs when
the scheduled time has passed.

Settings → **Weekly roster sync** shows the schedule, last result and next run, and has a
**Sync now** button. A sync that returns fewer than half the people already on file is
refused as a likely fault rather than applied, and a failure backs off for an hour.

#### Where the credentials live

**On the server. Never in the browser.**

The signing key registered against the OAuth client can mint an assertion for *any* user in
the tenant. A browser cannot keep a secret — anything it holds, its user holds — so the app
is arranged so the browser never has one:

```
Browser                    Dev server (Node)              SuccessFactors
   │                             │                              │
   ├── GET /api/sap/roster ─────▶│                              │
   │                             ├── POST /oauth/idp ──────────▶│  signs a SAML assertion
   │                             │◀─────────────────────────────┤
   │                             ├── POST /oauth/token ────────▶│  assertion → access token
   │                             │◀─────────────────────────────┤
   │                             ├── GET /odata/v2/User ───────▶│  bearer token, __next paged
   │                             │◀─────────────────────────────┤
   │◀── { ok: true, users } ─────┤                              │
```

The browser sends no client ID, holds no bearer token and never sees the key. It asks for a
list of people and gets a list of people. The whole exchange is [server/sapRoster.ts](server/sapRoster.ts),
served by the Vite plugin in [server/sapPlugin.ts](server/sapPlugin.ts); the access token is
cached in Node until it expires, so a restart costs one request rather than three.

Credentials are read from **`SF_*`** environment variables in `.env.local` — deliberately
*not* `VITE_SF_*`, because Vite publishes anything with that prefix into the client bundle.
The config refuses to read a `VITE_SF_` variable and warns on startup if one is still set.

```
SF_API_SERVER=https://api44.sapsf.com
SF_CLIENT_ID=…
SF_COMPANY_ID=…
SF_USER_ID=ECAdmin
SF_PRIVATE_KEY=…
SF_FROM_USER_ID=40000000
SF_TO_USER_ID=40009999
```

`server/sapRoster.test.ts` asserts that nothing under `src/` imports the server module,
touches a key, or reads a `VITE_SF_` variable — so the arrangement cannot quietly rot.

**People → Sync from SAP** is the same fetch run by hand, with the mapping preview: it reads
whatever fields come back, guesses the mapping, and shows every row before anything is
written. The page displays the tenant and Emp ID range but no credential, because it has
none to display.

Because the exchange happens in the dev server, the live sync needs `npm run dev`. A built
copy served off a file share has no server to hold the key, so it offers the file import
instead and says so.

**`self-signed certificate in certificate chain`** means the corporate firewall is
re-signing HTTPS with an internal root CA. Chrome and Postman read the Windows certificate
store; Node does not, so the dev server reads it explicitly and merges it with Node's own
roots — it prints the count on startup. Full explanation and the manual fallback are in
[certs/README.md](certs/README.md).

### What SAP gives us, and what it doesn't

| Our field | Source | |
|---|---|---|
| `empId` | `userId − 40000000` | the 4-digit floor ID, which is what the Employee KPI sheet's "Emp Code" holds |
| `sapUserId` | `userId` | kept alongside so a later sync can match back |
| `name` | `firstName` + `lastName` | ends the "abid / Abid / ABID" problem |
| `joinDate` | `hireDate` | `/Date(…)/`, ISO and plain dates all read |
| `grade` | `payGrade` | shown everywhere a job title would have been |
| `site` | `location` | via a value lookup you confirm |
| `pointIds` | *not in SAP* | joined from the plant assignment list by Emp ID |
| `role` | *not in SAP* | the job title does not reliably say — everyone imports as an **Operator** |
| `status` | *not in SAP* | SuccessFactors has no probation flag; set it in Master Data |

**Production Areas do not exist.** A Point is a work station, an employee works some of
them, and that is the whole structure — there is one HOD and one sign-off.

## The demo data

Generated in code from a fixed seed, so every machine shows the same numbers. **Names and
Emp IDs in the demo roster are invented — no real DIC staff appear in the source.** Today
is pinned to **1 October 2026**.

35 employees · 25 points · ~780 rows in the main 16 Aug – 15 Sep period · four periods,
one in each workflow state:

| Period | Status | What it is for |
|---|---|---|
| 16 Jun – 15 Jul | **Locked** | Finance export, and the reopen path |
| 16 Jul – 15 Aug | **HOD Signed** | the Operations Manager's approval step |
| 16 Aug – 15 Sep | **Submitted** | the main demo; still unsigned, with a returned-then-resubmitted history |
| 16 Sep – 15 Oct | **Open** | fresh entry, with the live warnings |

The app opens on the **Sep–Oct** period, and Daily Entry lands on **1 October** — a sheet
with a row per employee, roughly half the Output Batches already typed and the rest blank
and waiting, so entry can be tested the moment you sign in. The 20 September deadline for
the Aug–Sep period shows as passed; the Sep–Oct one is still ahead. All thirteen seeded scenarios from the brief — the perfect scorer, the duplicate, the
target-1 / output-19 outlier, the blank point, the missing day, the stock-taking target
change, the pending MD approval — are reachable from the **Demo Guide** screen.

**Reset demo data** in the header rebuilds everything from the seed.

---

## Tests

`npm test` — 469 tests, sixteen files:

- `domain/calc.test.ts` — acceptance tests 1–6 and 14, the cap, fractional batches, the
  missing-day rule, and both switchable assumptions.
- `domain/permissions.test.ts` — acceptance tests 7, 9 and 10: the Office Exec blocked
  from targets, Ops blocked before the HOD signs, and a locked month.
- `store/directory.test.ts` — the separation that matters: a sync fills the directory and
  never the incentive list, the Admin can only *propose*, and somebody already being
  scored survives dropping out of the next SAP filter.
- `components/BulkSelect.test.ts` — the shared selection rules, including the one that
  counts: a bulk action can never reach a row the user was not offered.
- `data/seed.test.ts` — proves each of the thirteen scenarios is really in the data, and
  acceptance test 12 (the scorecard total equals the Excel method).
- `domain/exporters.test.ts` — takes the generated .xlsx apart again: walks the ZIP
  central directory, follows every offset and re-checks every CRC, then reads the sheet
  XML back to confirm cell references, number vs text typing and XML escaping.
- `screens/today.test.ts` — proves Daily Entry opens on a sheet that can actually be
  typed into: today is a working day in the Open period, most of the line already has a
  Draft row, and a share of them are blank and waiting.
- `store/bulkadd.test.ts` — the usual-point lookup that pre-fills the bulk Add rows
  dialog, and the single write that creates the batch and audits every row in it.
- `domain/syncSchedule.test.ts` — the weekly sync: when the next Saturday slot falls,
  catching up a slot missed because nobody opened the app, backing off after a failure,
  and refusing a sync that would wipe half the roster.
- `server/sapRoster.test.ts` — the SuccessFactors flow, server side: that nothing under
  `src/` can import it, touch a key or read a `VITE_SF_` variable; that `token_url` names
  the tenant and not this server (an assertion that does not is rejected with no clue why);
  following OData's `__next` across pages, which is what otherwise caps a roster at exactly
  1000 people; caching the access token between syncs; and keeping multi-kilobyte bodies
  whole, since a truncated assertion fails for reasons nobody can see.
- `data/sapImport.test.ts` — the SAP SuccessFactors import against the shapes the OData
  `User` entity really returns: the `{d:{results}}` envelope, `/Date(…)/` timestamps,
  partial records, duplicate Emp IDs, and every unresolved lookup surfaced rather than
  guessed.
- `domain/kpiTables.test.ts` — the waste and variance tables: every row, both sides of
  every rounding tie (ties go to the *worse* row, worth 2.5 marks on waste), monotonicity
  across the whole range, attendance at 0, 2 and 26+ days absent, and the brief's worked
  total of 97.426224.
- `store/periodKpis.test.ts` — assembling one employee's seven KPIs: department marks
  reaching everyone, a per-employee override replacing one of them, and the case that
  matters most — somebody with no production rows and no flag **blocks** sign-off rather
  than quietly taking the department average, so a month of forgotten entries cannot pay
  out as a normal one.
- `domain/periods.test.ts` — the 16th-to-15th period: bounds across month ends, February
  and a leap February, the new year, every day of a year landing in exactly one period,
  no gap or overlap at any start day, restating periods when the setting moves, and the
  one place the fixed 26 stops matching the real working-day count.
- `domain/departmentAverage.test.ts` — the department average ignoring unmeasured
  employees rather than counting them as zero (the difference between 15 and 7.5), and the
  under-target warning firing on a mistyped target but not on a merely bad day.
- `domain/gridNav.test.ts` — the Excel-style column walk: Enter down, Shift+Enter up,
  stopping at both ends, skipping read-only rows, and landing somewhere sensible when the
  focused row is deleted underneath you.
- `store/dedupe.test.ts` — bulk add never repeats a row that is already on the sheet
  (same employee, same point, same day), de-duplicates within the batch itself, and still
  allows a genuine second point or another day; plus batch delete and its audit rows.
- `screens/screens.render.test.tsx` — every screen rendered for every role and every
  period: 169 combinations, none producing a NaN or an Infinity, plus the login screen.

---

## Out of scope for Phase 1

Attendance, Quality, EHS, Variance, Wastage and 5S/WCM marks appear only as greyed
placeholders with their weights. SAP Analyst, Maintenance, Technical, Store, Dispatch and
Inplant KPIs are not built. There is no real login, database, payroll integration or rupee
calculation.

The data model does not block any of them: joining and leaving dates, the probation flag,
grades, sites and the configurable base-rate table are all stored and displayed, they are
simply not used in a Phase 1 calculation.

### Questions for DIC, carried from the brief

1. Should a missing day ever count as zero for the Production score, or only through Attendance?
2. Is a plain average across several points correct, or should heavier points count more?
3. Does a HOD target change need Operations Manager approval, or is the HOD's reason enough?
4. ~~Is the incentive period always the 17th to the 15th, or does it move?~~ **Settled: the 16th to the 15th.** The start day is a setting, so it can move again without a code change.
5. Which sites and areas does each HOD cover, and who covers a HOD on leave?
6. How does the 50% overtime provision interact with the Production score before Phase 3?

Questions 1 to 3 are live switches on the Settings screen — the app applies the default and
the alternative can be turned on without a code change.
