-- 북극성 자산운용 — Supabase 스키마 (다중 사용자 · 다중 가입)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 인증(이메일/비밀번호)은 Supabase Auth가 담당하고, 아래 테이블이 프로필·계정·상품·자산점검을 저장합니다.
--
-- ⚠️ 데모용 스키마입니다. 구버전(1인 1계정) accounts 테이블이 있으면 먼저 drop 후 재실행하세요:
--    drop table if exists public.accounts cascade;

-- ── 프로필(이름/권한) ──────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  role        text not null default 'customer',   -- 'customer' | 'admin'
  created_at  timestamptz not null default now()
);

-- ── 투자 계정(가입 1건 = 1행, 한 고객이 여러 행 보유 가능) ──────
create table if not exists public.accounts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  text,
  name        text,             -- 가입 시점 상품 메타 스냅샷
  target      text,
  mid         numeric,
  risk        int,
  seed        numeric,
  start_date  date,
  holdings    jsonb,            -- [{market,code,label,weight,units,entry}]
  source      text not null default 'direct',   -- 'direct' | 'converted'
  created_at  timestamptz not null default now()
);
create index if not exists accounts_user_idx on public.accounts(user_id);

-- ── 커스텀 상품(관리자가 추가) ─────────────────────────────────
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  tag         text,
  target      text,
  mid         numeric,
  risk        int,
  descr       text,
  holdings    jsonb,            -- [{market,code,label,weight}]
  created_at  timestamptz not null default now()
);

-- ── 자산 점검 스냅샷(미가입/전환용, 사용자당 1행) ──────────────
create table if not exists public.snapshots (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  assets      jsonb,            -- [{label,market,amount,ret}]
  updated_at  timestamptz not null default now()
);

alter table public.profiles  enable row level security;
alter table public.accounts  enable row level security;
alter table public.products  enable row level security;
alter table public.snapshots enable row level security;

-- ── 관리자 판별 (security definer → RLS 우회로 재귀 방지) ──────
create or replace function public.is_admin() returns boolean
  language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ── RLS: 프로필 ────────────────────────────────────────────────
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles update" on public.profiles for update using (id = auth.uid());
create policy "profiles delete" on public.profiles for delete using (id = auth.uid() or public.is_admin());

-- ── RLS: 계정(본인 + 관리자 전체) ─────────────────────────────
drop policy if exists "accounts read"   on public.accounts;
drop policy if exists "accounts insert" on public.accounts;
drop policy if exists "accounts update" on public.accounts;
drop policy if exists "accounts delete" on public.accounts;
create policy "accounts read"   on public.accounts for select using (user_id = auth.uid() or public.is_admin());
create policy "accounts insert" on public.accounts for insert with check (user_id = auth.uid());
create policy "accounts update" on public.accounts for update using (user_id = auth.uid());
create policy "accounts delete" on public.accounts for delete using (user_id = auth.uid() or public.is_admin());

-- ── RLS: 상품(누구나 열람, 관리자만 변경) ─────────────────────
drop policy if exists "products read"   on public.products;
drop policy if exists "products write"  on public.products;
drop policy if exists "products update" on public.products;
drop policy if exists "products delete" on public.products;
create policy "products read"   on public.products for select using (true);
create policy "products write"  on public.products for insert with check (public.is_admin());
create policy "products update" on public.products for update using (public.is_admin());
create policy "products delete" on public.products for delete using (public.is_admin());

-- ── RLS: 자산 점검 스냅샷(본인만) ─────────────────────────────
drop policy if exists "snapshots read"   on public.snapshots;
drop policy if exists "snapshots upsert" on public.snapshots;
drop policy if exists "snapshots update" on public.snapshots;
drop policy if exists "snapshots delete" on public.snapshots;
create policy "snapshots read"   on public.snapshots for select using (user_id = auth.uid() or public.is_admin());
create policy "snapshots upsert" on public.snapshots for insert with check (user_id = auth.uid());
create policy "snapshots update" on public.snapshots for update using (user_id = auth.uid());
create policy "snapshots delete" on public.snapshots for delete using (user_id = auth.uid() or public.is_admin());

-- ── 가입 시 프로필 자동 생성 ──────────────────────────────────
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── (가입 후 1회) 본인을 관리자로 승격 ────────────────────────
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = '2010ksy@gmail.com');
