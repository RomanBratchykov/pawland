import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
 
// ─────────────────────────────────────────────────────────────────
// CONFIG
// All magic numbers in one place so they're easy to tweak.
// ─────────────────────────────────────────────────────────────────
const CONFIG = {
  WIDTH:  800,
  HEIGHT: 600,
  BG_COLOR: 0x1a1a2e,
 
  MOVE_SPEED: 3,
 
  JUMP_FORCE_VERTICAL: 14,   // higher = taller jump when standing still
  JUMP_FORCE_FORWARD:  10,   // lower because horizontal momentum already adds distance
  JUMP_HORIZONTAL:      4,   // how much horizontal speed is added on a running jump
 
  GRAVITY: 0.5,
  FLOOR_Y: 540,
 
  // ── Animation names ──────────────────────────────────────────
  // These must match exactly what you named them in Spine Editor.
  // Track 0 = body, Track 1 = head (allows mixing)
  ANIM: {
    STAND:         'stand',
    WALK:          'walk',
    JUMP_VERTICAL: 'jump_vertical',
    JUMP_FORWARD:  'jump_vertical', // replace with 'jump_forward' if you make one
    SIT:           'sit',
    PET:           'sitpet',           // replace with 'pet' if you make a separate one
  },
 
  // ── Petting ───────────────────────────────────────────────────
  PET_MOVE_THRESHOLD: 4,   // mouse moves over cat needed to count as one "stroke"
  HEART_INTERVAL:     8,   // ticker frames between hearts spawning
  PURR_VOLUME:        0.4,
};
 
// ─────────────────────────────────────────────────────────────────
// HEART FACTORY
// Creates a floating heart that rises and fades — pure PIXI.Graphics,
// no external assets needed.
// ─────────────────────────────────────────────────────────────────
const spawnHeart = (app, x, y) => {
  const g = new PIXI.Graphics();
  g.beginFill(0xff6b9d);
  g.moveTo(0, -8);
  g.bezierCurveTo( 8, -16,  18, -6, 0,  8);
  g.bezierCurveTo(-18, -6, -8, -16, 0, -8);
  g.endFill();
  g.x     = x + (Math.random() * 40 - 20); // slight random spread
  g.y     = y;
  g.alpha = 1;
  app.stage.addChild(g);
 
  let life = 1;
  const rise = () => {
    g.y     -= 1.5;
    g.alpha -= 0.012;
    g.scale.set(g.scale.x + 0.008);
    life    -= 0.012;
    if (life <= 0) {
      app.ticker.remove(rise);
      app.stage.removeChild(g);
    }
  };
  app.ticker.add(rise);
};
 
