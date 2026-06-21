-- 북극성 자산운용 — Supabase 스키마 (다중 사용자)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 인증(이메일/비밀번호)은 Supabase Auth가 담당하고, 아래 테이블이 프로필·계정을 저장합니다.

-- ── 프로필(이름/권한) ──────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  role        text not null default 'customer',   -- 'customer' | 'admin'
  created_at  timestamptz not null default now()
);

-- ── 투자 계정(상품/시드/보유) ─────────────────────────────────
create table if not exists public.accounts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  portfolio_id text,
  seed         numeric,
  start_date   date,
  holdings     jsonb,            -- [{market,code,label,weight,units,entry}]
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.accounts  enable row level security;

-- ── 관리자 판별 (security definer → RLS 우회로 재귀 방지) ──────
create or replace function public.is_admin() returns boolean
  language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ── RLS 정책: 본인 데이터 + 관리자는 전체 열람 ────────────────
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles update" on public.profiles for update using (id = auth.uid());
create policy "profiles delete" on public.profiles for delete using (id = auth.uid() or public.is_admin());

drop policy if exists "accounts read"   on public.accounts;
drop policy if exists "accounts insert" on public.accounts;
drop policy if exists "accounts update" on public.accounts;
drop policy if exists "accounts delete" on public.accounts;
create policy "accounts read"   on public.accounts for select using (user_id = auth.uid() or public.is_admin());
create policy "accounts insert" on public.accounts for insert with check (user_id = auth.uid());
create policy "accounts update" on public.accounts for update using (user_id = auth.uid());
create policy "accounts delete" on public.accounts for delete using (user_id = auth.uid() or public.is_admin());

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
