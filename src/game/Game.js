import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { World }  from './core/World.js';
import { CONFIG, setViewportSize } from '../config.js';

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
  InputComponent,
  SpineComponent,
  TransformComponent,
} from '../entities/index.js';

const CHAT_BUBBLE = {
  fontSize: 16,
  wordWrapWidth: 250,
  minWidth: 96,
  minHeight: 42,
  padX: 30,
  padY: 18,
  radius: 12,
  tailHalfWidth: 11,
  tailHeight: 12,
  offsetY: -210,
};

const DEFAULT_SCENE_ROOM = 'courtyard';
const SCENE_EDGE_THRESHOLD_PX = 6;
const SCENE_TRANSITION_COOLDOWN_MS = 520;
const INTERACT_DISTANCE_PX = 102;
const REMOTE_INTERPOLATION_FACTOR = 0.2;
const REMOTE_SNAP_DISTANCE_PX = 240;
const REMOTE_MOVE_HOLD_MS = 220;
const MAX_RENDER_RESOLUTION = 1.5;

const SCENE_ROOMS = {
  courtyard: {
    id: 'courtyard',
    title: 'Courtyard',
    leftTo: 'workshop',
    rightTo: 'observatory',
    colors: {
      sky: 0x17304a,
      mid: 0x1f4d60,
      floor: 0x24424d,
      floorLine: 0x6ea88f,
    },
    hint: 'Move to the edge to switch rooms. Press E near objects.',
    objects: [
      {
        id: 'water-bowl',
        label: 'Water Bowl',
        xRatio: 0.23,
        width: 74,
        height: 26,
        color: 0x8fd7ff,
        accent: 0xdff6ff,
        interactionText: 'Fresh water unlocked. Energy restored.',
      },
      {
        id: 'scratch-post',
        label: 'Scratch Post',
        xRatio: 0.73,
        width: 48,
        height: 96,
        color: 0xce9f62,
        accent: 0xf2d8aa,
        interactionText: 'Scratch combo! Claws are super sharp now.',
      },
    ],
  },
  workshop: {
    id: 'workshop',
    title: 'Workshop',
    leftTo: 'observatory',
    rightTo: 'courtyard',
    colors: {
      sky: 0x3d1f3d,
      mid: 0x4e2c57,
      floor: 0x4b2f3d,
      floorLine: 0xf2b56d,
    },
    hint: 'This room has craft toys. Press E to interact.',
    objects: [
      {
        id: 'yarn-basket',
        label: 'Yarn Basket',
        xRatio: 0.28,
        width: 88,
        height: 48,
        color: 0xe88fc7,
        accent: 0xffdaef,
        interactionText: 'Yarn mission started. Roll speed increased.',
      },
      {
        id: 'nap-pillow',
        label: 'Nap Pillow',
        xRatio: 0.7,
        width: 102,
        height: 30,
        color: 0x8f96d6,
        accent: 0xe1e5ff,
        interactionText: 'Soft nap complete. Mood meter is full.',
      },
    ],
  },
  observatory: {
    id: 'observatory',
    title: 'Observatory',
    leftTo: 'courtyard',
    rightTo: 'workshop',
    colors: {
      sky: 0x111a3f,
      mid: 0x233572,
      floor: 0x1f3159,
      floorLine: 0x9ac0ff,
    },
    hint: 'Watch stars and test gadgets. Press E to interact.',
    objects: [
      {
        id: 'telescope',
        label: 'Telescope',
        xRatio: 0.24,
        width: 76,
        height: 70,
        color: 0x90a9ff,
        accent: 0xe5eeff,
        interactionText: 'Star trail discovered. New route marked.',
      },
      {
        id: 'radio-console',
        label: 'Radio Console',
        xRatio: 0.72,
        width: 96,
        height: 54,
        color: 0x6fcad4,
        accent: 0xd9fafd,
        interactionText: 'Beacon online. Teammates can find you faster.',
      },
    ],
  },
};

function getSceneRoom(roomId) {
  if (typeof roomId === 'string' && SCENE_ROOMS[roomId]) {
    return SCENE_ROOMS[roomId];
  }

  return SCENE_ROOMS[DEFAULT_SCENE_ROOM];
}