// ─────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────
const Game = () => {
  const canvasRef     = useRef(null);
  const appRef        = useRef(null);
  const isInitialized = useRef(false);
 
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;
 
    console.log('[INIT] Starting game initialization');
 
    // ── Purr audio ────────────────────────────────────────────────
    // Created outside the loader so it's ready as soon as user interacts.
    const purr = new Audio('/assets/purr.mp3');
    purr.loop   = true;
    purr.volume = CONFIG.PURR_VOLUME;
 
    // ── Input ─────────────────────────────────────────────────────
    const keys = new Set();
 
    // We track whether Ctrl was *just* pressed (not held) using a flag.
    // Without this, holding Ctrl would toggle sit on every frame.
    let ctrlConsumed = false;
 
    const onKeyDown = (e) => {
      keys.add(e.code);
      if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && !ctrlConsumed) {
        ctrlConsumed = true;
        console.log('[INPUT] Ctrl pressed — will toggle sit on next tick');
      }
      // Prevent browser shortcuts (Ctrl+S etc.) from firing while playing
      if (e.ctrlKey) e.preventDefault();
    };
    const onKeyUp = (e) => {
      keys.delete(e.code);
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        ctrlConsumed = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
 
    // ── PixiJS app ────────────────────────────────────────────────
    const app = new PIXI.Application({
      width:           CONFIG.WIDTH,
      height:          CONFIG.HEIGHT,
      backgroundColor: CONFIG.BG_COLOR,
      view:            canvasRef.current,
      antialias:       true,
    });
    appRef.current = app;
    console.log('[PIXI] Application created, WebGL renderer ready');
 
    // Background
    const bg = new PIXI.Graphics();
    bg.beginFill(CONFIG.BG_COLOR);
    bg.drawRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    bg.endFill();
    app.stage.addChild(bg);
 
    // Floor
    const floor = new PIXI.Graphics();
    floor.beginFill(0x16213e);
    floor.drawRect(0, CONFIG.FLOOR_Y, CONFIG.WIDTH, CONFIG.HEIGHT - CONFIG.FLOOR_Y);
    floor.endFill();
    app.stage.addChild(floor);
 
    // ── Load Spine ────────────────────────────────────────────────
    app.loader
      .add('skeleton', '/assets/skeleton.json')
      .load((loader, resources) => {
        console.log('[SPINE] Assets loaded, creating skeleton');
 
        const character = new Spine(resources.skeleton.spineData);
        character.scale.set(0.5);
        character.interactive          = true;
        character.interactiveChildren  = false;
        character.cursor               = 'grab';
 
        // hitArea must be set manually — Spine meshes have no automatic bounds.
        // Rectangle is in local (pre-scale) coordinates.
        character.hitArea = new PIXI.Rectangle(-150, -300, 300, 350);
        console.log('[SPINE] hitArea set manually (Spine has no auto bounds)');
 
        // Wrap character in a container so we can apply rotation/tilt
        // to the whole cat without touching the Spine object's own transform.
        const container = new PIXI.Container();
        container.addChild(character);
        app.stage.addChild(container);
 
        // ── Ground alignment ──────────────────────────────────────
        // Spine's root bone offset shifts the visual differently from
        // what you'd expect. We read bounds from setup pose (no animation)
        // to get the true resting bottom edge, then pin that to FLOOR_Y.
        character.skeleton.setToSetupPose();
        character.skeleton.updateWorldTransform();
        const bounds      = character.getLocalBounds();
        const floorOffset = bounds.y + bounds.height;
        container.x       = CONFIG.WIDTH / 2;
        container.y       = CONFIG.FLOOR_Y - floorOffset * Math.abs(character.scale.y);
        character.x       = 0;
        character.y       = 0;
        console.log(`[SPINE] Ground aligned: container.y = ${container.y.toFixed(1)}, floorOffset = ${floorOffset.toFixed(1)}`);
 
        // Start idle animation
        character.state.setAnimation(0, CONFIG.ANIM.STAND, true);
        console.log(`[ANIM] Track 0 started: ${CONFIG.ANIM.STAND}`);
 
        // ── State variables ───────────────────────────────────────
        let currentAnim    = CONFIG.ANIM.STAND;
        let velocityY      = 0;
        let velocityX      = 0;
        let isOnGround     = true;
        let facingRight    = true;
 
        // ── Sit state ─────────────────────────────────────────────
        let isSitting      = false;
 
        // ── Petting state ─────────────────────────────────────────
        // petMoveCount accumulates raw pointermove events over the cat.
        // Every PET_MOVE_THRESHOLD moves = one "stroke" = one heart.
        // This prevents a heart spawning on every single pixel of mouse movement.
        let petMoveCount   = 0;
        let isPurring      = false;
        let heartTickCount = 0;
 
        // ── Tilt physics (used during drag) ───────────────────────
        // We apply rotation to the container, not the character,
        // so it doesn't interfere with Spine's bone transforms.
        const tilt = { angle: 0, vel: 0, stiff: 0.15, damping: 0.75 };
 
        // ── Drag state ────────────────────────────────────────────
        const drag = {
          active:  false,
          offsetX: 0,
          offsetY: 0,
          velX:    0,
          velY:    0,
          lastX:   0,
          lastY:   0,
        };
 
        // ── Anim helpers ──────────────────────────────────────────
        // Guard prevents restarting the same animation every frame,
        // which would reset it to frame 0 constantly.
        const setAnim = (name, loop = true) => {
          if (currentAnim === name) return;
          console.log(`[ANIM] Track 0: ${currentAnim} → ${name} (loop: ${loop})`);
          character.state.setAnimation(0, name, loop);
          currentAnim = name;
        };
 
        // ── Petting helpers ───────────────────────────────────────
        const startPurr = () => {
          if (isPurring) return;
          isPurring = true;
          purr.currentTime = 0;
          purr.play().catch(() => {});
          console.log('[PET] Purring started');
        };
 
        const stopPurr = () => {
          if (!isPurring) return;
          isPurring = false;
          purr.pause();
          purr.currentTime = 0;
          console.log('[PET] Purring stopped');
        };
 
        // ── Pointer events ────────────────────────────────────────
 
        // pointerdown: sitting → start pet anim / standing → start drag
        character.on('pointerdown', (e) => {
          if (isSitting) {
            console.log('[INPUT] Clicked sitting cat — entering pet mode');
            setAnim(CONFIG.ANIM.PET, true);
            startPurr();
            return;
          }
          // Drag
          drag.active  = true;
          drag.offsetX = container.x - e.data.global.x;
          drag.offsetY = container.y - e.data.global.y;
          drag.lastX   = e.data.global.x;
          drag.lastY   = e.data.global.y;
          drag.velX    = 0;
          drag.velY    = 0;
          isOnGround   = false;
          velocityY    = 0;
          character.cursor = 'grabbing';
          character.pivot.set(0, bounds.y); // pivot at top so cat hangs down
          console.log('[DRAG] Started drag, pivot set to top of skeleton');
        });
 
        // pointermove on the cat itself — counts petting strokes
        character.on('pointermove', () => {
          if (!isSitting) return;
          petMoveCount++;
          if (petMoveCount >= CONFIG.PET_MOVE_THRESHOLD) {
            petMoveCount = 0;
            heartTickCount++;
            // Throttle hearts so they don't spawn every threshold
            if (heartTickCount % CONFIG.HEART_INTERVAL === 0) {
              const hx = container.x;
              const hy = container.y - 170 * Math.abs(character.scale.y);
              spawnHeart(app, hx, hy);
              console.log('[PET] Heart spawned');
            }
            startPurr();
          }
        });
 
        // pointerout — stop purring when mouse leaves the cat while sitting
        character.on('pointerout', () => {
          if (isSitting && isPurring) {
            stopPurr();
            console.log('[PET] Mouse left cat — purring paused');
          }
        });
 
        // Stage-level move and up — needed so drag doesn't break
        // if mouse moves faster than the cat sprite
        app.stage.interactive = true;
 
        app.stage.on('pointermove', (e) => {
          if (!drag.active) return;
          drag.velX   = e.data.global.x - drag.lastX;
          drag.velY   = e.data.global.y - drag.lastY;
          drag.lastX  = e.data.global.x;
          drag.lastY  = e.data.global.y;
          container.x = e.data.global.x + drag.offsetX;
          container.y = e.data.global.y + drag.offsetY;
        });
 
        app.stage.on('pointerup', () => {
          if (!drag.active) return;
          drag.active      = false;
          character.cursor = 'grab';
          character.pivot.set(0, 0);
          tilt.angle         = 0;
          tilt.vel           = 0;
          container.rotation = 0;
          // Throw the cat with mouse velocity
          velocityX = drag.velX * 0.5;
          velocityY = drag.velY * 0.5;
          isOnGround = false;
          console.log(`[DRAG] Released — throw velocity: vx=${velocityX.toFixed(1)}, vy=${velocityY.toFixed(1)}`);
        });
 
        // ── Root bone lock ────────────────────────────────────────
        // The walk animation has a root.translate.y = -11.61 which
        // physically lifts the whole skeleton every frame.
        // We clamp it to 0 after Spine updates to prevent vertical drift.
        const rootBone = character.skeleton.getRootBone();
 
        // ── Main ticker ───────────────────────────────────────────
        app.ticker.add(() => {
          const movingLeft  = keys.has('KeyA') || keys.has('ArrowLeft');
          const movingRight = keys.has('KeyD') || keys.has('ArrowRight');
          const jumpPressed = keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp');
 
          // ── Ctrl: toggle sit ──────────────────────────────────
          // Only toggle when on the ground — no sitting mid-air.
          if (ctrlConsumed && isOnGround && !drag.active) {
            ctrlConsumed = false; // consume so it only fires once per press
            isSitting    = !isSitting;
            if (isSitting) {
              setAnim(CONFIG.ANIM.SIT, true);
              console.log('[STATE] Cat sat down — movement locked');
            } else {
              setAnim(CONFIG.ANIM.STAND, true);
              stopPurr();
              petMoveCount   = 0;
              heartTickCount = 0;
              console.log('[STATE] Cat stood up — movement unlocked');
            }
          }
 
          // ── Sitting mode ──────────────────────────────────────
          // When sitting: block all movement, allow only petting.
          if (isSitting) {
            // Sitting cat can't do anything via keyboard
            // (petting is handled by pointer events above)
            rootBone.y = 0;
            return;
          }
 
          // ── Moving restriction ────────────────────────────────
          // When the cat is walking on the ground, the only other
          // allowed action is jump. No sitting, no dragging.
        //   const isWalking = isOnGround && (movingLeft || movingRight);
 
          // ── Drag mode ─────────────────────────────────────────
          if (!drag.active) {
 
            // Tilt returns to 0 when not dragging
            tilt.vel   += (0 - tilt.angle) * tilt.stiff;
            tilt.vel   *= tilt.damping;
            tilt.angle += tilt.vel;
            container.rotation = tilt.angle;
 
            // ── Direction flip ──────────────────────────────────
            // Only flip on the ground — mid-air flip looks unnatural
            if (isOnGround) {
              if (movingRight && !facingRight) {
                facingRight       = true;
                character.scale.x = Math.abs(character.scale.x);
                console.log('[MOVE] Flipped right');
              } else if (movingLeft && facingRight) {
                facingRight       = false;
                character.scale.x = -Math.abs(character.scale.x);
                console.log('[MOVE] Flipped left');
              }
            }
 
            // ── Horizontal movement ──────────────────────────────
            if (isOnGround) {
              if (movingLeft)  container.x -= CONFIG.MOVE_SPEED;
              if (movingRight) container.x += CONFIG.MOVE_SPEED;
            } else {
              // In the air: only the initial jump impulse moves the cat.
              // For VERTICAL jump: velocityX = 0, so no drift.
              // For FORWARD jump: velocityX carries momentum.
              // Additionally, after a vertical jump the player CAN
              // steer slightly by holding A/D — this adds a small force.
              if (movingLeft)  velocityX = Math.max(velocityX - 0.3, -CONFIG.MOVE_SPEED);
              if (movingRight) velocityX = Math.min(velocityX + 0.3,  CONFIG.MOVE_SPEED);
              container.x += velocityX;
              velocityX   *= 0.97; // air friction
            }
 
            // Clamp to canvas
            container.x = Math.max(0, Math.min(CONFIG.WIDTH, container.x));
 
            // ── Jump ─────────────────────────────────────────────
            // Jump is allowed even while walking (see restriction comment above).
            if (jumpPressed && isOnGround) {
              isOnGround = false;
              const isRunning = movingLeft || movingRight;
              if (isRunning) {
                velocityY = -CONFIG.JUMP_FORCE_FORWARD;
                velocityX = facingRight ? CONFIG.JUMP_HORIZONTAL : -CONFIG.JUMP_HORIZONTAL;
                setAnim(CONFIG.ANIM.JUMP_FORWARD, false);
                console.log(`[JUMP] Forward jump — vy=${velocityY}, vx=${velocityX}`);
              } else {
                velocityY = -CONFIG.JUMP_FORCE_VERTICAL;
                velocityX = 0;
                // velocityX starts at 0 but player can steer in air (see above)
                setAnim(CONFIG.ANIM.JUMP_VERTICAL, false);
                console.log(`[JUMP] Vertical jump — vy=${velocityY} (air steering enabled)`);
              }
            }
 
            // ── Gravity ───────────────────────────────────────────
            if (!isOnGround) {
              velocityY   += CONFIG.GRAVITY;
              container.y += velocityY;
              if (container.y >= container._groundY) {
                container.y = container._groundY;
                velocityY   = 0;
                velocityX   = 0;
                isOnGround  = true;
                console.log('[PHYSICS] Landed');
              }
            }
 
            // ── Animation selection ───────────────────────────────
            if (isOnGround) {
              const isMoving = movingLeft || movingRight;
              setAnim(isMoving ? CONFIG.ANIM.WALK : CONFIG.ANIM.STAND);
            }
 
          } else {
            // ── Drag tilt ─────────────────────────────────────────
            const targetTilt = drag.velX * 0.04;
            tilt.vel   += (targetTilt - tilt.angle) * tilt.stiff;
            tilt.vel   *= tilt.damping;
            tilt.angle += tilt.vel;
            tilt.angle  = Math.max(-0.6, Math.min(0.6, tilt.angle));
            container.rotation = tilt.angle;
            setAnim(CONFIG.ANIM.STAND);
          }
 
          // Lock root bone Y — prevents walk animation from
          // physically moving the character upward each frame
          rootBone.y = 0;
        });
 
        // Store groundY on container for use inside ticker
        container._groundY = container.y;
        console.log(`[INIT] Ground Y stored: ${container._groundY.toFixed(1)}`);
        console.log('[INIT] All systems ready. Controls: A/D move, W/Space jump, Ctrl sit, drag to throw, pet while sitting');
      });
 
    return () => {
      console.log('[CLEANUP] Destroying Pixi app and removing listeners');
      purr.pause();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      isInitialized.current = false;
    };
  }, []);
 
  return (
    <div style={styles.wrapper}>
      <h1 style={styles.title}>Cat Game</h1>
      <div style={styles.canvasWrapper}>
        <canvas ref={canvasRef} />
      </div>
      <div style={styles.hud}>
        {[
          { key: 'A / D',  hint: 'move'      },
          { key: 'W',      hint: 'jump'       },
          { key: 'Ctrl',   hint: 'sit / stand'},
          { key: '🖱 drag', hint: 'throw'     },
          { key: '🖱 sit',  hint: 'pet + purr'},
        ].map(({ key, hint }) => (
          <div key={key} style={styles.keyGroup}>
            <span style={styles.key}>{key}</span>
            <span style={styles.hint}>{hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
 
const styles = {
  wrapper: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    minHeight:      '100vh',
    background:     '#0f0f1a',
    fontFamily:     '"Courier New", monospace',
    gap:            '16px',
  },
  title: {
    color:         '#e0e0ff',
    fontSize:      '1.4rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    margin:        0,
    opacity:       0.7,
  },
  canvasWrapper: {
    border:       '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    overflow:     'hidden',
    boxShadow:    '0 0 40px rgba(80,80,200,0.15)',
  },
  hud: {
    display:        'flex',
    alignItems:     'center',
    gap:            '20px',
    flexWrap:       'wrap',
    justifyContent: 'center',
  },
  keyGroup: {
    display:    'flex',
    alignItems: 'center',
    gap:        '6px',
  },
  key: {
    display:       'inline-block',
    padding:       '4px 10px',
    background:    'rgba(255,255,255,0.08)',
    border:        '1px solid rgba(255,255,255,0.2)',
    borderRadius:  '4px',
    color:         '#c0c0ff',
    fontSize:      '0.85rem',
    fontWeight:    'bold',
    letterSpacing: '0.05em',
  },
  hint: {
    color:    'rgba(200,200,255,0.4)',
    fontSize: '0.8rem',
  },
};
 
export default Game;