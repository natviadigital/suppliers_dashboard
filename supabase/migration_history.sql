-- =====================================================================
-- Migration: Purchase Receipts History (9M) & Inventory Transactions History (12M)
-- Optional dedicated raw tables (the app also stores pre-aggregated cubes
-- in public.uploads automatically so it works immediately with zero setup).
-- =====================================================================

create table if not exists public.po_receipts (
  id           bigint generated always as identity primary key,
  div          int,
  class        text,
  part_number  text,
  prefix       text generated always as (upper(left(trim(part_number), 4))) stored,
  description  text,
  um           text,
  lt           numeric,
  reference    text,
  receipt_date date,
  qty          numeric,
  vendor_name  text,
  uploaded_at  timestamptz not null default now()
);

create index if not exists po_receipts_prefix_idx on public.po_receipts(prefix);
create index if not exists po_receipts_date_idx   on public.po_receipts(receipt_date);

create table if not exists public.inventory_transactions (
  id             bigint generated always as identity primary key,
  class          text,
  part_number    text,
  prefix         text generated always as (upper(left(trim(part_number), 4))) stored,
  description    text,
  div            int,
  reference      text,
  tx_date        date,
  subassy        text,
  subassy_prefix text generated always as (upper(left(trim(subassy), 4))) stored,
  tx_type        text,
  tx_id          text,
  qty            numeric,
  uploaded_at    timestamptz not null default now()
);

create index if not exists inv_tx_prefix_idx         on public.inventory_transactions(prefix);
create index if not exists inv_tx_subassy_prefix_idx on public.inventory_transactions(subassy_prefix);
create index if not exists inv_tx_date_idx           on public.inventory_transactions(tx_date);

alter table public.po_receipts enable row level security;
alter table public.inventory_transactions enable row level security;

drop policy if exists "open_access" on public.po_receipts;
create policy "open_access" on public.po_receipts for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.po_receipts to anon, authenticated;

drop policy if exists "open_access" on public.inventory_transactions;
create policy "open_access" on public.inventory_transactions for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.inventory_transactions to anon, authenticated;
