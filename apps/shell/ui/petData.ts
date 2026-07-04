export const PET_DATA_STORAGE_KEY = 'pet-agent.petData.v1';

export const PET_SPECIES_OPTIONS = ['小猫', '小狗', '其他'] as const;
export const PET_PERSONALITY_OPTIONS = ['温柔', '傲娇', '冷漠', '活泼', '愤怒'] as const;

export type PetSpecies = (typeof PET_SPECIES_OPTIONS)[number];
export type PetPersonality = (typeof PET_PERSONALITY_OPTIONS)[number];

export type PetProfile = {
  nickname: string;
  species: PetSpecies;
  personality: PetPersonality;
  breed: string;
  weight: string;
  birthday: string;
  lastDewormedAt: string;
  lastVaccinatedAt: string;
};

export type PetDataState = {
  profile: PetProfile;
  petId: string;
  firstCompanionDate: string;
};

type PetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DEFAULT_PET_PROFILE: PetProfile = {
  nickname: '糯米',
  species: '小猫',
  personality: '温柔',
  breed: '布偶猫',
  weight: '7.8千克',
  birthday: '2024-03-28',
  lastDewormedAt: '2026-06-28',
  lastVaccinatedAt: '2026-05-22'
};

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, date.getDate());
}

function fullMonthsBetween(start: Date, end: Date) {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

export function formatDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) return '未设置';
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function calculatePetAgeLabel(birthdayKey: string, now = new Date()) {
  const birthday = parseDateKey(birthdayKey);
  if (!birthday || birthday > now) return '未设置';

  const totalMonths = fullMonthsBetween(birthday, now);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  if (years >= 1) return `${years}岁${months}月`;

  const monthAnchor = addMonths(birthday, totalMonths);
  const days = Math.max(0, Math.floor((now.getTime() - monthAnchor.getTime()) / 86_400_000));
  return `${totalMonths}个月${days}天`;
}

export function calculateCompanionDays(firstCompanionDate: string, now = new Date()) {
  const firstDate = parseDateKey(firstCompanionDate);
  if (!firstDate) return 1;

  const today = parseDateKey(toDateKey(now)) ?? now;
  const diffDays = Math.floor((today.getTime() - firstDate.getTime()) / 86_400_000);
  return Math.max(1, diffDays + 1);
}

export function generatePetId(random = Math.random) {
  return String(Math.floor(10_000_000 + random() * 90_000_000)).slice(0, 8);
}

export function createDefaultPetDataState(now = new Date(), random = Math.random): PetDataState {
  return {
    profile: { ...DEFAULT_PET_PROFILE },
    petId: generatePetId(random),
    firstCompanionDate: toDateKey(now)
  };
}

function normalizeState(candidate: Partial<PetDataState> | null | undefined, now: Date, random: () => number): PetDataState {
  const fallback = createDefaultPetDataState(now, random);
  return {
    profile: {
      ...DEFAULT_PET_PROFILE,
      ...(candidate?.profile ?? {})
    },
    petId: candidate?.petId || fallback.petId,
    firstCompanionDate: candidate?.firstCompanionDate || fallback.firstCompanionDate
  };
}

export function loadPetDataState(storage: PetStorage | null | undefined, now = new Date(), random = Math.random): PetDataState {
  if (!storage) return createDefaultPetDataState(now, random);

  try {
    const saved = storage.getItem(PET_DATA_STORAGE_KEY);
    if (!saved) return createDefaultPetDataState(now, random);
    return normalizeState(JSON.parse(saved) as Partial<PetDataState>, now, random);
  } catch {
    return createDefaultPetDataState(now, random);
  }
}

export function savePetDataState(storage: PetStorage | null | undefined, state: PetDataState) {
  if (!storage) return;

  try {
    storage.setItem(PET_DATA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in restricted preview contexts.
  }
}
