// ─────────────────────────────────────────────────────────────────
// components/index.js
//
// Всі компоненти в одному файлі для простоти імпорту.
// Кожен — ТІЛЬКИ ДАНІ. Конструктор приймає початкові значення.
//
// Правило іменування:
//   Компонент описує ЩО entity МАЄ, не ЩО РОБИТЬ.
//   TransformComponent — entity має позицію
//   PhysicsComponent   — entity має фізику
//   НЕ: MovingComponent, FlyingComponent (це поведінка, не дані)
// ─────────────────────────────────────────────────────────────────

import { Component } from '../game/core/Component.js';
import { Entity } from '../game/core/Entity.js';
import { CONFIG } from '../config.js';
import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';

// ── Transform ─────────────────────────────────────────────────────
// Позиція, розмір, поворот. Є у КОЖНОГО видимого entity.
// PhysicsSystem читає і пише x/y.
// RenderSystem читає x/y/rotation для малювання.
export class TransformComponent extends Component {
  constructor({ x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1 } = {}) {
    super();
    this.x        = x;
    this.y        = y;
    this.rotation = rotation;
    this.scaleX   = scaleX;
    this.scaleY   = scaleY;
  }
}

// ── Physics ───────────────────────────────────────────────────────
// Швидкість і параметри фізики. PhysicsSystem читає і пише це.
// Є у кота і м'яча. НЕ у монети яка стоїть на місці.
export class PhysicsComponent extends Component {
  constructor({
    vx       = 0,
    vy       = 0,
    gravity  = 0.5,
    bounce   = 0.65,
    friction = 0.988,
  } = {}) {
    super();
    this.vx       = vx;
    this.vy       = vy;
    this.gravity  = gravity;
    this.bounce   = bounce;
    this.friction = friction;
    this.onGround = false; // оновлює PhysicsSystem
  }
}

// ── Collider ──────────────────────────────────────────────────────
// Форма для визначення зіткнень. CollisionSystem перевіряє entities
// що мають ColliderComponent між собою.
export class ColliderComponent extends Component {
  constructor({ radius = 20, type = 'circle' } = {}) {
    super();
    this.radius = radius;
    this.type   = type; // 'circle' | 'box' (поки підтримуємо circle)
  }
}

// ── Render ────────────────────────────────────────────────────────
// Що і як малювати. RenderSystem читає це і малює в Pixi.
// pixi — посилання на PIXI.Graphics або PIXI.Sprite (встановлює RenderSystem)
export class RenderComponent extends Component {
  constructor({ type = 'circle', color = 0xffffff, radius = 10 } = {}) {
    super();
    this.type   = type;   // 'circle' | 'sprite'
    this.color  = color;
    this.radius = radius;
    this.pixi   = null;   // PIXI об'єкт — додає RenderSystem при init
    this.shadow = null;   // тінь під об'єктом
  }
}

// ── Spine ─────────────────────────────────────────────────────────
// Дані для Spine анімації. AnimationSystem читає це.
// Є тільки у кота. М'яч його не має.
export class SpineComponent extends Component {
  constructor({ spineData } = {}) {
    super();
    this.spineData    = spineData;  // дані завантажені PIXI.Assets
    this.instance     = null;       // Spine instance (створює AnimationSystem)
    this.container    = null;       // PIXI.Container обгортка
    this.currentAnim  = null;       // ім'я поточної анімації
    this.floorOffset  = 0;          // відстань від root до низу (для вирівнювання)
  }
}

// ── Input ─────────────────────────────────────────────────────────
// Маркер що entity реагує на ввід гравця.
// InputSystem шукає entities з InputComponent і застосовує ввід.
// Без цього компонента entity ігнорується InputSystem.
export class InputComponent extends Component {
  constructor() {
    super();
    this.isSitting     = false;
    this.sitPending    = false; // черговий запит сісти/встати
    this.facingRight   = true;
  }
}

// ── Drag ──────────────────────────────────────────────────────────
// Додається коли entity захоплено мишею. DragSystem додає і видаляє
// цей компонент динамічно — це ключова перевага ECS:
// поведінка drag вмикається/вимикається без if/else в коді entity.
export class DragComponent extends Component {
  constructor({ offsetX = 0, offsetY = 0 } = {}) {
    super();
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.velX    = 0;
    this.velY    = 0;
    this.lastX   = 0;
    this.lastY   = 0;
  }
}

// ── Tilt ──────────────────────────────────────────────────────────
// Пружний нахил під час перетягування. DragSystem читає швидкість
// миші і застосовує нахил до container через цей компонент.
export class TiltComponent extends Component {
  constructor({ stiff = 0.15, damping = 0.75 } = {}) {
    super();
    this.angle   = 0;
    this.vel     = 0;
    this.stiff   = stiff;
    this.damping = damping;
  }
}

