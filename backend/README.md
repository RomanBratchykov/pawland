# Backend Setup (Supabase + PostgreSQL)

This project uses Supabase as the backend platform and PostgreSQL as the database engine.

## 1) Create a Supabase project

1. Open https://supabase.com and create a project.
2. Copy the values from `Project Settings -> API`:
   - Project URL
   - Anon (public) key

## 2) Run SQL schema

In `SQL Editor`, run scripts in this order:

1. `backend/sql/001_schema.sql`
2. `backend/sql/002_realtime.sql`

## 3) Configure frontend env

Copy values into `.env` in project root:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then restart `npm run dev`.

## What this schema gives you

- `profiles` table: one profile per auth user.
- `cats` table: one saved cat per user (name, editor config, selected/uploaded parts, generated skin parts).
- RLS policies: users can only read and write their own rows.
- Realtime enabled for `cats` table (optional for future room features).

## Notes

- Authentication is handled by Supabase Auth (`auth.users`).
- The frontend joins an online room using Supabase Realtime Presence (`cat-room-main` channel).
- Presence state is ephemeral and not permanently stored in PostgreSQL.
