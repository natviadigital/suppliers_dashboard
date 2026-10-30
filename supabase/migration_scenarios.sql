-- =====================================================================
-- Migration: Scenarios & Resourcing Simulator
-- Run this in Supabase > SQL Editor
-- =====================================================================

create table if not exists public.scenarios (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.scenario_items (
  id            uuid primary key default gen_random_uuid(),
  scenario_id   uuid not null references public.scenarios(id) on delete cascade,
  po            text not null,
  item          int not null,
  new_vendor    text not null references public.vendors(vendor_code) on update cascade,
  new_ship_date date,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (scenario_id, po, item)
);

create index if not exists scenario_items_scenario_idx on public.scenario_items(scenario_id);
create index if not exists scenario_items_po_item_idx on public.scenario_items(po, item);

-- Open access RLS policies
alter table public.scenarios enable row level security;
alter table public.scenario_items enable row level security;

drop policy if exists "open_access" on public.scenarios;
create policy "open_access" on public.scenarios for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.scenarios to anon, authenticated;

drop policy if exists "open_access" on public.scenario_items;
create policy "open_access" on public.scenario_items for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.scenario_items to anon, authenticated;
