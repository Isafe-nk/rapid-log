# Entries: what they are, and what happens to them

Written because the app had no spec and three surfaces had each quietly invented
their own answer. This describes what Rapid Log does today, what has been
decided, and the one question still open.

Anything marked **OPEN** is undecided. Do not implement against it.

---

## 1. What an entry is

Three kinds, and the difference is not cosmetic:

| type | what it is | mark |
| --- | --- | --- |
| `task` | something you intend to do | square checkbox, 20px |
| `event` | something that is happening, at a time | filled dot, 8px |
| `note` | something worth remembering | left rail, 2px |

A task is the only one that describes an *intention*. An event describes the
world's schedule and a note describes a thought; neither is yours to finish.
That asymmetry is the whole basis of section 2.

Geometry for all three lives in `GLYPH_SHAPE` (`src/App.tsx`). It is not
restated anywhere — see the design skill.

---

## 2. Completion — DECIDED

**Completion is a property of tasks, and it is a boolean.** Done or not done.
There is no third state.

An event and a note cannot be completed. Not "can be but shouldn't" — the
concept does not apply to them, the way a colour does not apply to a sound.

### What follows from that

- The checkbox is the only completion control in the app, and it appears only
  on a task.
- No surface that mirrors the log may offer completion to another type. The
  macOS menu bar popover did, and wrote `completed: true` onto events that the
  log window then had no way to show or undo.
- The archive may contain a non-task only as **legacy data** — entries completed
  before this was settled. It shows them with their own mark and offers a
  restore, and is the only place a non-task's `completed` flag can be cleared.

### The data does not agree yet

```ts
completed: boolean;   // src/types.ts:7 — on every entry, all three types
```

One flag on all three types. Narrowing it in the schema would be a migration
for no gain, so the flag stays and the **interface** is what enforces the rule.
That is a deliberate choice, and it is why it keeps being broken by accident:
nothing in the types stops a new surface from getting it wrong. Anyone adding a
list of entries should read this section first.

---

## 3. How an entry belongs to a day

```ts
const entryDateOf = (t, today) => parseDate(t.createdAt) ?? today;   // src/App.tsx:245
```

An entry belongs to the day in its `createdAt`, and **`createdAt` is never
rewritten**. An entry is nailed to its date for good.

`createdAt` is doing two jobs at once:

1. **when it was written** — real clock time, if written on the day it belongs to
2. **which day it belongs to** — noon, if written onto another date

Writing onto today stamps the current time. Writing onto any other date stamps
12:00 on that date. One field, two meanings, and nothing distinguishes them
after the fact.

**This is the blocker for section 5.** Any feature that moves an entry to
another day must either rewrite `createdAt` — destroying the record of when it
was actually written — or add a second field. There is no third way.

### The load window

`HISTORY_DAYS = 30` (`src/App.tsx:272`) bounds the live query. Browsing further
back lowers the floor; it never rises, so history you have opened stays loaded.
It is a **loading window, not a retention policy** — nothing is ever deleted by
age, and the privacy policy says so.

---

## 4. What happens when the day ends

Today, the honest answer: **nothing happens to any entry.** At midnight only
the app's idea of "today" moves.

- `todayStart` rolls over on a self-rescheduling timer, so a window left open
  overnight stops reporting yesterday.
- The **menu bar popover empties**. It shows only entries dated today, so at
  midnight yesterday's list is simply gone.
- The **web view does not follow.** `currentDate` is set once at mount and never
  advanced, so an open window keeps showing yesterday's log until you press
  Today.
- Every entry stays exactly where it was. Tasks, events and notes alike.

For an event or a note that is correct and complete. They are records. The day
ending is precisely what they were waiting for, and they should stay on their
date — reachable by navigating back, not by being carried forward.

**For an unfinished task it is not correct.** It is stranded on a day that has
passed, on a page nobody will open again. The only way to carry it forward is
to retype it.

---

## 5. Carrying tasks forward — OPEN

The one real gap. An unfinished task has nowhere to go.

Four answers, in increasing order of how much they change the app:

### A. Nothing — leave it as it is
The log is a faithful record of what you wrote each day, and an unfinished task
is part of that record. You retype what still matters, which is itself a filter.
Costs nothing and is defensible; it just means the app is a log and not a to-do
list.

