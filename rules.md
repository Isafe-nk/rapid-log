# Rapid-Log: Core Features, Architecture & Security Rules

This document serves as the absolute source of truth for the **Rapid-Log** application. It specifies all existing features, data structures, client rules, and security configurations. Every rule detailed below is strictly backed by the code implemented in the repository.

---

## 📖 1. Core Feature Specification

### A. Authentication & Wrapper Redirection
* **Technology:** Firebase Auth (Google Sign-In as primary provider).
* **Wrapper Detection:** The app detects if it runs in a standard browser or inside a native mobile/desktop wrapper shell (Capacitor iOS or macOS WKWebView):
  ```typescript
  const isNative = () => typeof (window as any).Capacitor !== 'undefined' || (window as any).__MACOS_NATIVE__ === true;
  ```
* **Auth Redirection Flow:**
  * **Web Browsers:** Launches `signInWithPopup` for a seamless popup login overlay.
  * **Native Wrappers:** Fallbacks to `signInWithRedirect`. Upon startup, the app executes `handleRedirectResult()` to extract credentials from WKWebView callback payloads.
* **Header Profile:** Displays user's Google profile image (with a clean fallback `<User />` icon) and a minimalist "Logout" action.

### B. Minimalist Entry Management
Entries are categorized into three distinct types:
1. **`task`**: Represents standard checkable items. Rendered with an elegant square checkbox border (`w-5 h-5 border-2 border-neutral-300 rounded`) that fills solid black with a white checkmark on completion.
2. **`event`**: Represented by a minimalist open circle bullet (`○`).
3. **`note`**: Informational items with a Left-border offset indent structure (`border-l-4 border-neutral-200 pl-6 ml-4`) and italicized neutral-600 text formatting.

* **Priority Flag (`*`):** Users can tag any task or event as high-priority, which renders a warm amber asterisk next to it.
* **Archive Drawer:** Completed tasks are dynamically moved out of daily task segments and stored in an collapsible "Archive" segment at the bottom, showcasing strike-through styling and historical timestamps.

### C. Daily Timeline Structure
Daily entries are organized into three distinct chronological segments:
* **Morning (`morning`):** Defaults to 9:00 AM (applies to items before 12:00 PM).
* **Noon (`noon`):** Defaults to 12:00 PM (applies to items between 12:00 PM and 5:00 PM).
* **Night (`night`):** Defaults to 7:00 PM (applies to items after 5:00 PM).

* **Time Configuration Constraints:**
  * Users can optionally specify start and end times (`+ time`).
  * End times automatically default to `+1 hour` relative to start times upon adjustment.
  * If a user sets custom times, the app performs strict validation to check that the start time falls within the boundaries of the selected segment (e.g. Morning entries cannot be set after 12:00 PM).
  * If start and end times are identical, or if end time precedes start time, UI submission is blocked and a clean, uppercase warning is displayed.

### D. Drag & Drop Reordering
* Draggable entries (those without strict fixed times) can be dragged across lists.
* Hovering a draggable item over a different daily timeline segment triggers a dashed drop container overlay (`outline-dashed outline-2 outline-neutral-200`).
* Dropping an item triggers a Firestore document update (`timeOfDay` = target slot) and leverages Framer Motion (`motion/react`) for transition animations.

### E. Date Navigation & Calendar
* Visual Calendar overlay to view logs on past or future dates.
* **Aesthetics:** Shows active date in solid black. Today's actual date is highlighted in bold amber (`text-amber-600 font-black`), while dates outside the active month are visually muted.
* **Snap-back Trigger:** If the active calendar view is set to a past or future date, a visual reset arrow (`RotateCcw`) appears in the header, letting the user snap instantly back to the current day.

---

## 🎨 2. Aesthetics & UI Standards

Every UI adjustment must respect this exact minimalist layout grid:
* **Background:** Rich Warm Cream White (`bg-[#fcfcf9]`).
* **Text:** Charcoal Soft Black (`text-[#1a1a1a]`).
* **Accent Colors:** Warm Amber (`text-amber-500` / `text-amber-600`) and soft red overlays for deletions (`hover:bg-red-50`).
* **Typography:** Strict typewriter typography using `font-mono`.
* **Understated Background Grid:** A very light, transparent radial dot pattern on the viewport:
  ```html
  <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '24px 24px' }} />
  ```
* **Transitions:** Micro-animations powered strictly by `motion/react`.

---

## 🔒 3. Strict Database Schema & Security Rules

All operations targeting Cloud Firestore must strictly adhere to `/Users/limky/Downloads/rapid-log/firestore.rules`. Any query or mutation violating these conditions will fail:

### A. Document Rules
* **Authentication Requirement:** All read, list, create, update, and delete calls require a verified session (`request.auth != null`).
* **Ownership Limitation:** Users can only view, fetch, edit, or delete items where `userId == request.auth.uid`.
* **Safe ID Format:** Document IDs (`todoId`) must strictly consist of alphanumeric characters, dashes, or underscores, and cannot exceed 128 characters:
  ```javascript
  id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')
  ```

### B. Data Properties Validation
When adding or updating records, the document body must strictly match these constraints:
* **Field Limits:** The document cannot contain more than 9 total keys.
* **Mandatory Keys:** Must contain `['text', 'completed', 'type', 'timeOfDay', 'userId', 'createdAt']`.
* **Property Size & Type Specifications:**
  * `text`: Must be a string with a maximum length of 1000 characters.
  * `completed`: Must be a boolean value.
  * `type`: Must strictly belong to `['task', 'event', 'note']`.
  * `timeOfDay`: Must strictly belong to `['morning', 'noon', 'night']`.
  * `createdAt`: Must be a numerical timestamp and is immutable after creation.
  * `userId`: Must match the authenticated user's UID and is immutable after creation.
  * `time`, `endTime`, `priority`: Optional properties, but if provided, must match their corresponding types (`string` or `bool`).

---

## 🛠️ 4. Local Development & CI Checks

Before submitting pull requests or making updates on `feature/dev`, always run these verify scripts locally:

1. **Lint and Type Checking:**
   ```bash
   npm run lint
   ```
   *(Executes `tsc --noEmit` to verify type safety).*
2. **Build Integrity Check:**
   ```bash
   npm run build
   ```
   *(Compiles static assets to ensure code compilation succeeds).*
