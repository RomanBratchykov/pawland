import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { World }  from './core/World.js';
import { CONFIG } from '../config.js';

import { InputSystem }       from '../systems/InputSystem.js';
import { CatMovementSystem } from '../systems/CatMovementSystem.js';
import { PhysicsSystem }     from '../systems/PhysicsSystem.js';
import { SitSystem }         from '../systems/SitSystem.js';
import { DragSystem }        from '../systems/DragSystem.js';
import { AnimationSystem }   from '../systems/AnimationSystem.js';
import { CustomSkinSystem }  from '../systems/CustomSkinSystem.js';
import {
  CollisionSystem, PetSystem, HeartSystem,
  ShakeSystem, AudioSystem, RenderSystem,
} from '../systems/systems.js';
import {
  createCat,
  createBall,
  InputComponent,
  TransformComponent,
} from '../entities/index.js';

export class Game {
  constructor(canvas, options = {}) {
    console.log('[Game] Initializing...');

    this._onLocalState = typeof options.onLocalState === 'function'
      ? options.onLocalState
      : null;
    this._emitStateEveryMs = 120;
    this._emitStateClock = 0;
    this._remotePlayers = new Map();
    this._pendingRemotePlayers = [];
    this._pendingRemoteBubbles = new Map();
    this._chatBubbles = new Map();
    this._chatTimers = new Map();
    this._skeletonData = null;

    this._app = new PIXI.Application({
      width:           CONFIG.WIDTH,
      height:          CONFIG.HEIGHT,
      backgroundColor: CONFIG.BG_COLOR,
      view:            canvas,
      antialias:       true,
    });

    this._world      = new World();
    this._catEntity  = null;
    this._pendingSkin = null;

    this._drawBackground();

    const audioSystem = new AudioSystem();
    const inputSystem = new InputSystem();
    const dragSystem  = new DragSystem(this._app, audioSystem);
    const petSystem   = new PetSystem(this._app, audioSystem);
    this._customSkin  = new CustomSkinSystem(this._app);

    // Порядок систем важливий — CustomSkin після Spine update (RenderSystem)
    this._world
      .addSystem(inputSystem)
      .addSystem(new SitSystem(audioSystem))
      .addSystem(new CatMovementSystem(inputSystem))
      .addSystem(dragSystem)
      .addSystem(new PhysicsSystem())
      .addSystem(new CollisionSystem())
      .addSystem(new ShakeSystem())
      .addSystem(new AnimationSystem())
      .addSystem(petSystem)
      .addSystem(new HeartSystem(this._app))
      .addSystem(audioSystem)
      .addSystem(new RenderSystem(this._app, dragSystem, petSystem))
      .addSystem(this._customSkin); // ← після RenderSystem бо Spine вже оновлений

    this._app.loader
      .add('skeleton', '/assets/skeleton.json')
      .load((_, resources) => {
        this._skeletonData = resources.skeleton.spineData;
        this._catEntity = createCat(this._app, this._skeletonData, dragSystem, petSystem);
        this._world.addEntity(this._catEntity);

        const ball = createBall(this._app, dragSystem, CONFIG.WIDTH * 0.7, CONFIG.FLOOR_Y - 20);
        this._world.addEntity(ball);

        this._app.ticker.add((delta) => {
          this._world.tick(delta);
          this._tickLocalState();
        });
        console.log('[Game] Ready!');

        // Застосовуємо відкладений скін якщо є
        if (this._pendingSkin) {
          this._customSkin.applyParts(this._catEntity, this._pendingSkin);
          this._pendingSkin = null;
        }

        if (this._pendingRemotePlayers.length > 0) {
          this.setRemotePlayers(this._pendingRemotePlayers);
          this._pendingRemotePlayers = [];
        }
      });
  }

  // parts: { head?: HTMLCanvasElement, body?: ..., leg?: ..., tail?: ... }
  applySkin(parts) {
    if (this._catEntity) {
      this._customSkin.applyParts(this._catEntity, parts);
    } else {
      this._pendingSkin = parts;
    }
  }

