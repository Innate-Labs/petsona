# Pet Window Display Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the `petsona-main` desktop pet window to the working `demo_v0.1` display logic while preserving the current Petsona shell behaviors.

**Architecture:** Keep the current Petsona pet-window event handling, reminder bubble, and shell commands, but swap the render layer in `apps/shell/ui/pet/PetWindow.tsx` from `Sprite` to `PetVideoLayer`. Repair pet animation asset imports so both the migrated pet window and the existing shell pet view compile against the current `final-pet-alpha` asset directory.

**Tech Stack:** React, TypeScript, Vite, Vitest, Tauri shell UI

---

### Task 1: Lock the target renderer with failing tests

**Files:**
- Modify: `tests/unit/pet.window.behavior.test.ts`
- Test: `tests/unit/pet.window.behavior.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('renders the desktop pet window through PetVideoLayer instead of Sprite', () => {
  expect(petWindowUi).toContain("import { PetVideoLayer } from '../PetVideoLayer'")
  expect(petWindowUi).toContain('<PetVideoLayer activeAnimation={animation} onEnded={handleAnimationEnded} />')
  expect(petWindowUi).not.toContain("import { Sprite } from './Sprite'")
  expect(petWindowUi).not.toContain('<Sprite emotion={emotion} action={action} />')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run tests/unit/pet.window.behavior.test.ts`
Expected: FAIL because `PetWindow.tsx` still imports and renders `Sprite`

- [ ] **Step 3: Write minimal implementation**

Replace the pet-window renderer wiring in `apps/shell/ui/pet/PetWindow.tsx` so the file imports `PetVideoLayer` and renders it in place of `Sprite`.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run tests/unit/pet.window.behavior.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/pet.window.behavior.test.ts apps/shell/ui/pet/PetWindow.tsx
git commit -m "fix: restore pet window video renderer"
```

### Task 2: Migrate PetWindow animation state to the demo display model

**Files:**
- Modify: `apps/shell/ui/pet/PetWindow.tsx`
- Reference: `apps/shell/ui/main.tsx`
- Reference: `apps/shell/ui/PetVideoLayer.tsx`
- Reference: `apps/shell/ui/petAnimations.ts`
- Test: `tests/unit/pet.window.behavior.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('drives pet window actions with PetAnimation state from petAnimations', () => {
  expect(petWindowUi).toContain("import { DRAG_ANIMATION, IDLE_ANIMATION, PET_ACTION_SEQUENCE, type PetAnimation } from '../petAnimations'")
  expect(petWindowUi).toContain('const [animation, setAnimation] = useState<PetAnimation>(IDLE_ANIMATION)')
  expect(petWindowUi).toContain('switchAnimation(DRAG_ANIMATION)')
  expect(petWindowUi).toContain('switchAnimation(IDLE_ANIMATION)')
  expect(petWindowUi).not.toContain('const [action, setAction] = useState<PoseName | null>(null)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run tests/unit/pet.window.behavior.test.ts`
Expected: FAIL because `PetWindow.tsx` still tracks `PoseName` action state

- [ ] **Step 3: Write minimal implementation**

Port the animation-state shape from `apps/shell/ui/main.tsx` into `apps/shell/ui/pet/PetWindow.tsx`, while preserving:

- reminder bubble hooks
- context menu hooks
- single-click / double-click behavior
- drag and resize behavior

Use `PetAnimation` state and `handleAnimationEnded` to return actions to idle.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run tests/unit/pet.window.behavior.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/shell/ui/pet/PetWindow.tsx tests/unit/pet.window.behavior.test.ts
git commit -m "fix: align pet window animation state with demo renderer"
```

### Task 3: Repair pet video asset imports to the current alpha directory

**Files:**
- Modify: `apps/shell/ui/petAnimations.ts`
- Modify: `apps/shell/ui/lib/character.ts`
- Test: `tests/unit/pet.video.autoplay.test.ts`
- Test: `corepack pnpm --filter @petsona/shell build`

- [ ] **Step 1: Write the failing test**

```ts
it('loads pet animations from the current final-pet-alpha asset directory', () => {
  expect(petAnimations).toContain("import dragVideo from './assets/characters/final-pet-alpha/wave.mov';")
  expect(petAnimations).toContain("import yawnVideo from './assets/characters/final-pet-alpha/yawn.mov';")
  expect(petAnimations).toContain("import stretchVideo from './assets/characters/final-pet-alpha/stretch.mov';")
  expect(petAnimations).toContain("import idleVideo from './assets/characters/final-pet-alpha/sit.mov';")
  expect(petAnimations).toContain("import lickVideo from './assets/characters/final-pet-alpha/cheer.mov';")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run tests/unit/pet.video.autoplay.test.ts`
Expected: FAIL because `petAnimations.ts` still imports `final-pet/`

- [ ] **Step 3: Write minimal implementation**

Update `apps/shell/ui/petAnimations.ts` and `apps/shell/ui/lib/character.ts` so video imports point at `apps/shell/ui/assets/characters/final-pet-alpha/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run tests/unit/pet.video.autoplay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/shell/ui/petAnimations.ts apps/shell/ui/lib/character.ts tests/unit/pet.video.autoplay.test.ts
git commit -m "fix: point pet assets at alpha video directory"
```

### Task 4: Verify the migrated display path end to end

**Files:**
- Verify: `apps/shell/ui/pet/PetWindow.tsx`
- Verify: `apps/shell/ui/petAnimations.ts`
- Verify: `apps/shell/ui/lib/character.ts`
- Verify: `tests/unit/pet.window.behavior.test.ts`
- Verify: `tests/unit/pet.video.autoplay.test.ts`

- [ ] **Step 1: Run focused pet renderer tests**

Run: `corepack pnpm vitest run tests/unit/pet.window.behavior.test.ts tests/unit/pet.video.autoplay.test.ts`
Expected: PASS

- [ ] **Step 2: Run shell UI build**

Run: `corepack pnpm --filter @petsona/shell build`
Expected: PASS with Vite bundle output and no missing pet asset import errors

- [ ] **Step 3: Review final diff**

Run: `git diff -- apps/shell/ui/pet/PetWindow.tsx apps/shell/ui/petAnimations.ts apps/shell/ui/lib/character.ts tests/unit/pet.window.behavior.test.ts tests/unit/pet.video.autoplay.test.ts`
Expected: diff shows only renderer migration and asset-path repair

- [ ] **Step 4: Commit**

```bash
git add apps/shell/ui/pet/PetWindow.tsx apps/shell/ui/petAnimations.ts apps/shell/ui/lib/character.ts tests/unit/pet.window.behavior.test.ts tests/unit/pet.video.autoplay.test.ts
git commit -m "fix: migrate pet window display logic from demo"
```