// ── Pet ───────────────────────────────────────────────────────────
// Entity можна гладити. PetSystem шукає entities з PetComponent
// і обробляє pointermove події.
export class PetComponent extends Component {
  constructor() {
    super();
    this.moveCount  = 0;    // накопичені рухи миші
    this.heartTimer = 0;    // лічильник для throttle сердечок
    this.isPurring  = false;
  }
}

// ── Ball marker ───────────────────────────────────────────────────
// Маркер що цей entity — м'яч. CollisionSystem використовує його
// щоб відрізнити м'яч від кота при обробці зіткнень.
// Не містить даних — просто тег.
export class BallComponent extends Component {}

// ── Cat marker ────────────────────────────────────────────────────
// Маркер що цей entity — кіт. Аналогічно BallComponent.
export class CatComponent extends Component {}

// ── Shake ─────────────────────────────────────────────────────────
// Ефект трясіння від акселерометра. ShakeSystem встановлює intensity,
// RenderSystem застосовує його як зміщення позиції.
export class ShakeComponent extends Component {
  constructor() {
    super();
    this.intensity = 0; // 0–1, декає кожен кадр
  }
}

// ── Heart (одноразовий ефект) ─────────────────────────────────────
// Entity що підіймається і зникає. Додається PetSystem динамічно.
// HeartSystem обробляє анімацію і видаляє entity після закінчення.
export class HeartComponent extends Component {
  constructor() {
    super();
    this.life = 1.0; // від 1 до 0, потім entity видаляється
  }
}

// ── Factories ─────────────────────────────────────────────────────
// Створюють готові ECS entities для Game.js
export const createBall = (app, dragSystem, x, y) => {
  const ball = new Entity('ball')
    .add(new BallComponent())
    .add(new TransformComponent({ x, y }))
    .add(new PhysicsComponent({
      vx: -2,
      vy: 0,
      gravity: CONFIG.BALL_GRAVITY,
      bounce: CONFIG.BALL_BOUNCE,
      friction: CONFIG.BALL_FRICTION,
    }))
    .add(new ColliderComponent({ radius: CONFIG.BALL_RADIUS }))
    .add(new RenderComponent({
      type: 'circle',
      color: CONFIG.BALL_COLOR,
      radius: CONFIG.BALL_RADIUS,
    }));

  const render = ball.get(RenderComponent);
  render.shadow = new PIXI.Graphics();
  render.pixi = new PIXI.Graphics();
  render.pixi.interactive = true;
  render.pixi.cursor = 'grab';
  render.pixi.hitArea = new PIXI.Circle(x, y, CONFIG.BALL_RADIUS * 1.5);
  render.pixi.on('pointerdown', (e) => dragSystem?.startDrag(ball, e));

  app.stage.addChild(render.shadow);
  app.stage.addChild(render.pixi);
  return ball;
};

export const createCat = (app, spineData, dragSystem, petSystem) => {
  const cat = new Entity('cat')
    .add(new CatComponent())
    .add(new TransformComponent({
      x: CONFIG.WIDTH / 2,
      y: CONFIG.FLOOR_Y,
      scaleX: 1,
      scaleY: 1,
    }))
    .add(new PhysicsComponent({
      gravity: CONFIG.GRAVITY,
      bounce: 0,
      friction: 0.9,
    }))
    .add(new InputComponent())
    .add(new SpineComponent({ spineData }))
    .add(new TiltComponent())
    .add(new PetComponent())
    .add(new ShakeComponent());

  const spineComp = cat.get(SpineComponent);
  const instance = new Spine(spineData);
  instance.scale.set(0.5);
  instance.interactive = true;
  instance.interactiveChildren = false;
  instance.cursor = 'grab';
  instance.hitArea = new PIXI.Rectangle(-150, -300, 300, 350);
  instance.state.setAnimation(0, CONFIG.ANIM.STAND, true);

  const container = new PIXI.Container();
  container.addChild(instance);

  // Вирівнюємо кота так, щоб нижня частина сітки стояла на підлозі.
  instance.skeleton.setToSetupPose();
  instance.skeleton.updateWorldTransform();
  const bounds = instance.getLocalBounds();
  const floorOffset = bounds.y + bounds.height;

  const tf = cat.get(TransformComponent);
  tf.y = CONFIG.FLOOR_Y - floorOffset * Math.abs(instance.scale.y);
  container.x = tf.x;
  container.y = tf.y;

  spineComp.instance = instance;
  spineComp.container = container;
  spineComp.floorOffset = floorOffset;
  spineComp.currentAnim = CONFIG.ANIM.STAND;

  // Drag + petting події на самому Spine вузлі.
  instance.on('pointerdown', (e) => dragSystem?.startDrag(cat, e));
  instance.on('pointermove', () => petSystem?.onPetMove(cat));

  app.stage.addChild(container);
  return cat;
};


