// ─────────────────────────────────────────────────────────────────
// CustomSkinSystem.js
//
// Накладає малюнки користувача на кістки Spine.
//
// Підхід: замість заміни Spine attachments (нестабільно між версіями)
// ми:
//   1. Ховаємо оригінальні слоти Spine
//   2. Створюємо PIXI.Sprite для кожної частини тіла
//   3. Кожен кадр синхронізуємо позицію/поворот спрайта з кісткою
//
// Чому це краще ніж замінювати attachment:
//   - Не залежить від внутрішнього Spine API (яке мінялось між версіями)
//   - Кожен спрайт незалежний — можна анімувати, масштабувати
//   - Легко вимкнути/увімкнути для preview
//   - Прозорість (alpha channel) малюнку зберігається
//
// Маппінг частин до кісток (назви з skeleton.json):
//   head → bone 'head'
//   body → bone 'body'
//   leg  → bones 'leg1', 'leg2', 'leg3', 'leg4'
//   tail → bone 'tail' (tail2 і tail3 теж рухаються але малюнок на tail)
// ─────────────────────────────────────────────────────────────────

import * as PIXI from 'pixi.js';
import { System }         from '../game/core/System.js';
import { SpineComponent } from '../entities/index.js';
import { CatComponent }   from '../entities/index.js';

// Маппінг: id частини → налаштування прив'язки до кістки
const PART_MAP = {
  head: {
    boneName: 'head',
    // Зміщення відносно кістки (підлаштуй якщо спрайт не там де треба)
    offsetX:  0,
    offsetY:  0,
    // Базовий поворот (якщо малюнок намальований горизонтально)
    baseRotation: 0,
    // Масштаб відносно розміру кістки
    scale: 0.6,
    // Слоти Spine що треба приховати
    hideSlots: ['head'],
  },
  body: {
    boneName: 'body',
    offsetX:  50,  // тіло зміщене вздовж кістки
    offsetY:  0,
    baseRotation: 0,
    scale: 0.5,
    hideSlots: ['body'],
  },
  leg: {
    // Лапка використовується для всіх чотирьох кісток
    boneNames: ['leg1', 'leg2', 'leg3', 'leg4'],
    offsetX:   18,
    offsetY:   0,
    baseRotation: Math.PI / 2, // лапки намальовані вертикально
    scale: 0.35,
    hideSlots: ['leg', 'leg2', 'leg3', 'leg4'],
  },
  tail: {
    boneName: 'tail',
    offsetX:  30,
    offsetY:  0,
    baseRotation: 0,
    scale: 0.4,
    hideSlots: ['tail'],
  },
};

export class CustomSkinSystem extends System {
  constructor(app) {
    super();
    this._app      = app;
    this._sprites  = []; // масив { sprite, bone, cfg }
    this._active   = false;
  }

  // Викликається з Game.js після завантаження малюнків
  // parts: { head: HTMLCanvasElement, body: ..., leg: ..., tail: ... }
  applyParts(catEntity, parts) {
    console.log('[CustomSkin] Applying user drawings to cat skeleton');

    const spine = catEntity.get(SpineComponent);
    if (!spine?.instance) {
      console.warn('[CustomSkin] No Spine instance found');
      return;
    }

    // Очищаємо попередні спрайти
    this._clearSprites();

    const skeleton  = spine.instance.skeleton;
    const container = spine.container;

    // Працюємо тільки з реально намальованими частинами.
    const drawableParts = Object.entries(parts).filter(([, canvas]) => this._hasContent(canvas));

    if (drawableParts.length === 0) {
      this._active = false;
      console.log('[CustomSkin] No non-empty parts to apply');
      return;
    }

    // Ховаємо оригінальні слоти
    this._hideOriginalSlots(skeleton, drawableParts.map(([partId]) => partId));

    // Для кожної намальованої частини створюємо спрайти
    drawableParts.forEach(([partId, canvas]) => {

      const cfg = PART_MAP[partId];
      if (!cfg) return;

      // Конвертуємо canvas в PIXI.Texture
      // canvas вже містить малюнок з прозорим фоном
      const texture = PIXI.Texture.from(canvas);
      console.log(`[CustomSkin] Created texture for '${partId}': ${canvas.width}×${canvas.height}`);

      if (cfg.boneNames) {
        // Кілька кісток (лапки)
        cfg.boneNames.forEach(boneName => {
          const bone = skeleton.findBone(boneName);
          if (!bone) {
            console.warn(`[CustomSkin] Bone '${boneName}' not found`);
            return;
          }
          const sprite = this._createSprite(texture, cfg, canvas);
          container.addChild(sprite);
          this._sprites.push({ sprite, bone, cfg, container });
        });
      } else {
        // Одна кістка
        const bone = skeleton.findBone(cfg.boneName);
        if (!bone) {
          console.warn(`[CustomSkin] Bone '${cfg.boneName}' not found`);
          return;
        }
        const sprite = this._createSprite(texture, cfg, canvas);
        container.addChild(sprite);
        this._sprites.push({ sprite, bone, cfg, container });
      }
    });

    this._active = this._sprites.length > 0;
    console.log(`[CustomSkin] ${this._sprites.length} sprites created`);
  }

