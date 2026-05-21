# Skill: Firebase Data Layer Guidelines

This skill governs Firestore connections, security boundaries, user state listening, and client-database synchronization guidelines.

---

## 💾 Core Firebase Stack

* **Database:** Cloud Firestore.
* **Authentication:** Firebase Auth (Google Sign-In as primary provider).
* **Library Integration:** SDK v12 modules (`collection`, `doc`, `addDoc`, `updateDoc`, `deleteDoc`, `onSnapshot`, `query`, `where`).

---

## ⚡ Optimistic UI Rendering

To keep the application feeling instantaneous and premium, always prioritize **Optimistic Updates**:

1. **State Injection:** For user actions (like toggling a checkbox completed state or deleting an entry), modify the local React state *immediately* before starting the asynchronous database call.
2. **Error Recovery:** Always wrap asynchronous Firestore operations in `try-catch` blocks. If an update fails, restore the local state to its previous version inside the `catch` block to avoid UI mismatches:
   ```tsx
   const previousTodos = todos;
   // 1. Update state optimistically
   setTodos(prev => prev.filter(t => t.id !== id));
   try {
     // 2. Call DB
     await deleteDoc(doc(db, 'todos', id));
   } catch (error) {
     console.error("Firestore error:", error);
     // 3. Rollback on failure
     setTodos(previousTodos);
   }
   ```

---

## 🔄 Real-time Listeners & Auth State

* **Active Listening:** Hook up listeners using `onSnapshot` inside `useEffect` blocks to sync local components with Cloud Firestore real-time updates.
* **Auth Listeners:** Bind auth updates cleanly using `onAuthStateChanged`. When a user logs out, instantly wipe existing memory-cached items to secure private data.
