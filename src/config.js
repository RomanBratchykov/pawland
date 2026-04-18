// ─────────────────────────────────────────────────────────────────
// config.js
//
// Всі константи в одному місці. Жодної логіки — тільки числа і рядки.
// Якщо хочеш підкрутити гравітацію або швидкість — тільки тут.
// ─────────────────────────────────────────────────────────────────

const BASE_WIDTH = 800;
const BASE_HEIGHT = 500;
const FLOOR_RATIO = 0.88;
const MOBILE_FLOOR_RATIO = 0.83;
const MOBILE_VIEWPORT_BREAKPOINT = 820;

export const CONFIG = {
  // ── Canvas ────────────────────────────────────────────────────
  WIDTH:    BASE_WIDTH,
  HEIGHT:   BASE_HEIGHT,
  BG_COLOR: 0x1a1a2e,
  FLOOR_Y:  Math.round(BASE_HEIGHT * FLOOR_RATIO),

  // ── Cat movement ─────────────────────────────────────────────
  MOVE_SPEED:          3,
  JUMP_FORCE_VERTICAL: 14,   // стрибок стоячи — вище
  JUMP_FORCE_FORWARD:  10,   // стрибок в ході — нижче але далі
  JUMP_HORIZONTAL:      4,   // горизонтальний імпульс при стрибку в ході
  AIR_STEER:            0.3, // наскільки можна керувати в повітрі

  // ── Physics (shared) ─────────────────────────────────────────
  GRAVITY:  0.5,

  // ── Ball ──────────────────────────────────────────────────────
  BALL_RADIUS:   18,
  BALL_COLOR:    0xff6b9d,
  BALL_BOUNCE:   0.65,   // скільки енергії лишається після відскоку
  BALL_FRICTION: 0.988,  // гальмування на підлозі
  BALL_GRAVITY:  0.55,
  CAT_HIT_RADIUS: 30,    // радіус тіла кота для колізії з м'ячем

  // ── Petting ───────────────────────────────────────────────────
  PET_THRESHOLD:   4,    // рухів миші = одне погладжування
  HEART_INTERVAL:  8,    // кадрів між сердечками
  PURR_VOLUME:     0.4,

  // ── Shake ─────────────────────────────────────────────────────
  SHAKE_THRESHOLD: 18,   // м/с² — поріг для детекції трясіння
  SHAKE_COOLDOWN:  500,  // мс між реакціями на трясіння
  SHAKE_DECAY:     0.88, // затухання трясіння за кадр

  // ── Animations ───────────────────────────────────────────────
  // Ці рядки мають точно співпадати з іменами анімацій в Spine Editor
  ANIM: {
    STAND: 'stand',
    WALK:  'walk',
    SIT:   'sit',
    JUMP:  'jump_vertical',
    PET:   'sitpet',
  },
};

export function setViewportSize(width, height) {
  const nextWidth = Math.max(640, Math.round(Number(width) || BASE_WIDTH));
  const nextHeight = Math.max(400, Math.round(Number(height) || BASE_HEIGHT));
  const floorRatio = nextWidth <= MOBILE_VIEWPORT_BREAKPOINT ? MOBILE_FLOOR_RATIO : FLOOR_RATIO;

  CONFIG.WIDTH = nextWidth;
  CONFIG.HEIGHT = nextHeight;
  CONFIG.FLOOR_Y = Math.round(nextHeight * floorRatio);
}
