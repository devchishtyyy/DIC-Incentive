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

### Departments, and the two ways a score is reached

A department is the unit a HOD runs. It decides whose marks apply to you and which column
of the rate table pays you — **Production** or **Support**.

It also decides how your total is reached:

- **Computed** — the seven KPIs added up. Production works this way.
- **Submitted total** — one figure out of 100 per person, typed in on Period Marks.
  Maintenance, Support Production and the support departments work this way; the workbook
  never gives them a KPI breakdown.

Both end at the same `total`, so everything downstream — Earned, sign-off, both exports —
has a single path through it.

This is **not** the Production Areas that Phase 1 removed. An Area grouped Points inside
Production; a Department is an org unit, and sign-off stays one HOD signature per period.

### From a score to rupees

```
Approved = rate table[ site group × rate group × grade band ]
Earned   = Approved × Total ÷ 100,  rounded half-up to whole PKR
```

The rate table is the signed Incentive Revision 2025/2026, versioned and **MD-only**.
So is the grade-band table, and that matters: a pay grade that matches no band **refuses
to pay** rather than guessing. Defaulting to the lowest band underpays, defaulting to the
highest overpays, and either would be invisible — so an unmatched grade is a visible
problem with an obvious fix, adding the code in Settings.

That matching is less trivial than it looks. SuccessFactors returns
`Hourly Worker Level (P3) (GRD.PIII)`, which carries **two codes that disagree**: the
display code is arabic, the `GRD` token is roman, and it is the roman one on the signed
sheet. Reading the display code would have silently mis-banded nine of the forty-two.
`rates.test.ts` pins all ten real grade strings.

**Locking freezes the money.** Rates get revised — the signed sheet is due for renewal in
Dec 2026 — so a locked period stores its figures and the rate version that produced them,
and reads them back verbatim. A later rate edit cannot restate what somebody was already
paid. Reopening discards the snapshot, because a reopened period is live by definition.

The period total is the **sum of the rounded amounts**, not a rounded sum: the payroll
file is the per-person figures, and those are what must add up.

**Not applied:** the probation 50% rule and joiner/leaver proration. Neither has been
confirmed against what payroll does today, and both change what people are paid. The
joining date, leaving date and probation flag are all stored, so adding them later needs
no migration. Both are on the Settings open-questions list.

### The incentive period

**The 16th of one month to the 15th of the next** — not a calendar month. That span is
where the policy's "÷ 26" comes from: 30 or 31 days, Sundays off, 26 working days left.

Periods are generated from a **start day** setting (Settings → Period starts on day,
default 16) rather than maintained by hand, so moving it moves every period together,
keeping their ids and statuses. DIC used the 17th at least once, which is why it is a
setting; 1 turns a period into a calendar month. Days above 28 are refused, because
February cannot honour them.

**Periods open themselves.** On the 16th a new one begins whether or not anybody opened
the app that morning, so the app does not keep a maintained list — it works out which
periods should exist and fills the gaps on load, and again whenever the date changes
under a session left open. A fortnight nobody logged in catches up in one go. Existing
periods are never touched, so a Locked month stays locked, and **each month opened is
written to the audit log** as it happens.

The app opens on the period today falls in, not on a default fixed when the code was
written.

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
| Month end | **Period marks** — the six KPIs that are not production: one set per department (waste, variance, quality, EHS, WCM & 5S), days absent per person, and submitted totals. Attendance and totals are grids like Daily Entry: add people, paste a column, Enter walks down, tick and remove | Office Exec, HOD |
| Month end | **Review & sign-off** — checklist, two sign-offs, both return loops, step history | Office Exec, HOD, Ops |
| Month end | **Export** — the Employee KPI sheet and the Score Card, CSV and XLSX, with a live preview | Finance, Ops |
| Setup | **Targets** — type default targets down the column; the HOD's dated changes with reason and history | HOD and Admin edit, others view |
| Setup | **People** — SAP directory, incentive list with bulk MD approval, departments, points, users, day calendar | Admin, MD |
| Setup | **Audit log** — who, when, what changed, old value, new value, reason, filtered by month | HOD, Ops, Finance, MD, Admin |
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

### Who does what

DIC named four jobs plus a super admin. They cut across the policy's original six roles
rather than matching them, so those are kept in the backend — a stored account on one
still resolves — but nothing in the flow depends on them.

| Role | Does | Who |
|---|---|---|
| **Data Entry** | Daily Output Batches, period marks, attendance, submits the day and the month | Ambreen Nazir, Rehmat Ali Khan |
| **Target Setting** | Default Daily Targets and dated changes | Muhammad Waqar, Muhammad Fozan Shoaib |
| **Review and Approval** | Signs off, approves and locks, reopens, approves people and pay rates | Muhammad Waqar, Muhammad Salman Bari |
| **Viewer** | Reads the scorecard, downloads an approved export | Muhammad Hassaan Shoukat |
| **Super Admin** | Everything, and can view as any other role | 10009671 |

