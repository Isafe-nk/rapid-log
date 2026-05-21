# Skill: React 19 & TypeScript Code Standards

This skill governs the standards for component structures, state management, and TypeScript patterns in the codebase.

---

## 💻 Tech Stack Guidelines

* **Frontend Framework:** React 19. Utilize standard React hooks (`useState`, `useMemo`, `useEffect`, `useRef`) for component rendering.
* **Compiler & Build:** TypeScript + Vite. Run the local dev server using `npm run dev` (running by default on port `3000`).
* **Icons:** `lucide-react` only. Do not add raw SVGs directly if a corresponding icon exists in Lucide.

---

## 📝 Code Conventions & Cleanliness

1. **Strict TypeScript Typing:**
   * Do not use `any`. Specify interfaces or types for all structures.
   * Add interfaces and component prop types inside `src/types.ts` to keep file architecture clean and maintainable.
2. **Functional Component Architecture:**
   * Favor functional components using standard exports.
   * Group state hooks at the very top of components, followed by `useMemo`, and finally `useEffect` hooks.
3. **No Code Placeholders:**
   * Never write incomplete functions, dummy calculations, or mock comments. All outputs must be fully realized, functional, compile-ready React code.
4. **Tailwind CSS v4 Usage:**
   * Tailwind CSS is integrated directly via Vite (`@tailwindcss/vite`). Use standard inline utility classes for CSS declaration. Avoid creating separate custom classes in CSS unless writing deep layout configurations.
