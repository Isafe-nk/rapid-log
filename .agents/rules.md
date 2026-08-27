# Rapid Log — Agent Rules

> **Source of truth for AI agents working on this repository.**
> Rapid Log is an **open-source, MIT-licensed** daily logging app. Every change
> is public. Every commit is permanent. Act accordingly.

---

## 1. What This Project Is

A minimalist daily log that fits on one page. Each day is split into Morning,
Noon and Night. Every line is a task, an event or a note. Nothing else.

| Shell      | Stack                                                        |
| ---------- | ------------------------------------------------------------ |
| **Web**    | React 19 + Vite + Tailwind 4 + Framer Motion, on Firebase   |
| **macOS**  | SwiftUI wrapping a `WKWebView`, loads the deployed URL       |
| **iOS**    | Capacitor wrapper around the same web app                    |

There is **no backend server**. The browser talks to Firestore directly.
Security lives entirely in [`firestore.rules`](../firestore.rules).

---

## 2. Open-Source SOP — Hard Rules

These rules are **non-negotiable**. Violating any of them is grounds for
rejecting the entire changeset.

### 2.1 Git Workflow

| Rule | Detail |
| ---- | ------ |
| **Never commit directly** | All changes must go through PR review. AI must never run `git commit`, `git push`, or `git merge` on its own initiative. Produce the code changes and let the human handle git. |
| **Never touch integration branches** | `main` and `feature/dev` are locked. Never commit or push to them directly. |
| **Branch naming** | `feature/<name>`, `bugfix/<name>`, or `docs/<name>` — spawned off `feature/dev`. |
| **Commit messages** | Lowercase, imperative, prefixed. Examples: `fix: stop the log arriving in waves`, `feat: add end-time picker`, `docs: update contributing guide`. Say what changed **and why**. |

### 2.2 Verification Gates

| When | What to run |
| ---- | ----------- |
| **Every change** | `npm run lint` (`tsc --noEmit`) — must pass with **zero errors**. |
| **Structural changes** (imports, exports, build config, new files) | `npm run build` — must complete successfully. |

Run these **before** presenting changes. Do not present code that fails either
check.

### 2.3 Deployment Restrictions

| Command | Policy |
| ------- | ------ |
| `firebase deploy` | **Only when the user explicitly asks.** Never on AI initiative. |
| `npx cap sync` | **Only when the user explicitly asks.** |
| `git push` of a `v*` tag | **Only when the user explicitly asks.** This is a publish, not a push. |
| `gh release create` / editing or deleting release assets | **Only when the user explicitly asks.** |
| Any publish, release, or deploy command | **Only when the user explicitly asks.** |

This is a **live production app** at `to-do-rapidlog.web.app` with real user
data. An accidental deploy pushes broken code to every user.

A `v*` tag is not an ordinary push. It triggers
`.github/workflows/release-macos.yml`, which builds and publishes a GitHub
Release — and because the download redirects to `releases/latest`, that release
becomes the live download immediately, with no deploy step in between. Tagging
is therefore the most consequential command in this repository: it reaches users
faster than `firebase deploy` does.

To build and check a release without publishing anything, run
`scripts/package-macos.sh <version>` locally, or the workflow via
**workflow_dispatch**. Both verify identically and publish nothing.

### 2.4 Dependency Management

**Never add a new npm dependency without explicit user approval.**

Before proposing a new dependency:
1. Explain **why** it is needed.
2. List **alternatives** considered (including doing it without a dependency).
3. Assess the **maintenance and security** implications.

Every new dependency is an attack surface and a maintenance burden in an
open-source project.

---

## 3. Security-Sensitive Files

These files form the **entire security boundary** of the application. There is
no backend server — Firestore rules are the only thing between an attacker and
every user's data.

| File | What it controls |
| ---- | ---------------- |
| [`firestore.rules`](../firestore.rules) | All read/write access control and data validation |
| [`firestore.indexes.json`](../firestore.indexes.json) | Query indexes — removing one silently breaks queries |
| [`firebase-applet-config.json`](../firebase-applet-config.json) | Auth domain, API config — a wrong change silently breaks sign-in |

### Policy

- AI **may** propose changes to these files when a feature requires it.
- AI **must prominently flag** any change to these files with a clear warning so
  the human reviewer does not miss it.
- If a feature adds or removes a field on an entry, the AI **must** update
  `firestore.rules` in the **same changeset** and flag the rules change for
  security review. This is the single easiest thing to forget.

### Schema Sync Checklist

When adding a new field to an entry:
1. Add the field to the `hasOnly` list in `isValidTodo()` in `firestore.rules`.
2. Add a type validation line for the new field (following the existing pattern).
3. Flag the change prominently: *"⚠️ This changeset modifies `firestore.rules`.
   Please review the security implications."*

---

## 4. Architecture Constraints

### 4.1 Single-File Architecture

Nearly all of the web app lives in [`src/App.tsx`](../src/App.tsx). **This is a
deliberate choice, not an oversight** — it is one screen, and splitting it made
it harder to follow, not easier.

**Do not** split `App.tsx` into separate component files without explicit user
approval. Work within the existing structure.

### 4.2 Core Invariants

These behaviors must **never** be broken:

