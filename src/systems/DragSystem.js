// ─────────────────────────────────────────────────────────────────
// DragSystem.js
//
// Обробляє перетягування мишею. Використовує динамічне додавання
// DragComponent — ключова перевага ECS над звичайним підходом.
//
// Коли entity захоплено:
//   entity.add(new DragComponent(...))
//   PhysicsSystem бачить DragComponent і пропускає цей entity
//   DragSystem сам оновлює позицію
//
// Коли entity відпущено:
//   entity.remove(DragComponent)
//   PhysicsSystem знову обробляє його (кидок)
//
// Це чистіше ніж if (isDragging) {...} в PhysicsSystem бо:
//   PhysicsSystem не знає про drag взагалі
//   Поведінка drag вмикається компонентом, а не прапором
// ─────────────────────────────────────────────────────────────────

import { System }             from '../game/core/System.js';
import { TransformComponent } from '../entities/index.js';
import { DragComponent }      from '../entities/index.js';
import { PhysicsComponent }   from '../entities/index.js';
import { TiltComponent }      from '../entities/index.js';
import { InputComponent }     from '../entities/index.js';
import { SpineComponent }     from '../entities/index.js';
import { CatComponent }     from '../entities/index.js';

export class DragSystem extends System {
  constructor(app, audioSystem = null) {
    super();
    this._audio = audioSystem;
    this._app      = app;
    this._mouseX   = 0;
    this._mouseY   = 0;
    this._deltaX   = 0;
    this._deltaY   = 0;
    this._lastX    = 0;
    this._lastY    = 0;

    this._onMove = this._onMove.bind(this);
    this._onUp   = this._onUp.bind(this);
  }

  init() {
    // Stage-level events щоб drag працював навіть якщо миша
    // рухається швидше ніж спрайт
    this._app.stage.interactive = true;
    this._app.stage.on('pointermove', this._onMove);
    this._app.stage.on('pointerup',   this._onUp);
    console.log('[DragSystem] Stage pointer events registered');
  }

  // Викликається коли гравець натискає на entity
  // entity — той на кого натиснули, e — Pixi pointer event
  startDrag(entity, e) {
    const tf = entity.get(TransformComponent);

    // Сидячого кота не тягнемо
    if (entity.has(InputComponent) && entity.get(InputComponent).isSitting) {
      return;
    }

    const ox = tf.x - e.data.global.x;
    const oy = tf.y - e.data.global.y;

    entity.add(new DragComponent({ offsetX: ox, offsetY: oy }));
    const drag = entity.get(DragComponent);
    drag.lastX = e.data.global.x;
    drag.lastY = e.data.global.y;

    // Якщо є Spine — pivot вгору щоб кіт "висів"
    if (entity.has(SpineComponent)) {
      const spine = entity.get(SpineComponent);
      if (spine.instance) {
        spine.container.pivot.set(0, -100);
      }
    }

    console.log(`[DRAG] Started on ${entity.name}`);
  if (entity.has(CatComponent)) this._audio?.playMeow();
  }

  update() {
    const dragged = this.world.query(DragComponent, TransformComponent);

    for (const entity of dragged) {
      const drag = entity.get(DragComponent);
      const tf   = entity.get(TransformComponent);

      // Оновлюємо позицію за мишею
      tf.x = this._mouseX + drag.offsetX;
      tf.y = this._mouseY + drag.offsetY;

      // Нахил від швидкості миші
      if (entity.has(TiltComponent)) {
        const tilt = entity.get(TiltComponent);
        const target = this._deltaX * 0.04;
        tilt.vel    += (target - tilt.angle) * tilt.stiff;
        tilt.vel    *= tilt.damping;
        tilt.angle  += tilt.vel;
        tilt.angle   = Math.max(-0.6, Math.min(0.6, tilt.angle));
      }
    }
  }

  _onMove(e) {
    this._deltaX = e.data.global.x - this._lastX;
    this._deltaY = e.data.global.y - this._lastY;
    this._lastX  = e.data.global.x;
    this._lastY  = e.data.global.y;
    this._mouseX = e.data.global.x;
    this._mouseY = e.data.global.y;

    // Оновлюємо DragComponent для velocity при відпусканні
    const dragged = this.world.query(DragComponent);
    for (const entity of dragged) {
      const drag = entity.get(DragComponent);
      drag.velX  = this._deltaX;
      drag.velY  = this._deltaY;
    }
  }

  _onUp() {
    const dragged = this.world.query(DragComponent, PhysicsComponent);

    for (const entity of dragged) {
      const drag = entity.get(DragComponent);
      const phys = entity.get(PhysicsComponent);

      // Кидаємо з інерцією
      phys.vx = drag.velX * 0.5;
      phys.vy = drag.velY * 0.5;
      phys.onGround = false;

      // Скидаємо pivot і нахил
      if (entity.has(TiltComponent)) {
        const tilt    = entity.get(TiltComponent);
        tilt.angle    = 0;
        tilt.vel      = 0;
      }
      if (entity.has(SpineComponent)) {
        const spine = entity.get(SpineComponent);
        if (spine.container) spine.container.pivot.set(0, 0);
      }

      entity.remove(DragComponent);
      console.log(`[DRAG] Released ${entity.name} — vx=${phys.vx.toFixed(1)}, vy=${phys.vy.toFixed(1)}`);
    }
  }

  destroy() {
    this._app.stage.off('pointermove', this._onMove);
    this._app.stage.off('pointerup',   this._onUp);
  }
}