### B. Show it, don't move it
Today's page grows an "unfinished, earlier" section listing tasks still open
from previous days, each a pointer to where it actually lives. Nothing is
written, no field is added, `createdAt` keeps its one honest meaning. Needs the
query to reach back further than the current view.

### C. Manual migration
The bullet journal's own answer: at the end of a day you review each unfinished
task and explicitly move it forward or drop it. Requires rewriting `createdAt`
or adding a field, plus a review screen. The deliberate friction is the point —
it makes you re-decide rather than accumulate.

### D. Automatic carry-forward
Unfinished tasks appear on today until done. Requires splitting `createdAt`
into *written on* and *belongs to*, because an entry that moves must keep both.
This turns Rapid Log from a log into a to-do list, which is a product decision
and not a technical one.

### What to decide first
Not which of A–D. **Whether `createdAt` is allowed to be two fields.** A and B
need no schema change; C and D both do. That single answer eliminates half the
options, and it is the one question worth settling before any of this is built.

---

## 6. The menu bar popover is a mirror

The popover is a **view of the same log**, not a second app that happens to
show the same data. It may show *less*. It may never show something *different*.

Everything in this section has been got wrong at least once, and each time by
the same route: the popover is written in a different language, in a different
file, by someone reasoning from scratch about what a small list should look
like. It is not a small list. It is this log, small.

### What it must match

| | the log | the popover must |
| --- | --- | --- |
| which entries | the day's entries, by section | same, today only |
| order | timed in clock order, then untimed by creation | same — `byTimeThenCreated`, mirrored in Swift |
| what each type looks like | `GLYPH_SHAPE` | the same marks, in proportion (below) |
| who can be ticked | tasks, §2 | tasks, §2 |
| what priority looks like | a drawn star, amber-500 | a drawn star, amber-500 |
| completion | a property of tasks | never offered to anything else |

### What it may leave out

Editing, deleting, dragging, the context menu, other dates, the archive's full
history. The popover is a glance and a tick. Omission is fine.

### What it may never add

A capability the log does not have — the popover let any row be ticked, which
put events in the archive that the log had no way to get out again.

A *concept* the log does not have is the subtler one. The "to do" badge is the
example: the log has no such counter, so the popover invented what it counts,
and counted events and notes among the things left to do. They can never be
done, so the number could never reach zero.

### Marks, in proportion

The log draws its task checkbox at 20px and every other mark in proportion to
it. The popover's column is 9pt, so each mark is that same proportion of 9:

| | log | popover |
| --- | --- | --- |
| task | 20px square, 2px border | 9pt square, 1.5pt stroke |
| event | 8px filled dot (40%) | 4pt filled dot |
| note | 2x22px vertical rail | 1x10pt vertical rail |

Two floors are deliberate. A stroke or a rail thinner than about a point stops
being visible at this size, so both round up rather than scaling exactly. Note
that down when changing them; it is not drift.

The marks are **drawn, never typed** — the same rule the design skill states,
and for the same reason. A typed `✓`, `★` or `○` takes its size, weight and
baseline from whichever font resolves it, so it never matches the shapes beside
it. Use `Shape` or an SF Symbol.

### Accepted differences

Two, both deliberate:

- **The hover preview.** A popover row has no small hover targets, so the row
  itself is the control and the mark previews the outcome — a green check
  appears before you commit, and a restore arrow on a completed row. The log
  has per-element hover targets and needs none of this.
- **The badges.** "To do" counts open *tasks*, because that is the only thing
  that can be done. "Done" counts everything sitting in the DONE list, which
  may include a legacy event, because the number has to match the rows under
  it.

---

## 7. Where this is enforced

Not in one place, which is the risk:

- `src/types.ts` — the shape, which permits more than the rules allow
- `src/App.tsx` — the log list, the archive, the composer, the context menu
- `macos/RapidLog/MenuBarPopover.swift` — the popover, which has broken the
  rule in section 2 twice
- `.agents/skills/paper-typewriter-design/SKILL.md` — the marks and the rule
  that only tasks are tickable

A new surface that lists entries must honour section 2. Nothing in the code
will stop it from getting this wrong.