| Invariant | Detail |
| --------- | ------ |
| **Guest mode** | All features must function without sign-in. Entries live in React state only. Nothing leaves the tab. |
| **Auth branching** | `signInWithPopup` for web browsers, `signInWithRedirect` for native wrappers (Capacitor / macOS WKWebView). Never change this logic without understanding why it exists. |
| **Shell compatibility** | Changes must not break WKWebView (macOS) or Capacitor (iOS). Do not use browser APIs unavailable in WebView contexts. |
| **Ownership enforcement** | Every Firestore read/write is scoped to `userId == request.auth.uid`. Never weaken this. |
| **Immutable fields** | `userId` and `createdAt` cannot be changed after creation. This is enforced in `firestore.rules`. |

### 4.3 Native Wrapper Detection

The app detects its runtime environment with:
```typescript
const isNative = () =>
  typeof (window as any).Capacitor !== 'undefined' ||
  (window as any).__MACOS_NATIVE__ === true;
```
Do not alter this detection logic without understanding the auth flow
implications.

---

## 5. Aesthetics & UI Standards

Every UI change must strictly follow these design tokens. Do not introduce new
colors, fonts, or animation libraries.

| Token | Value |
| ----- | ----- |
| **Background** | Warm cream white `bg-[#fcfcf9]` |
| **Text** | Charcoal soft black `text-[#1a1a1a]` |
| **Accent** | Warm amber `text-amber-500` / `text-amber-600` |
| **Danger** | Soft red overlays `hover:bg-red-50` |
| **Typography** | Strict typewriter `font-mono` |
| **Animations** | `motion/react` (Framer Motion) only |
| **Background grid** | Radial dot pattern at `opacity-[0.03]`, `24px` spacing |

### Entry Type Rendering

| Type | Visual |
| ---- | ------ |
| `task` | Square checkbox (`w-5 h-5 border-2 border-neutral-300 rounded`), fills solid black with white checkmark on completion |
| `event` | Open circle bullet (`○`) |
| `note` | Left-border indent (`border-l-4 border-neutral-200 pl-6 ml-4`), italicized `text-neutral-600` |

### Priority

Warm amber asterisk (`*`) next to the entry. Does not reorder — visual flag
only.

---

## 6. Data Model

### Firestore Collection: `todos`

One document per entry. The permitted fields are:

| Field | Type | Required | Mutable | Constraints |
| ----- | ---- | -------- | ------- | ----------- |
| `text` | string | ✓ | ✓ | Max 1000 chars |
| `completed` | boolean | ✓ | ✓ | |
| `type` | string | ✓ | ✓ | `'task'` \| `'event'` \| `'note'` |
| `timeOfDay` | string | ✓ | ✓ | `'morning'` \| `'noon'` \| `'night'` |
| `userId` | string | ✓ | ✗ | Must match `request.auth.uid` |
| `createdAt` | number | ✓ | ✗ | Epoch ms |
| `time` | string | — | ✓ | Optional start time |
| `endTime` | string | — | ✓ | Optional end time |
| `priority` | boolean | — | ✓ | Optional priority flag |

**Document IDs** must be alphanumeric, dashes, or underscores, max 128 chars.

### Time Segments

| Segment | Default Time | Boundary |
| ------- | ------------ | -------- |
| Morning | 9:00 AM | Before 12:00 PM |
| Noon | 12:00 PM | 12:00 PM – 5:00 PM |
| Night | 7:00 PM | After 5:00 PM |

- End time defaults to `+1 hour` from start.
- Start time must fall within the segment boundary.
- Identical or reversed start/end times block submission with an uppercase
  warning.

### Guest Mode Data Flow

1. Entries live in React state only.
2. On sign-in, entries are stashed to `localStorage` (because `signInWithRedirect`
   navigates away and destroys memory).
3. Stash has a 10-minute TTL.
4. Stash is cleared only after the Firestore write succeeds.

---

## 7. Development Reference

### Local Development

```bash
npm install
npm run dev        # Vite on port 3000
```

Runs against the **real Firebase project** — signing in writes to real data.

### Available Scripts

| Script | Command | Purpose |
| ------ | ------- | ------- |
| `dev` | `vite --port=3000 --host=0.0.0.0` | Local dev server |
| `build` | `vite build` | Production build |
| `lint` | `tsc --noEmit` | Type checking (no test suite) |
| `clean` | `rm -rf dist` | Clear build artifacts |

### Deploy (human-initiated only)

```bash
npm run build
npx firebase deploy --only hosting

# Rules and indexes deploy separately:
npx firebase deploy --only firestore:rules
npx firebase deploy --only firestore:indexes
```

This deploys the web app only. The macOS download is a GitHub Release reached
through a redirect in `firebase.json`, so shipping the Mac app needs no deploy —
it needs a tag, which is governed by §2.3.

### Release the macOS app (human-initiated only)

```bash
scripts/package-macos.sh 1.2.0     # build and verify, publishes nothing
git tag -a v1.2.0 -m "..."        # then, only when asked:
git push origin v1.2.0            # this publishes and goes live
```

### Caching

`index.html` is served with `no-cache`; hashed assets with `immutable`. Without
this, a cached `index.html` resolves the previous bundle and the app silently
runs old code after a deploy.

---

## 8. Checklist Before Presenting Changes

Use this checklist before presenting any code change:

- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` passes (if structural change)
- [ ] No new dependencies added without explicit approval
- [ ] No direct commits — changes are presented for PR review
- [ ] If a new entry field was added: `firestore.rules` updated in same changeset
- [ ] If `firestore.rules` was touched: prominently flagged for security review
- [ ] If security-sensitive files were touched: prominently flagged
- [ ] UI changes follow the existing design tokens exactly
- [ ] Single-file architecture preserved (no splitting `App.tsx`)
- [ ] Guest mode still works (no sign-in required for core features)
- [ ] No deploy commands run without explicit user instruction