  _createSprite(texture, cfg, canvas) {
    texture.baseTexture.update();
    const sprite = new PIXI.Sprite(texture);
    // Pivot в центрі спрайта — обертається навколо центру
    sprite.anchor.set(0.5, 0.5);
    // Масштаб відповідно до налаштувань частини
    const scaleX = (canvas.width  * cfg.scale) / canvas.width;
    const scaleY = (canvas.height * cfg.scale) / canvas.height;
    sprite.scale.set(scaleX, scaleY);
    return sprite;
  }

  _hideOriginalSlots(skeleton, partIds) {
    // Ховаємо слоти тільки для тих частин що намальовані
    partIds.forEach(partId => {
      const cfg = PART_MAP[partId];
      if (!cfg) return;

      const slotsToHide = cfg.hideSlots || [];
      slotsToHide.forEach(slotName => {
        const slot = skeleton.findSlot(slotName);
        if (slot) {
          // alpha = 0 ховає слот але зберігає анімацію кістки.
          slot.color.a = 0;
          console.log(`[CustomSkin] Hidden slot: ${slotName}`);
        }
      });
    });
  }

  _hasContent(canvas) {
    try {
      const ctx  = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some((v, i) => i % 4 === 3 && v > 0);
    } catch {
      return false;
    }
  }

  _clearSprites() {
    this._sprites.forEach(({ sprite, container }) => {
      container?.removeChild(sprite);
      sprite.destroy();
    });
    this._sprites = [];
  }

  // ── update: синхронізуємо спрайти з кістками ──────────────────────
  // Це серце системи. Кожен кадр ми читаємо world transform кістки
  // і застосовуємо до спрайту.
  //
  // bone.worldX/Y — позиція кістки в world координатах
  // bone.worldRotationX — поворот в градусах
  // bone.worldScaleX/Y — масштаб (якщо кістка масштабована анімацією)
  //
  // Але ці координати в просторі скелета, а наш контейнер може
  // мати свою позицію. Тому ми рахуємо відносно container.
update() {
  if (!this._active) return;

  for (const { sprite, bone, cfg } of this._sprites) {
    const s       = 0.5; // масштаб Spine instance
    const worldRot = bone.worldRotationX * (Math.PI / 180);
    const cosR    = Math.cos(worldRot);
    const sinR    = Math.sin(worldRot);

    // bone.worldX/Y → множимо на s щоб перевести в координати container
    sprite.x        = bone.worldX * s + (cosR * cfg.offsetX - sinR * cfg.offsetY);
    sprite.y        = bone.worldY * s + (sinR * cfg.offsetX + cosR * cfg.offsetY);
    sprite.rotation = worldRot + cfg.baseRotation;
  }
}

  // Скинути до оригінального скіна
  reset(catEntity) {
    this._clearSprites();
    this._active = false;

    const spine = catEntity.get(SpineComponent);
    if (!spine?.instance) return;

    // Відновлюємо слоти
    spine.instance.skeleton.slots.forEach(slot => {
      slot.color.a = 1;
    });
    console.log('[CustomSkin] Reset to original skin');
  }

  destroy() {
    this._clearSprites();
  }
}