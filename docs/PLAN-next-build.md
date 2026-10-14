# Next build — plan

Written for: whoever picks this up, including me after a break. Read with the brief open.

Phase 1 stays as it is. This plan says, per milestone, what gets built, which files move, and
what it costs. Collisions with Phase 1 are in section C — two were named in the brief, four
more I found while reading, and three of those need a decision before the milestone they sit in.

---

## A. What I read, and what it means

| Read | Bearing on this build |
|---|---|
| `src/domain/calc.ts` | The only maths. Returns `null`, never NaN. Section 3.2 is already here and correct. Every new calculation joins this file. |
| `src/domain/permissions.ts` | `can(role, action, resource)`. ~24 actions, matrix from brief section 3. New actions go in the same switch. |
| `src/store/writes.ts` | `applyWrite(state, op, ctx)`, ~32 ops, each emitting its own audit rows. Every new write is an op here. |
| `src/domain/types.ts` | The data model. **No department concept at all** — see C1. |
| `src/config/policy.ts` | Constants and `ASSUMPTIONS` (3 open questions). Holds a rate table already — wrong shape, see C4. |
| `src/data/seed.ts` | `PERIODS` is a hand-written list of four. Already date-ranged. |
| `README.md` | Accurate as of the last commit. |

### The good news on periods

The brief's first known collision mostly **does not exist**. `MonthPeriod` already carries
explicit `startDate` and `endDate`, every selector works off `dateRange(start, end)`, and
nothing anywhere derives a period from a calendar month — the only `getMonth()` in the
codebase is in `formatDateTime`. Three of the four seeded periods are already 16th→15th.

So M1's period work is smaller than the brief assumes: a setting, a generator, and fixing one
inconsistent seeded period. Details in C2.

---

## B. Milestones

### M1 — Period

**Build**
- `periodStartDay` in `AppSettings`, default 16. Settings screen, Admin-editable.
- `periodsFor(year, startDay)` in a new `src/domain/periods.ts` — generates periods instead of
  the hand-written list, so changing the setting changes every period consistently.
- `departmentAverage(scores)` in `calc.ts`: mean of measured employees' period scores.
- `UNDER_TARGET_TYPO` validation issue — warns, never blocks, when output < 10% of target.

**Files**
`src/domain/periods.ts` (new, + test) · `src/domain/calc.ts` · `src/config/policy.ts` ·
`src/data/seed.ts` · `src/screens/Settings.tsx` · `src/screens/DailyEntry.tsx`

**Verify** — a period spanning a month boundary scores correctly; department average is the
mean of measured employees' period scores; **every Phase 1 production test still passes
unchanged**, which is the real check that 3.2 was untouched.

---

### M2 — Department marks, attendance, people without output

The biggest milestone. Three independent features that share one new entity.

**Build — department marks**
- `Department` entity (C1) and `DepartmentMarks` — one row per department per period.
- In `calc.ts`, as pure table lookups on **integer hundredths** per invariant 6:
  - `wasteMarks(pctHundredths)` — ≤280 → 15; 290 → 12.5; 300 → 10; 310 → 7.5; ≥320 → 5
  - `varianceMarks(pctHundredths)` — ≤500 → 10, −1.5 per 0.5 above, ≥850 → 0
  - `roundToTableRow(hundredths, step)` — ties to the **worse** row. 283 → 280 → 15.
- Quality / EHS / WCM&5S entered as marks directly.
- `KpiOverride` per employee per period per KPI, mandatory reason, audited.

**Build — attendance**
- `AttendanceRecord` per employee per period: `daysAbsent`.
- `attendanceMarks(daysAbsent, divisor)` = `max(0, (26 − absent) ÷ 26 × 10)`.
- Blank blocks submission; **0 is a valid entry**, so the type is `number | null` and the two
  are never conflated.
- Entry grid with paste-a-column and Enter-walks-down (invariant 5), reusing
  `pasteEmpIds.ts` and `gridNav.ts` as they are.

**Build — people without output**
- `outputNotMeasured` flag on `Employee`. Off unless set, never inferred.
- Flagged + no rows → department average. Unflagged + no rows → **blocks submission**.

**Files**
`src/domain/types.ts` · `src/domain/calc.ts` · `src/store/writes.ts` ·
`src/domain/permissions.ts` · `src/screens/DepartmentMarks.tsx` (new) ·
`src/screens/Attendance.tsx` (new) · `src/screens/People.tsx` · `src/store/selectors.ts` ·
`src/components/Layout.tsx`

