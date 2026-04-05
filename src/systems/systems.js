// ─────────────────────────────────────────────────────────────────
// CollisionSystem.js
//
// Перевіряє зіткнення між BallComponent і CatComponent.
// Чому окрема система: в майбутньому тут буде колізія між
// кулями і ворогами, монетами і кіт — все через ту саму систему.
// ─────────────────────────────────────────────────────────────────

import { System }             from '../game/core/System.js';
import { BallComponent }      from '../entities/index.js';
import { CatComponent }       from '../entities/index.js';
import { TransformComponent } from '../entities/index.js';
import { PhysicsComponent }   from '../entities/index.js';
import { ColliderComponent }  from '../entities/index.js';
import { DragComponent }      from '../entities/index.js';
import { RenderComponent }    from '../entities/index.js';
import { TiltComponent }      from '../entities/index.js';
import { CONFIG }             from '../config.js';

export class CollisionSystem extends System {
  update() {
    const balls = this.world.query(BallComponent, TransformComponent, PhysicsComponent, ColliderComponent);
    const cats  = this.world.query(CatComponent,  TransformComponent);

    for (const ball of balls) {
      if (ball.has(DragComponent)) continue; // не штовхаємо якщо тягнуть

      const btf  = ball.get(TransformComponent);
      const bPhys = ball.get(PhysicsComponent);
      const bColl = ball.get(ColliderComponent);

      for (const cat of cats) {
        const ctf = cat.get(TransformComponent);

        // Центр тіла кота — трохи вище ніж позиція контейнера
        const catBodyY = ctf.y - 80;
        const dx       = btf.x - ctf.x;
        const dy       = btf.y - catBodyY;
        const dist     = Math.sqrt(dx * dx + dy * dy);
        const minDist  = bColl.radius + CONFIG.CAT_HIT_RADIUS;

        if (dist < minDist && dist > 0) {
          const nx     = dx / dist;
          const ny     = dy / dist;
          const speed  = Math.max(Math.sqrt(bPhys.vx**2 + bPhys.vy**2), 4);
          bPhys.vx     = nx * speed * 0.9;
          bPhys.vy     = ny * speed * 0.9 - 2;
          // Виштовхуємо з overlap
          btf.x = ctf.x + nx * (minDist + 1);
          btf.y = catBodyY + ny * (minDist + 1);
          console.log('[COLLISION] Ball kicked by cat');
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// PetSystem.js — логіка гладжування
// ─────────────────────────────────────────────────────────────────

import { PetComponent }   from '../entities/index.js';
import { SpineComponent } from '../entities/index.js';
import { InputComponent } from '../entities/index.js';
import { HeartComponent } from '../entities/index.js';
import { Entity }         from '../game/core/Entity.js';

export class PetSystem extends System {
  constructor(app, audioSystem) {
    super();
    this._app   = app;
    this._audio = audioSystem;
  }

  // Викликається з RenderSystem коли pointermove над котом
  onPetMove(entity) {
    if (!entity.has(InputComponent)) return;
    if (!entity.get(InputComponent).isSitting) return;
    if (!entity.has(PetComponent)) return;

    const pet = entity.get(PetComponent);
    pet.moveCount++;

    if (pet.moveCount >= CONFIG.PET_THRESHOLD) {
      pet.moveCount  = 0;
      pet.heartTimer++;

      if (pet.heartTimer % CONFIG.HEART_INTERVAL === 0) {
        this._spawnHeart(entity);
      }

      this._audio?.startPurr();
    }
  }

  // onPetEnd(entity) {
  //   this._audio?.stopPurr();
  // }

  _spawnHeart(catEntity) {
    const tf = catEntity.get(TransformComponent);
    // Створюємо окремий entity для кожного сердечка
    const heart = new Entity('heart');
    heart.add(new TransformComponent({
      x: tf.x + (Math.random() * 40 - 20),
      y: tf.y - 170,
    }));
    heart.add(new HeartComponent());
    this.world.addEntity(heart);
    console.log('[PET] Heart spawned');
  }

  update() {} // логіка в onPetMove/onPetEnd — викликаються подіями
}

// ─────────────────────────────────────────────────────────────────
// HeartSystem.js — анімація сердечок що злітають
// ─────────────────────────────────────────────────────────────────

import * as PIXI from 'pixi.js';

export class HeartSystem extends System {
  constructor(app) {
    super();
    this._app    = app;
    this._pixiMap = new Map(); // entityId → PIXI.Graphics
  }

  update() {
    const hearts = this.world.query(HeartComponent, TransformComponent);

    for (const entity of hearts) {
      const heart = entity.get(HeartComponent);
      const tf    = entity.get(TransformComponent);

      // Створюємо Pixi графіку при першому кадрі
      if (!this._pixiMap.has(entity.id)) {
        const g = this._createHeartGfx();
        this._app.stage.addChild(g);
        this._pixiMap.set(entity.id, g);
      }

      const g = this._pixiMap.get(entity.id);

      // Оновлюємо позицію і прозорість
      tf.y       -= 1.5;
      heart.life -= 0.012;
      g.x         = tf.x;
      g.y         = tf.y;
      g.alpha     = heart.life;
      g.scale.set(g.scale.x + 0.008);

      // Видаляємо коли life <= 0
      if (heart.life <= 0) {
        this._app.stage.removeChild(g);
        this._pixiMap.delete(entity.id);
        this.world.removeEntity(entity);
      }
    }
  }

  _createHeartGfx() {
    const g = new PIXI.Graphics();
    g.beginFill(0xff6b9d);
    g.moveTo(0, -8);
    g.bezierCurveTo( 8, -16,  18, -6, 0,  8);
    g.bezierCurveTo(-18, -6, -8, -16, 0, -8);
    g.endFill();
    return g;
  }

  destroy() {
    this._pixiMap.forEach(g => this._app.stage.removeChild(g));
    this._pixiMap.clear();
  }
}

// ─────────────────────────────────────────────────────────────────
// ShakeSystem.js — акселерометр і візуальне трясіння
// ─────────────────────────────────────────────────────────────────

import { ShakeComponent } from '../entities/index.js';

export class ShakeSystem extends System {
  constructor() {
    super();
    this._lastAcc     = { x: 0, y: 0, z: 0 };
    this._lastShakeAt = 0;
    this._onMotion    = this._onMotion.bind(this);
  }

  init() {
    const requestOnInteraction = async () => {
      if (typeof DeviceMotionEvent === 'undefined') return;
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const perm = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
        if (perm !== 'granted') return;
      }
      window.addEventListener('devicemotion', this._onMotion);
      console.log('[ShakeSystem] Accelerometer active');
      window.removeEventListener('pointerdown', requestOnInteraction);
    };
    window.addEventListener('pointerdown', requestOnInteraction);
  }

  update() {
    // Затухання shake на всіх entities що мають ShakeComponent
    const entities = this.world.query(ShakeComponent, TransformComponent);
    for (const entity of entities) {
      const shake = entity.get(ShakeComponent);
      if (shake.intensity <= 0.01) { shake.intensity = 0; continue; }

      const tf = entity.get(TransformComponent);
      const s  = shake.intensity * 12;
      tf.x    += (Math.random() - 0.5) * s;
      tf.y    += (Math.random() - 0.5) * s;
      shake.intensity *= CONFIG.SHAKE_DECAY;
    }
  }

  _onMotion(e) {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;

    const dx    = (acc.x || 0) - this._lastAcc.x;
    const dy    = (acc.y || 0) - this._lastAcc.y;
    const dz    = (acc.z || 0) - this._lastAcc.z;
    const delta = Math.sqrt(dx*dx + dy*dy + dz*dz);
    this._lastAcc = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 };

    const now = Date.now();
    if (delta > CONFIG.SHAKE_THRESHOLD && now - this._lastShakeAt > CONFIG.SHAKE_COOLDOWN) {
      this._lastShakeAt = now;
      console.log(`[SHAKE] Detected! delta=${delta.toFixed(1)}`);

      // Встановлюємо intensity на всіх entities з ShakeComponent
      const entities = this.world.query(ShakeComponent);
      entities.forEach(e => { e.get(ShakeComponent).intensity = 1; });
    }
  }

  destroy() {
    window.removeEventListener('devicemotion', this._onMotion);
  }
}

// ─────────────────────────────────────────────────────────────────
// AudioSystem.js — звуки
// ─────────────────────────────────────────────────────────────────

export class AudioSystem extends System {
  constructor() {
    super();
    this._purr  = new Audio('/assets/purr.mp3');
    this._purr.loop   = true;
    this._purr.volume = 0.4;
    this._purring = false;

    // Meows
    this._meows = [1,2].map(n => `/assets/meow${n}.mp3`);

    // Background music — стартує після першого дотику
    this._bg = new Audio('/assets/bg.mp3');
    this._bg.loop = true; this._bg.volume = 0.1;
    const startBg = () => {
      this._bg.play().catch(() => {});
      window.removeEventListener('pointerdown', startBg);
    };
    window.addEventListener('pointerdown', startBg);
  }

  playMeow() {
    const src = this._meows[Math.floor(Math.random() * this._meows.length)];
    Object.assign(new Audio(src), { volume: 0.7 }).play().catch(() => {});
  }

  startPurr() {}
  stopPurr()  {}
  update() {}
  destroy() { this._purr.pause(); this._bg.pause(); }
}

// ─────────────────────────────────────────────────────────────────
// RenderSystem.js
//
// Синхронізує PIXI об'єкти з TransformComponent.
// Також налаштовує pointer events на Spine entities.
// Оновлює SpineComponent (root bone lock, container позиція).
// ─────────────────────────────────────────────────────────────────

// import * as PIXI from 'pixi.js';

export class RenderSystem extends System {
  constructor(app, dragSystem, petSystem) {
    super();
    this._app       = app;
    this._dragSystem = dragSystem;
    this._petSystem  = petSystem;
  }

  update() {
    // ── Spine entities ────────────────────────────────────────────
    const spineEntities = this.world.query(SpineComponent, TransformComponent);

    for (const entity of spineEntities) {
      const spine = entity.get(SpineComponent);
      const tf    = entity.get(TransformComponent);
      const tilt  = entity.get(TiltComponent);

      if (!spine.container) continue;

      // Позиція контейнера = transform позиція
      spine.container.x = tf.x;
      spine.container.y = tf.y;

      // Scale (для flipX)
      const SPINE_SCALE = 0.5;
spine.instance.scale.x = SPINE_SCALE * Math.sign(tf.scaleX || 1);
spine.instance.scale.y = SPINE_SCALE;

      // Нахил
      if (tilt) spine.container.rotation = tilt.angle;

      // Блокуємо drift root кістки від анімації walk
      const root = spine.instance.skeleton.getRootBone();
      if (root) { root.y = 0; root.x = 0; }
    }

    // ── Circle entities (Ball) ────────────────────────────────────
    const renderEntities = this.world.query(RenderComponent, TransformComponent);

    for (const entity of renderEntities) {
      const render = entity.get(RenderComponent);
      const tf     = entity.get(TransformComponent);

      if (!render.pixi) continue;

      // hitArea оновлюємо кожен кадр щоб drag і petting
      // завжди попадали на правильну позицію
      if (render.pixi.hitArea) {
        render.pixi.hitArea = new PIXI.Circle(tf.x, tf.y, render.radius * 1.5);
      }

      // Перемальовуємо м'яч (він рухається)
      if (entity.has(BallComponent)) {
        this._drawBall(render, tf);
      }
    }
  }

  _drawBall(render, tf) {
    const g = render.pixi;
    g.clear();
    g.beginFill(render.color);
    g.drawCircle(tf.x, tf.y, render.radius);
    g.endFill();
    g.beginFill(0xffffff, 0.4);
    g.drawCircle(tf.x - render.radius * 0.3, tf.y - render.radius * 0.3, render.radius * 0.25);
    g.endFill();

    if (render.shadow) {
      render.shadow.clear();
      const scale = Math.max(0.2, 1 - (CONFIG.FLOOR_Y - tf.y) / 300);
      render.shadow.beginFill(0x000000, 0.2 * scale);
      render.shadow.drawEllipse(tf.x, CONFIG.FLOOR_Y + 4, render.radius * scale, render.radius * 0.3 * scale);
      render.shadow.endFill();
    }
  }
}
