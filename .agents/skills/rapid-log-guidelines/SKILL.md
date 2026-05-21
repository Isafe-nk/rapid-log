# Skill: Rapid-Log Development Standards

This skill guides the agent on how to write high-quality, project-aligned code for the **Rapid-Log** application. It establishes strict rules for the technology stack, minimalist design principles, and Firebase/Capacitor integration guidelines.

---

## 🚀 Core Technology Stack

When writing or modifying code in this repository, always align with these technologies:
* **Framework:** React 19 (Functional components, hooks, strict TypeScript).
* **Build System:** Vite + TypeScript (running dev server on port 3000).
* **Styling:** Tailwind CSS v4 (`@import "tailwindcss";` in `src/index.css` via `@tailwindcss/vite` plugin).
* **Icons:** Lucide React (`lucide-react`).
* **Animations:** Framer Motion v12 (`motion/react` package - animate transitions, drag gestures, layout shifts).
* **Database & Auth:** Firebase v12 (Firestore listeners using `onSnapshot`, Google Auth with Capacitor redirection fallback).
* **Mobile/Desktop Wrappers:** Capacitor v8 (handles native App shell on iOS/macOS).

---

## 🎨 Visual System & Design Aesthetics

The Rapid-Log app uses a highly curated, premium **minimalist, paper-like, typewriter-inspired aesthetic**. Any new features or UI redesigns must adhere strictly to these principles:

### 1. Color Palette & Typography
* **Primary Background:** `#fcfcf9` (warm, soft paper-like cream white).
* **Primary Text:** `#1a1a1a` (soft black/dark charcoal, avoids harsh `#000`).
* **Accents:** Neutral colors, subtle ambers (`text-amber-500` for priorities/today), clean reds (`text-red-500` for destructive actions).
* **Font:** `font-mono` (monospaced typewriter font, e.g. SF Mono, JetBrains Mono, Courier).

### 2. Micro-Animations & Fluidity
* Use `motion/react` for elegant, fluid transitions.
* **Layout Animations:** Use `<motion.div layout>` and `<AnimatePresence>` for items that animate dynamically when added, deleted, or dragged.
* **Drag-and-Drop:** Keep elements draggable and drop-friendly (e.g. dragging entries into different times of day).

### 3. Structural Patterns
* **Grid Pattern:** A subtle dot grid background on the page (`bg-[radial-gradient(#000_1px,transparent_0)] bg-[size:24px_24px] opacity-[0.03]`).
* **Borders:** Thin, light borders (`border-neutral-100` or `border-neutral-50`) to keep the interface feeling spacious and lightweight.
* **Capitalization:** Use uppercase tracking (`tracking-widest`, `tracking-[0.2em]`) for labels, headers, and tabs.

---

## 📂 Project Directory Structure

Ensure code files remain structured as follows:
* `src/types.ts`: Keep all global type definitions here (e.g., `Todo`, `EntryType`, `TimeOfDay`).
* `src/lib/firebase.ts`: Holds Firebase App initialization, DB refs, Auth providers, and wrapper-safe native redirections.
* `src/App.tsx`: The main visual entry point, coordinate layouts and client state.
* `.agents/skills/rapid-log-guidelines/`: This guidelines folder.

---

## 📝 Coding & Architecture Rules

1. **Strict TypeScript:** Always type functional component props, states, and function arguments. Avoid `any` unless absolutely necessary for Capacitor native globals.
2. **Optimistic UI Updates:** Maintain a snappy UI by updating local React state instantly before writing changes to Firestore, with rollbacks in `catch` blocks.
3. **Redirection Handling:** Always maintain WKWebView/Capacitor-friendly auth code (e.g., using `handleRedirectResult()` check on window/Capacitor presence).
4. **No Placeholders:** Never output simple TODO comments or fake mock data in code files. Write completely production-ready, functional code.
5. **V4 Tailwind Conventions:** Tailwind CSS v4 is compiled via Vite. Do not add Tailwind CSS utility classes inside custom CSS classes unless necessary; favor using raw utility classes inline or standard CSS variables in `index.css`.
