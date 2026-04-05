import * as PIXI from 'pixi.js';
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
import { createCat, createBall } from '../entities/index.js';

export class Game {
  constructor(canvas) {
    console.log('[Game] Initializing...');

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
        this._catEntity = createCat(this._app, resources.skeleton.spineData, dragSystem, petSystem);
        this._world.addEntity(this._catEntity);

        const ball = createBall(this._app, dragSystem, CONFIG.WIDTH * 0.7, CONFIG.FLOOR_Y - 20);
        this._world.addEntity(ball);

        this._app.ticker.add(delta => this._world.tick(delta));
        console.log('[Game] Ready!');

        // Застосовуємо відкладений скін якщо є
        if (this._pendingSkin) {
          this._customSkin.applyParts(this._catEntity, this._pendingSkin);
          this._pendingSkin = null;
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

  addEntity(entity) { return this._world.addEntity(entity); }

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
    this._world.destroy();
    this._app.destroy(true, { children: true, texture: true });
  }
}
