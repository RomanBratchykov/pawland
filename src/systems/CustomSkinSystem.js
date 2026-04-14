// ─────────────────────────────────────────────────────────────────
// CustomSkinSystem.js  — v3 (correct bone coordinate space)
//
// Ключове виправлення:
//   Спрайти додаються до SPINE INSTANCE (не container).
//   Spine instance має scale(0.5), тому bone.worldX/Y — у Spine units —
//   використовуються безпосередньо без додаткового множення.
//   Parent scale автоматично конвертує Spine units → screen pixels.
//
// Draw order відповідає skeleton.json:
//   leg2(0), leg4(1), tail(2), body(3), leg3(4), head(5), leg1(6)
// ─────────────────────────────────────────────────────────────────

import * as PIXI from 'pixi.js';
import { System }         from '../game/core/System.js';
import { SpineComponent } from '../entities/index.js';
import { getFallbackSkeletonLayout, loadSkeletonLayout } from '../lib/skeletonLayout.js';

// Draw order з skeleton.json slots array
const DRAW_ORDER = {
  leg2: 0,
  leg4: 1,
  tail: 2,
  body: 3,
  leg3: 4,
  head: 5,
  leg1: 6,
};

function toAttachment(layoutItem) {
  return {
    x: layoutItem.x,
    y: layoutItem.y,
    rotation: layoutItem.rotation,
    w: layoutItem.width,
    h: layoutItem.height,
  };
}

function buildPartMap(layout) {
  const legAtt = toAttachment(layout.leg);

  return {
    head: {
      boneName: 'head',
      att: toAttachment(layout.head),
      scale: 1,
      rotationMode: 'bone',
      hideSlots: ['head'],
    },
    body: {
      boneName: 'body',
      att: toAttachment(layout.body),
      scale: 1,
      rotationMode: 'bone',
      hideSlots: ['body'],
    },
    leg: {
      bones: [
        { boneName: 'leg1', att: legAtt },
        { boneName: 'leg2', att: legAtt },
        { boneName: 'leg3', att: legAtt },
        { boneName: 'leg4', att: legAtt },
      ],
      scale: 1,
      rotationMode: 'bone',
      hideSlots: ['leg', 'leg2', 'leg3', 'leg4'],
    },
    tail: {
      boneName: 'tail',
      att: toAttachment(layout.tail),
      scale: 1,
      rotationMode: 'bone',
      hideSlots: ['tail'],
    },
  };
}

export class CustomSkinSystem extends System {
  constructor(app) {
    super();
    this._app     = app;
    this._entries = [];
    this._active  = false;
    this._partMap = buildPartMap(getFallbackSkeletonLayout());
    this._loadLayout();
  }

  async _loadLayout() {
    const layout = await loadSkeletonLayout();
    this._partMap = buildPartMap(layout);
  }

  applyParts(catEntity, parts) {
    const spineComp = catEntity.get(SpineComponent);
    if (!spineComp?.instance) {
      console.warn('[CustomSkin] No Spine instance');
      return;
    }

    this._clearSprites();

    const instance = spineComp.instance;
    const skeleton = instance.skeleton;

    instance.sortableChildren = true;
    skeleton.slots.forEach(s => { s.color.a = 1; });

    const drawnParts = Object.entries(parts)
      .filter(([, canvas]) => this._hasContent(canvas));

    if (!drawnParts.length) { this._active = false; return; }

    // Ховаємо оригінальні слоти
    drawnParts.forEach(([partId]) => {
      const cfg = this._partMap[partId];
      if (!cfg) return;
      (cfg.hideSlots || []).forEach(slotName => {
        const slot = skeleton.findSlot(slotName);
        if (slot) slot.color.a = 0;
      });
    });

    // Створюємо спрайти
    drawnParts.forEach(([partId, canvas]) => {
      const cfg = this._partMap[partId];
      if (!cfg) return;

      const trim = this._trim(canvas);
      if (!trim) return;

      const texture = PIXI.Texture.from(trim.canvas);
      texture.baseTexture.update();

      if (cfg.bones) {
        cfg.bones.forEach(boneEntry => {
          const bone = skeleton.findBone(boneEntry.boneName);
          if (!bone) return;
          const sprite = this._makeSprite(texture, cfg, trim, boneEntry.att);
          sprite.zIndex = DRAW_ORDER[boneEntry.boneName] ?? 5;
          instance.addChild(sprite);
          this._entries.push({ sprite, bone, cfg, att: boneEntry.att });
        });
      } else {
        const bone = skeleton.findBone(cfg.boneName);
        if (!bone) return;
        const sprite = this._makeSprite(texture, cfg, trim, cfg.att);
        sprite.zIndex = DRAW_ORDER[cfg.boneName] ?? 5;
        instance.addChild(sprite);
        this._entries.push({ sprite, bone, cfg, att: cfg.att });
      }
    });

    this._active = this._entries.length > 0;
    console.log(`[CustomSkin] ${this._entries.length} sprites`);
  }