  resetSkin() {
    if (this._catEntity) this._customSkin.reset(this._catEntity);
  }

  setRemotePlayers(players = []) {
    if (!this._skeletonData) {
      this._pendingRemotePlayers = players;
      return;
    }

    const incoming = Array.isArray(players) ? players : [];
    const activeIds = new Set();

    incoming.forEach((player) => {
      const id = player?.userId || player?.id;
      if (!id) return;

      activeIds.add(id);

      let entry = this._remotePlayers.get(id);
      if (!entry) {
        entry = this._createRemotePlayer(player);
        this._remotePlayers.set(id, entry);

        const queuedMessage = this._pendingRemoteBubbles.get(id);
        if (queuedMessage) {
          this.setRemoteChatBubble(id, queuedMessage);
          this._pendingRemoteBubbles.delete(id);
        }
      }

      this._updateRemotePlayer(entry, player);
    });

    for (const [id, entry] of this._remotePlayers.entries()) {
      if (activeIds.has(id)) continue;
      this._destroyRemotePlayer(id, entry);
      this._remotePlayers.delete(id);
    }
  }

  setLocalChatBubble(text) {
    if (!this._catEntity) return;

    const spineComp = this._catEntity.get(SpineComponent);
    if (!spineComp?.container) return;

    this._setChatBubble('__local__', spineComp.container, text);
  }

  setRemoteChatBubble(userId, text) {
    if (!userId) return;

    const cleanText = String(text || '').trim().slice(0, 120);
    if (!cleanText) return;

    const entry = this._remotePlayers.get(userId);
    if (!entry) {
      this._pendingRemoteBubbles.set(userId, cleanText);
      return;
    }

    this._setChatBubble(`remote:${userId}`, entry.container, cleanText);
  }

  addEntity(entity) { return this._world.addEntity(entity); }

  _tickLocalState() {
    if (!this._onLocalState || !this._catEntity) return;

    this._emitStateClock += this._app.ticker.elapsedMS;
    if (this._emitStateClock < this._emitStateEveryMs) return;

    this._emitStateClock = 0;

    const tf = this._catEntity.get(TransformComponent);
    const input = this._catEntity.get(InputComponent);
    if (!tf) return;

    this._onLocalState({
      x: Number(tf.x.toFixed(2)),
      y: Number(tf.y.toFixed(2)),
      facingRight: input?.facingRight !== false,
    });
  }

  _createRemotePlayer(player) {
    const container = new PIXI.Container();
    const spine = new Spine(this._skeletonData);
    const baseScale = 0.5;

    spine.scale.set(baseScale);
    spine.interactive = false;
    spine.interactiveChildren = false;
    spine.state.setAnimation(0, CONFIG.ANIM.STAND, true);

    const label = new PIXI.Text(player?.name || 'Player', {
      fill: '#d9f4ff',
      fontFamily: 'purrabet-regular',
      fontSize: 12,
      stroke: '#0b1626',
      strokeThickness: 3,
    });
    label.anchor.set(0.5, 1);
    label.y = -170;

    container.addChild(spine);
    container.addChild(label);
    this._app.stage.addChild(container);

    return {
      container,
      spine,
      label,
      baseScale,
      currentAnim: CONFIG.ANIM.STAND,
      lastX: Number.isFinite(player?.x) ? player.x : CONFIG.WIDTH / 2,
      lastY: Number.isFinite(player?.y) ? player.y : CONFIG.FLOOR_Y,
    };
  }

  _setChatBubble(key, parentContainer, text) {
    const message = String(text || '').trim().slice(0, 120);
    if (!message || !parentContainer) return;

    this._clearChatBubble(key);

    const bubble = this._createSpeechBubble(message);
    parentContainer.sortableChildren = true;
    bubble.zIndex = 999;
    parentContainer.addChild(bubble);

    this._chatBubbles.set(key, { bubble, parentContainer });

    const timer = setTimeout(() => {
      this._clearChatBubble(key);
    }, 4800);
    this._chatTimers.set(key, timer);
  }