export class Game {
  constructor(canvas, options = {}) {
    console.log('[Game] Initializing...');

    this._canvas = canvas;
    this._bg = null;
    this._floor = null;
    this._resizeObserver = null;
    this._onResize = this._onResize.bind(this);

    const viewport = this._measureViewport();
    setViewportSize(viewport.width, viewport.height);

    this._onLocalState = typeof options.onLocalState === 'function'
      ? options.onLocalState
      : null;
    this._onSceneChanged = typeof options.onSceneChanged === 'function'
      ? options.onSceneChanged
      : null;
    this._onInteract = typeof options.onInteract === 'function'
      ? options.onInteract
      : null;
    this._showRemoteAcrossRooms = options.showRemoteAcrossRooms !== false;
    this._emitStateEveryMs = 70;
    this._emitStateClock = 0;
    this._remotePlayers = new Map();
    this._pendingRemotePlayers = [];
    this._pendingRemoteBubbles = new Map();
    this._pendingRemoteSkins = new Map();
    this._chatBubbles = new Map();
    this._chatTimers = new Map();
    this._skeletonData = null;
    this._sceneRoomId = DEFAULT_SCENE_ROOM;
    this._sceneObjects = [];
    this._lastSceneTransitionAt = 0;
    this._interactConsumed = false;
    this._sceneObjectLayer = null;

    const renderResolution = Math.min(window.devicePixelRatio || 1, MAX_RENDER_RESOLUTION);

    this._app = new PIXI.Application({
      width:           CONFIG.WIDTH,
      height:          CONFIG.HEIGHT,
      backgroundColor: CONFIG.BG_COLOR,
      view:            canvas,
      antialias:       true,
      resolution:      renderResolution,
      autoDensity:     true,
    });
    this._app.renderer.roundPixels = true;
    this._app.ticker.maxFPS = 60;
    this._app.ticker.minFPS = 30;

    this._world      = new World();
    this._catEntity  = null;
    this._pendingSkin = null;

    this._drawBackground();

    this._sceneObjectLayer = new PIXI.Container();
    this._app.stage.addChild(this._sceneObjectLayer);
    this._renderSceneObjects();
    this._emitSceneChanged();

    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined' && this._canvas?.parentElement) {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(this._canvas.parentElement);
    }

    const audioSystem = new AudioSystem();
    const inputSystem = new InputSystem();
    this._inputSystem = inputSystem;
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

        this._app.ticker.add((delta) => {
          this._world.tick(delta);
          this._updateSceneFlow();
          this._tickLocalState();
          this._tickRemotePlayers();
        });
        console.log('[Game] Ready!');

        this._setSceneRoom(this._sceneRoomId, { force: true, entrySide: 'center' });

        // Застосовуємо відкладений скін якщо є
        if (this._pendingSkin) {
          this._customSkin.applyParts(this._catEntity, this._pendingSkin);
          this._pendingSkin = null;
        }

        if (this._pendingRemotePlayers.length > 0) {
          this.setRemotePlayers(this._pendingRemotePlayers);
          this._pendingRemotePlayers = [];
        }

