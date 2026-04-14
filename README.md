# Cat Game

Cat character creator + Spine-based room game with:

- registration/login (Supabase Auth)
- saved cat per user in PostgreSQL (Supabase DB)
- online room presence (Supabase Realtime)

## Stack

- React + Vite
- PixiJS + pixi-spine
- Supabase (`@supabase/supabase-js`)
- PostgreSQL (managed by Supabase)

## 1) Install

```bash
npm install
```

## 2) Configure environment

Create `.env` (or copy `.env.example`) and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEFAULT_ROOM=main
```

## 3) Create backend schema

Run SQL scripts in Supabase SQL Editor:

1. `backend/sql/001_schema.sql`
2. `backend/sql/002_realtime.sql`

Extra details are in `backend/README.md`.

## 4) Run locally

```bash
npm run dev
```

Flow:

1. register/login
2. create cat in character creator
3. save and enter room
4. players in same room can see each other in realtime

## 5) Production build

```bash
npm run build
npm run preview
```

## Notes

- Character creator supports uploaded part images and stores selected/generated skin parts.
- Spine part placement is driven from `public/assets/skeleton.json` attachment layout with fallback values.
- Realtime room currently uses a shared channel (`cat-room-main`).