  _clearChatBubble(key) {
    const timer = this._chatTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this._chatTimers.delete(key);
    }

    const record = this._chatBubbles.get(key);
    if (!record) return;

    record.parentContainer?.removeChild(record.bubble);
    record.bubble.destroy({ children: true, texture: false, baseTexture: false });
    this._chatBubbles.delete(key);
  }

  _createSpeechBubble(message) {
    const container = new PIXI.Container();

    const text = new PIXI.Text(message, {
      fontFamily: 'purrabet-regular',
      fontSize: 12,
      fill: '#12243e',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 180,
      lineHeight: 16,
    });
    text.anchor.set(0.5, 0);
    text.x = 0;
    text.y = 7;

    const bubbleW = Math.max(56, Math.ceil(text.width + 20));
    const bubbleH = Math.max(28, Math.ceil(text.height + 14));

    const bg = new PIXI.Graphics();
    bg.beginFill(0xffffff, 0.95);
    bg.lineStyle(2, 0x2a456d, 0.9);
    bg.drawRoundedRect(-bubbleW / 2, 0, bubbleW, bubbleH, 10);
    bg.moveTo(-9, bubbleH - 1);
    bg.lineTo(0, bubbleH + 11);
    bg.lineTo(9, bubbleH - 1);
    bg.lineTo(-9, bubbleH - 1);
    bg.endFill();

    container.addChild(bg);
    container.addChild(text);
    container.y = -236;

    return container;
  }

  _updateRemotePlayer(entry, player) {
    const nextX = Number.isFinite(player?.x) ? player.x : entry.lastX;
    const nextY = Number.isFinite(player?.y) ? player.y : entry.lastY;
    const facingRight = player?.facingRight !== false;

    const moved = Math.abs(nextX - entry.lastX) > 0.6 || Math.abs(nextY - entry.lastY) > 0.6;
    const wantedAnim = moved ? CONFIG.ANIM.WALK : CONFIG.ANIM.STAND;

    if (entry.currentAnim !== wantedAnim) {
      entry.spine.state.setAnimation(0, wantedAnim, true);
      entry.currentAnim = wantedAnim;
    }

    entry.container.x = nextX;
    entry.container.y = nextY;
    entry.spine.scale.x = entry.baseScale * (facingRight ? 1 : -1);
    entry.spine.scale.y = entry.baseScale;
    entry.label.text = player?.name || 'Player';

    entry.lastX = nextX;
    entry.lastY = nextY;
  }

  _destroyRemotePlayer(id, entry) {
    this._clearChatBubble(`remote:${id}`);
    entry.container.parent?.removeChild(entry.container);
    entry.container.destroy({ children: true, texture: false, baseTexture: false });
  }

  _drawBackground() {
    const bg = new PIXI.Graphics();
    bg.beginFill(CONFIG.BG_COLOR);
    bg.drawRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    bg.endFill();
    this._app.stage.addChild(bg);

    const floor = new PIXI.Graphics();
    floor.beginFill(0x16213e);
    floor.drawRect(0, CONFIG.FLOOR_Y, CONFIG.WIDTH, CONFIG.HEIGHT - CONFIG.FLOOR_Y);
    floor.endFill();
    this._app.stage.addChild(floor);
  }

  destroy() {
    this._clearChatBubble('__local__');

    for (const key of this._chatBubbles.keys()) {
      this._clearChatBubble(key);
    }

    for (const [id, entry] of this._remotePlayers.entries()) {
      this._destroyRemotePlayer(id, entry);
    }
    this._remotePlayers.clear();

    this._world.destroy();
    this._app.destroy(true, { children: true, texture: true });
  }
}