**Verify** — every waste and variance row **and both sides of each rounding tie**; attendance at
0, 2 and 26+ days absent (26+ must floor at 0, not go negative); flagged employee gets the
department average; unflagged employee with no rows blocks submission.

---

### M3 — Departments that submit a total score

**Build**
- `scoringMode: 'computed' | 'submittedTotal'` on `Department`.
- `SubmittedTotal` per employee per period, one value out of 100.
- Both modes converge on one `periodTotal(empId, periodId)` selector, so M4 and M5 never
  branch on department type.

**Files**
`src/domain/types.ts` · `src/store/selectors.ts` · `src/store/writes.ts` ·
`src/screens/SubmittedTotals.tsx` (new) · `src/screens/MonthEndReview.tsx`

**Verify** — a submitted-total department reaches Earned without touching production maths; a
computed department is unchanged by M3 existing.

---

### M4 — Money

**Build**
- `RateTable` — versioned, MD-only. Section 5's 2 site groups × 2 rate groups × 3 bands.
- `GradeAlias` — MD-only, seeded per section 5, **matched per C5**.
- `approvedFor(employee, rateTable)` → site group × rate group × band. Per-employee override
  with mandatory reason, audited.
- `earned(approved, total)` = `approved × total ÷ 100`, **rounded half-up to whole PKR**.
  Period total = sum of the *rounded* amounts, not the rounded sum.
- ~~Probation × 0.5~~ — **not built.** See D1.
- ~~Joiner/leaver proration~~ — **not built.** See D2.
- Lock freezes scores, approved amounts and rate version — a `PeriodSnapshot` written on lock.
  A later rate edit must never change a locked period, which needs its own test.

**Files**
`src/config/policy.ts` · `src/domain/rates.ts` (new, + test) · `src/domain/calc.ts` ·
`src/domain/types.ts` · `src/store/writes.ts` · `src/screens/Settings.tsx` ·
`src/screens/MonthEndReview.tsx`

**Verify** — the brief's worked example to the rupee:

```
Employee 1295, TE2 → B3, Kasur, Production
  Production  19.695455
  Waste       15
  Variance    10
  Quality     15
  EHS         15
  WCM         13.5
  Attendance   9.230769   (26 − 2) ÷ 26 × 10
  Total       97.426224
  Approved    24,750      Kasur · Production · B3
  Earned      24,112.99 → PKR 24,113
```

This becomes a test, not a manual check. **It is also the acceptance test for C5** — 1295's real
SAP grade string is `Technical Executive Level (TE2) (GRD.TE.2)`, so if the alias matching is
wrong, this example fails and says so.

---

### M5 — Export

**Build**
- Employee KPI export: section 3.3's columns in order, plus a grand total row.
- Score Card export: employee × working-day matrix, period average column, department average row.
- Both through the existing `exporters.ts` (CSV + the dependency-free XLSX writer).
- Both read the same selectors as the screens — invariant 1.

**Files** `src/domain/exporters.ts` · `src/screens/ExportScreen.tsx`

**Verify** — export matches the scorecard row for row; the grand total equals the sum of the
rounded Earned column.

---

### M6 — Wrap-up

README (screens, period rule, department marks), section 8's six decisions onto the Settings
open-questions list, final summary.

---

## C. Collisions

### C1 — Departments reintroduce a grouping that was deliberately removed ⚠️ **decide**

