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
* **Entry Layouts:** Bullet styles are specific:
  * Tasks: Elegant square checkboxes (`w-5 h-5 border-2 border-neutral-300 rounded`).
  * Events: Open circle bullet point (`○`).
  * Notes: Left border offset indent bar (`border-l-4 border-neutral-200 pl-6 ml-4`).

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
