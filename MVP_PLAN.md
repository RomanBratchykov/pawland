# Cat Game MVP Plan

## Goal
Build a playable vertical slice where player:
1. creates a kitten skin in editor,
2. enters existing game scene with that skin,
3. can return and redesign kitten.

## Scope In This Iteration
- Replace free-draw editor with a guided kitten builder.
- Keep compatibility with existing `CustomSkinSystem` (`head/body/leg/tail`).
- Persist last selected kitten config in `localStorage`.
- Preserve current game world and controls.

## Delivered In Code
- New kitten builder UI with:
  - preset palettes,
  - fur/belly/pattern/eyes/ear color controls,
  - pattern type and eye style,
  - toggles for socks and tail tip,
  - randomizer and reset.
- Procedural canvas generation for all skin parts.
- Part preview grid that shows what will be applied to Spine.
- `Play as this kitten` action calls existing flow and starts game with generated skin.

## Next MVP Milestones

### Milestone 1: Scene Data Layer
- Move hardcoded scene objects into JSON.
- Introduce `SceneLoader` to spawn background, floor bounds, interactables.

### Milestone 2: Dialogue + Quests
- Add minimal dialogue JSON format (`nodes`, `choices`, `flags`).
- Add simple quest flags and one puzzle chain.

### Milestone 3: Save/Load
- Start with local save (`position`, `sceneId`, `kittenConfig`, `questFlags`).
- Add cloud sync later (Supabase free tier).

### Milestone 4: Multiplayer Room (Apartment)
- Separate "story" mode from "apartment" mode.
- Realtime presence (position, skin, emotes) in one shared room.
- Keep story logic single-player for deterministic behavior.

## Acceptance Criteria
- Editor loads instantly and produces non-empty canvases for all 4 parts.
- Pressing Play always opens game and applies generated kitten skin.
- Returning to editor preserves last config.
