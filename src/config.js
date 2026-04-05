// ─────────────────────────────────────────────────────────────────
// config.js
//
// Всі константи в одному місці. Жодної логіки — тільки числа і рядки.
// Якщо хочеш підкрутити гравітацію або швидкість — тільки тут.
// ─────────────────────────────────────────────────────────────────
// const meows = [
//   new Audio('/assets/meow1.mp3'),
//   new Audio('/assets/meow2.mp3'),
//   new Audio('/assets/meow3.mp3'),
//   new Audio('/assets/meow4.mp3'),
//   new Audio('/assets/meow5.mp3'),
//   new Audio('/assets/meow6.mp3'),
//   new Audio('/assets/meow7.mp3'),
// ];

// const playMeow = () => {
//   const sound = meows[Math.floor(Math.random() * meows.length)];
//   sound.currentTime = 0; // rewind if already playing
//   sound.volume = 0.7;
//   sound.play().catch(() => {}); 
// };
// const purr = new Audio('/assets/purr.mp3');
//   purr.loop   = true;
//   purr.volume = CONFIG.PURR_VOLUME;
//   const bgMusic = new Audio('/assets/bg.mp3');
//   bgMusic.loop   = true;
//   bgMusic.volume = 0.1;
//   const startMusic = () => {
//     bgMusic.play().catch(() => {});
//     window.removeEventListener('keydown', startMusic);
//     window.removeEventListener('pointerdown', startMusic);
//   };
//   window.addEventListener('keydown', startMusic);
//   window.addEventListener('pointerdown', startMusic); 

export const CONFIG = {
  // ── Canvas ────────────────────────────────────────────────────
  WIDTH:    800,
  HEIGHT:   600,
  BG_COLOR: 0x1a1a2e,
  FLOOR_Y:  540,

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
  CAT_HIT_RADIUS: 45,    // радіус тіла кота для колізії з м'ячем

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
