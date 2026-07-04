import dragVideo from './assets/characters/final-pet/wave.mov';
import yawnVideo from './assets/characters/final-pet/yawn.mov';
import stretchVideo from './assets/characters/final-pet/stretch.mov';
import idleVideo from './assets/characters/final-pet/sit.mov';
import lickVideo from './assets/characters/final-pet/cheer.mov';

export type PetAnimation = {
  id: 'idle' | 'stretch' | 'yawn' | 'lick' | 'drag';
  label: string;
  src: string;
  loop: boolean;
};

export const IDLE_ANIMATION: PetAnimation = {
  id: 'idle',
  label: '坐着',
  src: idleVideo,
  loop: false
};

export const PET_ANIMATIONS: PetAnimation[] = [
  IDLE_ANIMATION,
  { id: 'stretch', label: '伸懒腰', src: stretchVideo, loop: false },
  { id: 'yawn', label: '打哈欠', src: yawnVideo, loop: false },
  { id: 'lick', label: '舔爪子', src: lickVideo, loop: false },
  { id: 'drag', label: '拖拽动作', src: dragVideo, loop: true }
];

export const PET_ACTION_SEQUENCE = PET_ANIMATIONS.filter(
  (animation) => animation.id === 'stretch' || animation.id === 'yawn' || animation.id === 'lick'
);

export const DRAG_ANIMATION = PET_ANIMATIONS.find((animation) => animation.id === 'drag') ?? IDLE_ANIMATION;