**Roles are a list, not a single value.** Muhammad Waqar sets the targets *and* sits on
review and approval — which also means the targets a month is scored against can be
approved by the person who set them. Worth knowing; the app does not prevent it.

The Operations Manager's approval and the MD's sign-offs are now both **Review and
Approval**, and Finance's export is a **Viewer's**. Two people hold Review and Approval, so
the submit → sign → approve sequence still has two signatures in it — but either of them
can take either step, so one person could do both. Say the word and I will require the
second step to be a different actor.

**Super Admin can view as any role** from the account menu. Only the permission changes:
anything saved is still recorded against their own account, so the audit trail names the
person and never the costume. A banner stays on screen while a role is assumed.

> **Read [SECURITY.md](SECURITY.md) before this handles real pay.** Credentials are kept
> off the browser, passwords are never stored and sign-in is throttled — but the session and
> all state live in `localStorage`, so anyone with devtools can make themselves Super Admin
> and edit anything, the audit log included. Every control here is a guard rail against
> mistakes, not a defence against a determined person. That needs a backend.

### Signing in

Staff sign in with their **SuccessFactors password**. The server posts it to the tenant
with Basic auth and reports back yes or no:

```
POST /api/auth/login  { username, password }
      │
      └─ GET https://api44.sapsf.com/odata/v2/Background_Community?$top=1
         Authorization: Basic <username@packagesli:password>

         200 → valid     401 → wrong      403 → valid, no API permission
```

The **`@packagesli` suffix is added by the server**, not typed: without it SAP answers 401,
and nobody on a factory floor should have to know that. Somebody who types it anyway is
not punished for it.

**The password is never stored.** It lives in a form field until the answer comes back and
in server memory for one request — not in `localStorage`, not in the audit trail, not in
the log. Only a *failed* username is printed to the console, so a locked-out person can be
helped. Verified by grepping the server log after a sign-in.

Three things this deliberately does not do:

- **A 200 that is not OData is not a sign-in.** A captive portal or corporate proxy
  answering 200 with its own login page would otherwise let everybody in.
- **A 403 is not waved through.** Valid credentials with no permission on the check entity
  is a question for IT, not a reason to admit somebody.
- **A verified username does not confer a role.** The check endpoint returns an empty
  result set — it proves *who* somebody is and says nothing about what they may do. The
  role is this app's to decide: the Admin links a SAP username to an account on
  People → Users, one sign-in to one account, and an unlinked sign-in is told so plainly
  rather than given a role by guesswork. (The sign-in username is also a different
  identifier from the Emp ID on the incentive list — `10001234` rather than `4000xxxx` —
  so there is nothing to derive it from.)

Sign-in needs `npm run dev`, for the same reason the roster sync does. The test accounts
remain behind a disclosure on the login screen: there is no other way in until the links
exist, and a demo has to be able to show every role.

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
- `store/periodRoll.test.ts` — the calendar rolling forward: the next period appearing on
  the 16th and not on the 15th, catching up a gap nobody was there for, never touching a
  period that already exists (a Locked month stays locked), and every change carrying the
  month it is *about* rather than the month it was made in — a September row corrected in
  October belongs to September's month-end.
- `domain/exportRows.test.ts` — the two sheets Finance receives: the Employee KPI column
  order from the workbook, the grand total summing the rounded Earned column so the sheet
  adds up to itself, and the rule that a missing figure exports **blank, never 0** — a zero
  in a payroll file is a payment decision, a blank is an admission that nobody supplied it.
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

### Open questions, and what the app does meanwhile

Every one of these is on the Settings screen, showing what is applied today and what the
alternative would be. Where it is a switch, turning it on needs no code change.

**Settled with this build** — the period is the 16th to the 15th with attendance over a
fixed 26; waste and variance round to the nearest table row with ties going to the worse
row; department marks are one value per department per period with per-employee overrides;
"use department average" is a per-employee flag that is off unless set; Earned is rounded
to whole rupees per person.

**Still open**

1. Should a missing day ever count as zero for the Production score, or only through Attendance?
2. Is a plain average across several points correct, or should heavier points count more?
3. Does a HOD target change need Operations Manager approval, or is the HOD's reason enough?
4. Which sites and departments does each HOD cover, and who covers a HOD on leave?
5. How does the 50% overtime provision interact with the Production score?
6. **Are the probation 50% rule and joiner/leaver proration applied today?** And if days
   before joining are also counted in days absent, absence would be charged twice — once
   through `(26 − absent) ÷ 26` on attendance and again through `days employed ÷ 26` on
   Earned. This one needs the Office Executive, not a decision in the app.
7. Is "Support Production" a Production or a Support rate group? It is not named on the
   signed sheet; it is seeded as Production because it works the floor.
