# Skill: Paper & Typewriter Design Language

This skill defines the premium, minimalist, paper-like design language of the Rapid-Log application. It governs how visual components, colors, spacing, and animations must be crafted.

---

## 🎨 Design Theme & Core Tokens

Always adhere to these styling tokens inside React components and Tailwind CSS rules:

* **Primary Background:** Warm cream white (`#fcfcf9` / `bg-[#fcfcf9]`).
* **Primary Text:** Dark charcoal soft black (`#1a1a1a` / `text-[#1a1a1a]`).
* **Aesthetic Accents:** 
  * Gold/Amber (`text-amber-500`) for high-priority items and special dates.
  * Muted Red (`text-red-500` / `hover:bg-red-50`) for destructive actions.
  * Muted Slate/Gray (`text-neutral-300`, `text-neutral-400`) for headers, secondary tabs, and event markers.
* **Typography:** Strictly monospaced typewriter styling (`font-mono`). Utilize wide tracking (`tracking-widest` or `tracking-[0.2em]`) for uppercase labels, headers, buttons, and status indicators.

---

## 🖼️ Page & Structural Elements

* **Dot Grid Background:** A clean, understated radial dot pattern must cover the viewport background:
  ```html
  <div 
    className="absolute inset-0 pointer-events-none opacity-[0.03]" 
    style={{ 
      backgroundImage: 'radial-gradient(#000 1px, transparent 0)', 
      backgroundSize: '24px 24px' 
    }} 
  />
  ```
* **Borders & Dividers:** Keep dividing lines extremely thin and soft (`border-neutral-50` or `border-neutral-100`) to maintain a clean layout with generous whitespace.
* **Entry Layouts:** Bullet geometry lives in one place — `GLYPH_SHAPE` in
  `src/App.tsx` — and both the composer and the log list read it through
  `glyphStyle()`. Do not restate these numbers as Tailwind classes; the two
  will drift.
  * Tasks: square checkbox, 20px with a 2px border and a 4px radius.
  * Events: **filled dot, 8px, `rgb(23,23,23)`, no border.** Deliberately not an
    outlined circle: at the checkbox's size an outline reads as a control
    waiting to be ticked, and an event bullet is not interactive. Deliberately
    small too — a 16px black circle would instead read as a *completed* task,
    which is 20px and solid in the same column. The size gap is what says
    "a different kind of thing" rather than "the same thing in another state".
  * Notes: left border offset indent bar (`border-l-4 border-neutral-200 pl-6 ml-4`).
  * Priority: lucide `Star`, 14px, filled — `text-amber-500` on a live row and
    `text-neutral-300` on a completed one, which is deliberately faded.
* **Ticking is for tasks.** A task carries the only completion control in the
  app; an event and a note have none, on any surface. Any list that mirrors the
  log — the macOS menu bar popover included — must reserve the tap, the hover
  check and the strikethrough for `type === 'task'`, or it offers a state the
  log cannot show and the user cannot undo.
* **Draw marks, never type them.** Every glyph here was once a text character —
  `○` for events, `*` for priority, `●` in the menu bar. A character's size,
  stroke weight and baseline all come from whichever font resolves it, so none
  of them matched the shapes beside them and all sat off the line. Use a drawn
  shape or an icon component.

---

## 🎬 Fluid Transitions & Motion Rules

Use `motion/react` (Framer Motion v12) to make the interface feel alive:

* **Layout Morphing:** Use `<motion.div layout>` for entries so they slide smoothly when added, sorted, or removed.
* **Animations:** Wrap conditional panels or elements in `<AnimatePresence>` to orchestrate elegant mount/unmount animations:
  ```tsx
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 10 }}
  />
  ```
* **Drag-and-Drop:** Keep interactive task items draggable (using native drag gestures matched with layout spring physics) to allow smooth sorting across different daily lists.
