# Pawland

https://cat-game-iota.vercel.app/
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
# Optional: only needed when you want a fixed confirmation redirect URL
VITE_AUTH_REDIRECT_TO=http://localhost:5173
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

## Troubleshooting Signup: "Error sending confirmation email"

If signup fails with `Error sending confirmation email`, the issue is in Supabase Auth email configuration.

1. Open Supabase Dashboard -> Authentication -> Providers -> Email.
2. For local development, disable `Confirm email` so signup returns a session immediately.
3. If you need confirmation emails, configure SMTP in Authentication -> Settings -> SMTP.
4. In Authentication URL settings, make sure your Site URL and Redirect URLs include your local URL (for example `http://localhost:5173`) and your production URL.

Optional:

- Set `VITE_AUTH_REDIRECT_TO` to a URL that is already allowed in Supabase Redirect URLs.