        this._onResize();
      });
  }

  _measureViewport() {
    const parent = this._canvas?.parentElement;
    const width = parent?.clientWidth || this._canvas?.clientWidth || CONFIG.WIDTH;
    const height = parent?.clientHeight || this._canvas?.clientHeight || CONFIG.HEIGHT;

    return {
      width,
      height,
    };
  }

  _onResize() {
    if (!this._app) return;

    const viewport = this._measureViewport();
    setViewportSize(viewport.width, viewport.height);
    this._app.renderer.resize(CONFIG.WIDTH, CONFIG.HEIGHT);
    this._drawBackground();
    this._renderSceneObjects();
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
      const id = player?.presenceKey || player?.userId || player?.id;
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

        if (this._pendingRemoteSkins.has(id)) {
          const queuedSkin = this._pendingRemoteSkins.get(id);
          this._applyRemoteSkin(entry, queuedSkin);
          this._pendingRemoteSkins.delete(id);
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

  setRemotePlayerSkin(userId, parts) {
    if (!userId) return;

    const entry = this._remotePlayers.get(userId);
    if (!entry) {
      this._pendingRemoteSkins.set(userId, parts || null);
      return;
    }

    this._applyRemoteSkin(entry, parts || null);
  }

  _applyRemoteSkin(entry, parts) {
    if (!entry?.skinSystem || !entry?.skinEntity) return;

    if (entry.lastSkinSource === parts) return;
    entry.lastSkinSource = parts;

    const hasParts = Boolean(parts && Object.keys(parts).length > 0);
    if (!hasParts) {
      entry.skinEnabled = false;
      entry.skinSystem.reset(entry.skinEntity);
      return;
    }

    entry.skinEnabled = true;
    entry.skinSystem.applyParts(entry.skinEntity, parts);
  }

  addEntity(entity) { return this._world.addEntity(entity); }

  _emitSceneChanged() {
    if (!this._onSceneChanged) return;

    const scene = getSceneRoom(this._sceneRoomId);
    this._onSceneChanged({
      id: scene.id,
      title: scene.title,
      hint: scene.hint,
      leftTo: scene.leftTo,
      rightTo: scene.rightTo,
    });
  }

  _setSceneRoom(nextRoomId, options = {}) {
    const { force = false, entrySide = 'center' } = options;
    const nextScene = getSceneRoom(nextRoomId);

    if (!force && this._sceneRoomId === nextScene.id) return;

    this._sceneRoomId = nextScene.id;
    this._lastSceneTransitionAt = Date.now();
    this._drawBackground();
    this._renderSceneObjects();
    this._refreshRemoteVisibility();
    this._emitSceneChanged();

    if (!this._catEntity) return;

    const tf = this._catEntity.get(TransformComponent);
    if (!tf) return;

    if (entrySide === 'left') {
      tf.x = 54;
    } else if (entrySide === 'right') {
      tf.x = CONFIG.WIDTH - 54;
    } else {
      tf.x = Math.min(CONFIG.WIDTH - 54, Math.max(54, tf.x));
    }
  }

  _renderSceneObjects() {
    if (!this._sceneObjectLayer) return;

    const previousChildren = this._sceneObjectLayer.removeChildren();
    previousChildren.forEach((child) => {
      child.destroy({ children: true, texture: false, baseTexture: false });
    });

    const scene = getSceneRoom(this._sceneRoomId);
    this._sceneObjects = scene.objects.map((item) => {
      const x = Math.round(CONFIG.WIDTH * item.xRatio);
      const y = CONFIG.FLOOR_Y;

      const container = new PIXI.Container();
      container.x = x;
      container.y = y;

      const body = new PIXI.Graphics();
      body.beginFill(item.color, 0.95);
      body.drawRoundedRect(-item.width / 2, -item.height, item.width, item.height, 12);
      body.endFill();
      body.lineStyle(2, item.accent, 0.95);
      body.drawRoundedRect(-item.width / 2, -item.height, item.width, item.height, 12);

      const shine = new PIXI.Graphics();
      shine.beginFill(item.accent, 0.22);
      shine.drawRoundedRect(-item.width / 2 + 6, -item.height + 5, item.width - 12, Math.max(10, item.height * 0.33), 8);
      shine.endFill();

      const label = new PIXI.Text(item.label, {
        fill: '#e8f4ff',
        fontFamily: 'purrabet-regular',
        fontSize: 12,
        stroke: '#10213a',
        strokeThickness: 3,
      });
      label.anchor.set(0.5, 1);
      label.y = -item.height - 4;

      container.addChild(body);
      container.addChild(shine);
      container.addChild(label);
      this._sceneObjectLayer.addChild(container);

      return {
        id: item.id,
        label: item.label,
        interactionText: item.interactionText,
        x,
        y: y - item.height / 2,
        width: item.width,
        height: item.height,
      };
    });
  }

  _findNearbyInteractable(tf) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const item of this._sceneObjects) {
      const dx = item.x - tf.x;
      const dy = item.y - tf.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > INTERACT_DISTANCE_PX || distance >= bestDistance) continue;
      best = item;
      bestDistance = distance;
    }

    return best;
  }

  _updateSceneFlow() {
    if (!this._catEntity || !this._inputSystem) return;

    const tf = this._catEntity.get(TransformComponent);
    if (!tf) return;

    const scene = getSceneRoom(this._sceneRoomId);
    const now = Date.now();
    const canTransition = now - this._lastSceneTransitionAt > SCENE_TRANSITION_COOLDOWN_MS;

    if (canTransition) {
      if (scene.leftTo && tf.x <= SCENE_EDGE_THRESHOLD_PX && this._inputSystem.isLeft()) {
        this._setSceneRoom(scene.leftTo, { entrySide: 'right' });
        return;
      }

      if (scene.rightTo && tf.x >= CONFIG.WIDTH - SCENE_EDGE_THRESHOLD_PX && this._inputSystem.isRight()) {
        this._setSceneRoom(scene.rightTo, { entrySide: 'left' });
        return;
      }
    }

    const nearby = this._findNearbyInteractable(tf);
    const interactPressed = this._inputSystem.isDown('KeyE');

    if (!interactPressed) {
      this._interactConsumed = false;
    }

    if (!nearby || !interactPressed || this._interactConsumed) return;

    this._interactConsumed = true;
    this.setLocalChatBubble(nearby.interactionText);
    if (this._onInteract) {
      this._onInteract({
        roomId: this._sceneRoomId,
        objectId: nearby.id,
        label: nearby.label,
        message: nearby.interactionText,
      });
    }
  }

  _refreshRemoteVisibility() {
    for (const entry of this._remotePlayers.values()) {
      entry.container.visible = this._isRemoteVisible(entry.sceneRoom || DEFAULT_SCENE_ROOM);
    }
  }

  _isRemoteVisible(sceneRoom) {
    return this._showRemoteAcrossRooms || sceneRoom === this._sceneRoomId;
  }

  _tickRemotePlayers() {
    if (this._remotePlayers.size === 0) return;

    const now = Date.now();

    for (const entry of this._remotePlayers.values()) {
      const dx = entry.targetX - entry.container.x;
      const dy = entry.targetY - entry.container.y;
      const distance = Math.hypot(dx, dy);

      if (distance > REMOTE_SNAP_DISTANCE_PX) {
        entry.container.x = entry.targetX;
        entry.container.y = entry.targetY;
      } else if (distance > 0.01) {
        entry.container.x += dx * REMOTE_INTERPOLATION_FACTOR;
        entry.container.y += dy * REMOTE_INTERPOLATION_FACTOR;
        if (Math.abs(entry.targetX - entry.container.x) < 0.08) entry.container.x = entry.targetX;
        if (Math.abs(entry.targetY - entry.container.y) < 0.08) entry.container.y = entry.targetY;
      }

      const isMoving = distance > 0.65 || now < entry.movementHoldUntil;
      const wantedAnim = isMoving ? CONFIG.ANIM.WALK : CONFIG.ANIM.STAND;
      if (entry.currentAnim !== wantedAnim) {
        entry.spine.state.setAnimation(0, wantedAnim, true);
        entry.currentAnim = wantedAnim;
      }

      if (entry.skinEnabled && entry.container.visible) {
        entry.skinSystem?.update();
      }
    }
  }

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
      sceneRoom: this._sceneRoomId,
    });
  }

  _createRemotePlayer(player) {
    const container = new PIXI.Container();
    const spine = new Spine(this._skeletonData);
    const skinSystem = new CustomSkinSystem(this._app);
    const skinEntity = {
      get: (ComponentClass) => (ComponentClass === SpineComponent ? { instance: spine } : null),
    };
    const baseScale = 0.5;
    const initialX = Number.isFinite(player?.x) ? player.x : CONFIG.WIDTH / 2;
    const initialY = Number.isFinite(player?.y) ? player.y : CONFIG.FLOOR_Y;

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
    container.x = initialX;
    container.y = initialY;
    this._app.stage.addChild(container);

    return {
      container,
      spine,
      label,
      skinSystem,
      skinEntity,
      baseScale,
      currentAnim: CONFIG.ANIM.STAND,
      sceneRoom: typeof player?.sceneRoom === 'string' ? player.sceneRoom : DEFAULT_SCENE_ROOM,
      lastX: initialX,
      lastY: initialY,
      targetX: initialX,
      targetY: initialY,
      movementHoldUntil: 0,
      lastSkinSource: null,
      skinEnabled: false,
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
    container.roundPixels = true;

    const text = new PIXI.Text(message, {
      fontFamily: 'purrabet-regular',
      fontSize: CHAT_BUBBLE.fontSize,
      fill: '#12243e',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: CHAT_BUBBLE.wordWrapWidth,
      lineHeight: 20,
      breakWords: true,
    });
    text.resolution = 2;
    text.roundPixels = true;
    text.anchor.set(0.5, 0);
    text.x = 0;
    text.y = 9;

    const bubbleW = Math.max(CHAT_BUBBLE.minWidth, Math.ceil(text.width + CHAT_BUBBLE.padX));
    const bubbleH = Math.max(CHAT_BUBBLE.minHeight, Math.ceil(text.height + CHAT_BUBBLE.padY));

    const bg = new PIXI.Graphics();
    bg.beginFill(0xffffff, 0.95);
    bg.lineStyle(2, 0x2a456d, 0.9);
    bg.drawRoundedRect(-bubbleW / 2, 0, bubbleW, bubbleH, CHAT_BUBBLE.radius);
    bg.moveTo(-CHAT_BUBBLE.tailHalfWidth, bubbleH - 1);
    bg.lineTo(0, bubbleH + CHAT_BUBBLE.tailHeight);
    bg.lineTo(CHAT_BUBBLE.tailHalfWidth, bubbleH - 1);
    bg.lineTo(-CHAT_BUBBLE.tailHalfWidth, bubbleH - 1);
    bg.endFill();

    container.addChild(bg);
    container.addChild(text);
    container.y = CHAT_BUBBLE.offsetY;

    return container;
  }

  _updateRemotePlayer(entry, player) {
    const nextX = Number.isFinite(player?.x) ? player.x : entry.lastX;
    const nextY = Number.isFinite(player?.y) ? player.y : entry.lastY;
    const facingRight = player?.facingRight !== false;
    const sceneRoom = typeof player?.sceneRoom === 'string' ? player.sceneRoom : DEFAULT_SCENE_ROOM;
    entry.sceneRoom = sceneRoom;
    entry.container.visible = this._isRemoteVisible(sceneRoom);

    const movementDistance = Math.hypot(nextX - entry.lastX, nextY - entry.lastY);
    if (movementDistance > 0.45) {
      entry.movementHoldUntil = Date.now() + REMOTE_MOVE_HOLD_MS;
    }

    entry.targetX = nextX;
    entry.targetY = nextY;
    entry.spine.scale.x = entry.baseScale * (facingRight ? 1 : -1);
    entry.spine.scale.y = entry.baseScale;
    entry.label.text = player?.name || 'Player';

    entry.lastX = nextX;
    entry.lastY = nextY;
  }

  _destroyRemotePlayer(id, entry) {
    this._clearChatBubble(`remote:${id}`);
    entry.skinSystem?.destroy();
    entry.container.parent?.removeChild(entry.container);
    entry.container.destroy({ children: true, texture: false, baseTexture: false });
  }

  _drawBackground() {
    const scene = getSceneRoom(this._sceneRoomId);

    if (!this._bg) {
      this._bg = new PIXI.Graphics();
      this._app.stage.addChild(this._bg);
    }

    if (!this._floor) {
      this._floor = new PIXI.Graphics();
      this._app.stage.addChild(this._floor);
    }

    this._bg.clear();
    this._bg.beginFill(scene.colors.sky);
    this._bg.drawRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT * 0.58);
    this._bg.endFill();
    this._bg.beginFill(scene.colors.mid);
    this._bg.drawRect(0, CONFIG.HEIGHT * 0.58, CONFIG.WIDTH, CONFIG.HEIGHT * 0.42);
    this._bg.endFill();

    this._floor.clear();
    this._floor.beginFill(scene.colors.floor);
    this._floor.drawRect(0, CONFIG.FLOOR_Y, CONFIG.WIDTH, CONFIG.HEIGHT - CONFIG.FLOOR_Y);
    this._floor.endFill();
    this._floor.lineStyle(2, scene.colors.floorLine, 0.85);
    this._floor.moveTo(0, CONFIG.FLOOR_Y + 1);
    this._floor.lineTo(CONFIG.WIDTH, CONFIG.FLOOR_Y + 1);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    this._clearChatBubble('__local__');

    for (const key of this._chatBubbles.keys()) {
      this._clearChatBubble(key);
    }

    for (const [id, entry] of this._remotePlayers.entries()) {
      this._destroyRemotePlayer(id, entry);
    }
    this._remotePlayers.clear();
    this._pendingRemoteSkins.clear();

    this._world.destroy();
    this._app.destroy(true, { children: true, texture: true });
  }
}