  reset(catEntity) {
    this._clearSprites();
    this._active = false;
    const spineComp = catEntity.get(SpineComponent);
    if (spineComp?.instance) {
      spineComp.instance.skeleton.slots.forEach(s => { s.color.a = 1; });
    }
  }

  update() {
    if (!this._active) return;

    for (const { sprite, bone, cfg, att } of this._entries) {
      // bone.a/b/c/d — transform матриця кістки (включає rotate + scale)
      // Вона трансформує attachment offset з bone-local в Spine world coords
      const a = bone.a ?? 1, b = bone.b ?? 0;
      const c = bone.c ?? 0, d = bone.d ?? 1;

      // Позиція = bone origin + attachment offset в world space
      // Все в Spine units — parent scale(0.5) конвертує в пікселі
      sprite.x = bone.worldX + att.x * a + att.y * b;
      sprite.y = bone.worldY + att.x * c + att.y * d;

      // Поворот кістки в градусах
      const boneRotDeg = Number.isFinite(bone.worldRotationX)
        ? bone.worldRotationX
        : Math.atan2(c, a) * (180 / Math.PI);

      const attRotRad = att.rotation * (Math.PI / 180);

      if (cfg.rotationMode === 'upright') {
        sprite.rotation = attRotRad;
      } else {
        sprite.rotation = boneRotDeg * (Math.PI / 180) + attRotRad;
      }

      sprite.visible = Number.isFinite(sprite.x) && Number.isFinite(sprite.y);
    }
  }

  _makeSprite(texture, cfg, trim, att) {
    const sprite = new PIXI.Sprite(texture);

    // Anchor: центр оригінального canvas в координатах обрізаного canvas
    const srcW = trim.sourceW;
    const srcH = trim.sourceH;
    sprite.anchor.set(
      Math.max(0, Math.min(1, (srcW / 2 - trim.minX) / trim.w)),
      Math.max(0, Math.min(1, (srcH / 2 - trim.minY) / trim.h)),
    );

    // Scale: attachment size (Spine units) / source canvas size (px)
    // Тому що parent має scale(0.5):
    //   screen px = (canvas px) * sprite.scale * 0.5
    //             = canvas px * (att.w / srcW) * 0.5
    //             = att.w * 0.5 screen px per Spine unit ✓
    const sx = (att.w / srcW) * (cfg.scale ?? 1);
    const sy = (att.h / srcH) * (cfg.scale ?? 1);
    sprite.scale.set(
      Math.min(8, Math.max(0.01, sx)),
      Math.min(8, Math.max(0.01, sy)),
    );

    return sprite;
  }

  _trim(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width: W, height: H } = canvas;
    const data = ctx.getImageData(0, 0, W, H).data;

    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;  if (y < y0) y0 = y;
          if (x > x1) x1 = x;  if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0) return null;

    const p = 2;
    x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p);
    x1 = Math.min(W - 1, x1 + p); y1 = Math.min(H - 1, y1 + p);

    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const out = document.createElement('canvas');
    out.width = tw; out.height = th;
    out.getContext('2d').drawImage(canvas, x0, y0, tw, th, 0, 0, tw, th);
    return { canvas: out, minX: x0, minY: y0, w: tw, h: th, sourceW: W, sourceH: H };
  }

  _hasContent(canvas) {
    try {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return d.some((v, i) => i % 4 === 3 && v > 0);
    } catch { return false; }
  }

  _clearSprites() {
    this._entries.forEach(({ sprite }) => {
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    });
    this._entries = [];
  }

  destroy() { this._clearSprites(); }
}