Phase 1 had Production Areas. They were **removed at your explicit instruction** ("get rid of
areas all together"), which rippled through `can()`, HOD sign-off (per-area → single), the
scorecard and the seed.

This brief needs departments: one set of marks per department per period (M2), a scoring mode
per department (M3), a department average (3.2).

I read these as **different things** — an Area grouped Points inside Production; a Department is
an org unit (Production, Maintenance, Support Production) that also sets the rate group. So I
plan to add `Department` as a new entity and **not** revive areas.

What I will **not** do without you saying so: make sign-off per-department again. Phase 1 has a
single HOD sign-off per period and the brief doesn't ask for that to change.

**DECIDED (asked, 14 Oct 2026):** Department added as a new entity, Production Areas stay
dead, HOD sign-off stays single per period.

### C2 — Period: smaller than the brief expects, with one real bug

Already date-ranged (see A). What actually needs doing:
- `periodStartDay` setting, default 16.
- Generate periods from it instead of the hand-written list.
- **Seeded period `2026-08` starts on the 17th** (`2026-08-17`), not the 16th. That is the old
  open question 4 showing up as data. The brief settles it at 16, so this is a straight fix —
  it shortens that period by a day and will shift its scores. Expected, and called out here so
  it isn't mistaken for a regression.

### C3 — Missing target already blocks

The brief's second known collision is **already satisfied**. `TARGET_INVALID` is severity
`error` with `blocks: 'save'`, which is stricter than the brief's "blocks submission". No change.
Flagging it so nobody "fixes" it into something weaker.

### C4 — The existing rate table is the wrong shape

`BASE_INCENTIVE_RATES` in `policy.ts` has site group × band — **no Production/Support rate group**,
which section 5 requires. Values for Kasur and Non-Kasur match the brief exactly, so this is a
widening, not a correction. It is marked "held for Phase 3" and used in no calculation, so
reshaping it is safe. Moving to M4's versioned `RateTable`.

### C5 — The grade alias list won't match the real data ⚠️ **decide**

The brief seeds aliases as short codes (`TE2`, `PIII`, `II`). SAP returns long strings. These
are the **actual grades of the 42**, from the live sync:

| Count | Real SAP `payGrade` | `GRD` token | Band |
|---|---|---|---|
| 11 | `Hourly Worker Level (P) (GRD.P)` | `P` | B2 |
| 9 | `Hourly Worker Level (P3) (GRD.PIII)` | `PIII` | B2 |
| 7 | `Hourly Worker Level (P2) (GRD.PII)` | `PII` | B2 |
| 3 | `Jr. Technical Executive Lvl(TE) (GRD.TE)` | `TE` | B3 |
| 3 | `Technical Executive Level (TE3) (GRD.TE.3)` | `TE.3` | B3 |
| 2 | `Jr. Technical Executive Lvl(TE1) (GRD.TE.1)` | `TE.1` | B3 |
| 2 | `Technical Executive Level (TE2) (GRD.TE.2)` | `TE.2` | B3 |
| 1 | `Technical Executive Level (TE4) (GRD.TE.4)` | `TE.4` | B3 |
| 1 | `Worker Level (2) (GRD.II)` | `II` | B1 |
| 1 | `Worker Level (5) (GRD.V)` | `V` | B2 |

Note the trap: the **parenthesised code and the `GRD` token disagree**. `(P3)` is arabic,
`GRD.PIII` is roman — and `P3` is *not* in the brief's alias list while `PIII` is. Matching on
the display code would silently fail for 9 people; matching on the `GRD` token resolves all ten
grades against the brief's list.

**Plan:** match the `GRD.*` token first, normalise `TE.2` → `TE2`, fall back to the
parenthesised code, then the raw string. **Anything unmatched is a visible "band not set"
that blocks the money calculation — never a default band**, per invariant 2. The MD-editable
alias table is then the fix for a grade nobody anticipated.

**Proceeding on that reading.** The risk if I'm wrong is paying 9 people at the wrong band.

### C6 — `GRADES` in `masters.ts` contradicts section 5

An invented demo table (`Grade A`→1, `P2`→3, `P3`→3). Section 5 puts P–PIII in **B2**, so the
existing `bandForGrade` is simply wrong against the signed sheet. It is used only by the demo
and a dropdown. Replacing it with the alias table in M4; deleting `bandForGrade`.

---

## D. Pay adjustments — asked and answered

**DECIDED (asked, 14 Oct 2026): neither is built.** Nobody has yet confirmed against the
Office Executive whether they are applied today, and both change what people are paid.

- **D1 — Probation × 0.5.** Not applied. The `Probation` employee status stays stored and
  displayed, as it has been since Phase 1, and feeds no calculation.
- **D2 — Joiner/leaver proration.** Not applied. Earned is `Approved × Total ÷ 100` for
  everyone, whatever their joining or leaving date.

Both go onto the Settings open-questions list in M6, with D2 carrying the double-counting
trap written out, so whoever answers it sees the consequence. Neither needs a migration to
add later: joining date, leaving date and the probation flag are all already stored.

**M4 therefore has no blocking questions.**

---

## E. Order of work, and why

M1 → M2 → M3 → M4 → M5 → M6, as the brief has it. M2 is the one to split if anything slips:
department marks, attendance and the unmeasured-employee flag are independent and each has its
own tests.

Each milestone ends with tests + typecheck + build clean, README updated, one commit.

**Repo note:** this directory is not a git repository (no `.git`, though `.gitignore` exists
and correctly ignores `.env.local` and `*.key`). I'll `git init` and make an initial commit of
the Phase 1 state before M1, so each milestone commit is a readable diff. Local only — nothing
pushed anywhere.
