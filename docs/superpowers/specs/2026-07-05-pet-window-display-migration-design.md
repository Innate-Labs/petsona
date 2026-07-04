# Pet Window Display Migration Design

## Goal

Restore the desktop pet window in `petsona-main` to the stable display behavior from `demo_v0.1` by reusing the `PetVideoLayer + petAnimations` rendering model, while keeping the current Petsona shell behaviors such as reminders, emotion signals, context menu, drag, and resize.

## Problem

The current desktop pet window at `apps/shell/ui/pet/PetWindow.tsx` renders through `pet/Sprite.tsx`, but the working demo display logic lives in `demo_v0.1/src/renderer/PetVideoLayer.tsx`. During the repair, the checked-in `final-pet/` video assets were found missing from the live asset directory, so the display path had to be restored to the official `assets/characters/final-pet/` location using the backed-up `.mov` sources.

## Scope

This change only replaces the pet-window rendering layer and fixes the asset path mismatch needed for that layer to work.

In scope:

- Switch `apps/shell/ui/pet/PetWindow.tsx` from `Sprite` to `PetVideoLayer`
- Reuse `apps/shell/ui/petAnimations.ts` as the pet-window animation source
- Keep Petsona-specific window interactions, bubble behavior, reminder behavior, and menu behavior intact
- Update imports so display-critical files point back to the restored `final-pet/` asset folder
- Add or update tests that lock the pet window to the migrated display model

Out of scope:

- Reworking `apps/shell/ui/main.tsx` pet view beyond the asset-path repair it already needs
- Rewriting the emotion machine or reminder system
- Removing `Sprite.tsx` from other non-pet-window usage

## Design

### Rendering model

`PetWindow` should use the same stable rendering primitive as the working demo: `PetVideoLayer` with `PetAnimation` objects from `petAnimations.ts`. The window should hold a current `PetAnimation`, drive it through click and drag interaction, and return to `IDLE_ANIMATION` when timed actions finish.

### Behavior preservation

The current Petsona window contract remains:

- single click cycles through the three action videos
- double click opens the main panel
- drag triggers the drag animation and starts Tauri window dragging
- resize handle still uses Tauri resize dragging
- reminder bubbles and context menus stay wired as they are today

Only the visual renderer changes; shell behavior stays in place.

### Asset resolution

The canonical runtime asset directory should remain `apps/shell/ui/assets/characters/final-pet/`. Any temporary references to alternate asset folders should be removed once the backed-up `.mov` files have been restored there.

## Testing

- Add a failing unit test that asserts `PetWindow.tsx` imports and renders `PetVideoLayer` and no longer imports `Sprite`
- Update any existing text-based unit tests that assume the old renderer
- Run focused `vitest` checks for pet window behavior and autoplay behavior
- Run a shell UI build to verify the renderer compiles with the repaired asset paths

## Risks

- `SpriteFigure` and other non-window surfaces may still rely on `lib/character.ts`, so asset-path repair must include that file too
- The worktree is already dirty around pet video assets, so changes must avoid undoing user work and should only retarget imports to the folder that currently exists
