# Skill: Git Branching & Workflow Standards

This skill details the branch naming conventions, workflow steps, and merge guidelines for developing within the Rapid-Log repository.

---

## 🌿 1. Branch Naming Policy

Every isolated task (whether a feature development, a bugfix, or a documentation update) must have its own dedicated branch. Direct commits to main integration branches are strictly prohibited.

Branches must be named using the following prefixes:
* **`feature/<short-description>`**: For new visual features, UI controls, animations, or application additions.
  * *Example:* `feature/add-calendar`, `feature/drag-and-drop`
* **`bugfix/<short-description>`**: For fixing logical errors, crashes, broken UI rendering, or database constraints.
  * *Example:* `bugfix/end-time-display`, `bugfix/safari-height`
* **`docs/<short-description>`**: For structural guides, manual setups, or repository-specific agent rules.
  * *Example:* `docs/branching-standards`, `docs/rules-reference`

---

## 🔄 2. Daily Development Workflow

Follow this step-by-step branching sequence for every code modification:

1. **Pull Latest Changes:** Update your local repository to avoid merge conflicts.
   ```bash
   git checkout feature/dev
   git pull
   ```
2. **Checkout Isolated Branch:** Spawn your dedicated task branch off `feature/dev`.
   ```bash
   git checkout -b <prefix>/<task-name>
   ```
3. **Write & Locally Test Code:** Make all changes on the new task branch.
4. **Compile & Lint Check:** Run local verification checks to confirm no TypeScript, style, or build compilation errors:
   ```bash
   npm run lint && npm run build
   ```
5. **Stage & Commit Work:** Save checkpoints with clear semantic commits.
   ```bash
   git add .
   git commit -m "<type>: <concise description of changes>"
   ```
6. **Merge to Integration Branch:** When the feature is fully complete and verified, checkout `feature/dev` and merge your task branch:
   ```bash
   git checkout feature/dev
   git merge <prefix>/<task-name>
   ```
7. **Safe Branch Deletion:** Once merged, clean up the short-lived local task branch:
   ```bash
   git branch -d <prefix>/<task-name>
   ```
