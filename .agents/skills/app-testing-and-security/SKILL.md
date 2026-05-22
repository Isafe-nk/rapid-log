# Skill: App Testing & Security Validation

This skill ensures that all client-side logic behaves correctly and aligns with the security boundaries defined in the backend. Every rule here is backed by the concrete constraints of the local Firestore database rules and application shell.

---

## 🔒 1. Firestore Security Alignment

The database is guarded by strict schema validation in `firestore.rules`. Any code interacting with Firestore *must* align with these rules to prevent database-level rejection:

### Document ID Constraints
* **Validation Rule:** All document IDs must be strictly alphanumeric (plus dashes and underscores) and must not exceed 128 characters.
* **Supported Reason:** Enforced by `isValidId()` in `firestore.rules`:
  ```javascript
  function isValidId(id) { return id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$'); }
  ```

### Todo Schema Validation
When creating or updating entries, frontend code must validate inputs to ensure they match these exact parameters:
* **Max Text Length:** Input text must not exceed 1000 characters.
* **Allowed Types:** `type` must strictly be one of `['task', 'event', 'note']`.
* **Allowed Times:** `timeOfDay` must strictly be one of `['morning', 'noon', 'night']`.
* **Immutable Fields:** The `createdAt` and `userId` fields are immutable on update.
* **Supported Reason:** Any mutation violating these will fail silently or throw a Firestore permission error due to `isValidTodo()` checks.

---

## 🧪 2. Functional & Schema Verification

Before any feature commit, perform these standard validation checks:

### Strict Lint & Type Checking
* **Execution Command:**
  ```bash
  npm run lint
  ```
* **Supported Reason:** Runs `tsc --noEmit` as defined in `package.json` to verify that there are zero TypeScript compile-time errors or type mismatches.

### Production Build Verification
* **Execution Command:**
  ```bash
  npm run build
  ```
* **Supported Reason:** Ensures that the entire React-Vite application compiles into static assets cleanly, catching any path, configuration, or structural anomalies before release.

---

## 🔌 3. Defensive Programming & Error Testing

To guarantee seamless app behavior even under network failure or offline states, ensure defensive design is followed:

* **Optimistic Update Rollbacks:** Always manually test local UI states by verifying that a mock network failure triggers state restoration (rollback) so the user interface never displays incorrect states.
* **Client-side Pre-validation:** Never rely solely on the database for input validation. Always double-check input strings, dates, and times on the client side first, displaying clean error messages directly in the UI to prevent unhandled promise rejections.
