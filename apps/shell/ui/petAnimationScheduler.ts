import type { PetBehaviorFrequency } from '@petsona/shared';

export const TAIL_HOLD_MIN_MS = 3000;
export const TAIL_HOLD_MAX_MS = 10000;
export const ANIMATION_CROSSFADE_MS = 500;
export const TAIL_OVERLAP_MS = 120;
export const PROACTIVE_BUBBLE_VISIBLE_MS = 5000;

const BEHAVIOR_HOLD_RANGES_MS: Record<PetBehaviorFrequency, [number, number]> = {
  active: [30_000, 45_000],
  normal: [120_000, 150_000],
  quiet: [300_000, 360_000],
};

export function getRandomTailHoldMs(
  frequency: PetBehaviorFrequency = 'normal',
  random = Math.random
) {
  const [min, max] = BEHAVIOR_HOLD_RANGES_MS[frequency] ?? BEHAVIOR_HOLD_RANGES_MS.normal;
  const span = max - min;
  return Math.round(min + random() * span);
}

export function getNextActionIndex(currentIndex: number, sequenceLength: number) {
  if (sequenceLength <= 0) return 0;
  return (currentIndex + 1) % sequenceLength;
}
