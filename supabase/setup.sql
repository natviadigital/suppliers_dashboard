-- =====================================================================
-- Supplier Capacity Dashboard - Supabase setup
-- Run this whole script once in Supabase > SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------- Tables ---------------------------------------------------

create table if not exists public.divisions (
  code  int  primary key,
  name  text not null
);

create table if not exists public.vendors (
  vendor_code   text primary key,
  vendor_name   text not null,
  is_interplant boolean not null default false,   -- inter-plant orders are never monitored
  created_at    timestamptz not null default now()
);

create table if not exists public.categories (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  unit          text not null default 'pcs',
  weekly_demand numeric,
  sort_order    int not null default 0
);

-- One prefix -> exactly one category (primary key enforces it)
create table if not exists public.category_prefixes (
  prefix      text primary key check (prefix = upper(prefix) and length(prefix) = 4),
  category_id bigint not null references public.categories(id) on delete cascade
);

create table if not exists public.supplier_capacities (
  id              bigint generated always as identity primary key,
  category_id     bigint not null references public.categories(id) on delete cascade,
  vendor_code     text   not null references public.vendors(vendor_code) on update cascade on delete cascade,
  weekly_capacity numeric,
  unique (category_id, vendor_code)
);

create table if not exists public.uploads (
  id          uuid primary key default gen_random_uuid(),
  file_name   text,
  total_rows  int,
  status      text not null default 'pending' check (status in ('pending','current','replaced')),
  uploaded_at timestamptz not null default now()
);

-- Raw open order lines (whole file is stored so new prefixes re-classify without re-uploading)
create table if not exists public.open_orders (
  id                           bigint generated always as identity primary key,
  upload_id                    uuid not null references public.uploads(id) on delete cascade,
  line_id                      text,
  div                          int,
  class                        text,
  buyer                        text,
  vendor_code                  text,
  vendor_name                  text,
  po                           text,
  item                         int,
  part_number                  text,
  prefix                       text generated always as (upper(left(trim(part_number), 4))) stored,
  description                  text,
  vendor_part_number           text,
  po_date                      date,
  ship_date                    date,
  delivery_date                date,
  ord_qty                      numeric,
  bal_qty                      numeric,
  unit_price                   numeric,
  ext_price                    numeric,
  line_confirmed               text,
  remarks                      text,
  job_reference                text,
  po_status                    text,
  vtc_comments                 text,
  eppm_hot_list                text,
  tracking_container           text,
  carrier                      text,
  tracking_container_eta       text,
  container_to_livingston_date text,
  control_number               text,
  impo_date                    text,
  vtc_comments_2               text,
  supplier_comments            text
);

create index if not exists open_orders_upload_idx on public.open_orders(upload_id);
create index if not exists open_orders_prefix_idx on public.open_orders(prefix);

-- ---------- Monitored view (current upload, known prefix, not inter-plant) ----

create or replace view public.v_monitored_orders
with (security_invoker = true) as
select
  o.id, o.line_id, o.div, d.name as division_name, o.class, o.buyer,
  o.vendor_code, coalesce(v.vendor_name, o.vendor_name) as supplier_name,
  o.po, o.item, o.part_number, o.prefix, o.description,
  o.po_date, o.ship_date, o.delivery_date, o.ord_qty, o.bal_qty,
  o.line_confirmed, o.remarks, o.po_status, o.vtc_comments, o.supplier_comments,
  c.id as category_id, c.name as category_name, c.unit
from public.open_orders o
join public.uploads u            on u.id = o.upload_id and u.status = 'current'
join public.category_prefixes p  on p.prefix = o.prefix
join public.categories c         on c.id = p.category_id
left join public.vendors v       on v.vendor_code = o.vendor_code
left join public.divisions d     on d.code = o.div
where coalesce(v.is_interplant, false) = false
  and coalesce(o.bal_qty, 0) > 0;

-- Prefix summary of the current file (helps find prefixes that are not yet classified)
create or replace view public.v_prefix_summary
with (security_invoker = true) as
select
  o.prefix,
  p.category_id,
  count(*)                 as lines,
  sum(coalesce(o.bal_qty,0)) as bal_qty,
  min(o.description)       as sample_description
from public.open_orders o
join public.uploads u           on u.id = o.upload_id and u.status = 'current'
left join public.category_prefixes p on p.prefix = o.prefix
left join public.vendors v      on v.vendor_code = o.vendor_code
where coalesce(v.is_interplant, false) = false
group by o.prefix, p.category_id;

-- ---------- Upload commit: atomically swap the current open order ----------

create or replace function public.commit_upload(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from uploads where id = p_upload_id) then
    raise exception 'Upload % not found', p_upload_id;
  end if;
  update uploads set status = 'replaced' where status = 'current';
  update uploads set status = 'current'  where id = p_upload_id;
  delete from open_orders where upload_id <> p_upload_id;
  delete from uploads where status = 'pending' and id <> p_upload_id;
end;
$$;

-- ---------- Row Level Security: open access (no login required) ----------

do $$
declare t text;
begin
  foreach t in array array['divisions','vendors','categories','category_prefixes',
                           'supplier_capacities','uploads','open_orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "open_access" on public.%I', t);
    execute format('create policy "open_access" on public.%I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

grant select on public.v_monitored_orders to anon, authenticated;
grant select on public.v_prefix_summary   to anon, authenticated;
grant execute on function public.commit_upload(uuid) to anon, authenticated;

-- =====================================================================
-- Seed data
-- =====================================================================

insert into public.divisions (code, name) values
  (1, 'VTCR'), (2, 'VTCU'), (4, 'VTCW P1'), (12, 'GTC'), (24, 'VTCW P2')
on conflict (code) do nothing;

insert into public.vendors (vendor_code, vendor_name, is_interplant) values
  ('2294',      'CANDUCT INDUSTRIES, LTD', false),
  ('14642',     'ENPAY ENDUSTRIYEL PAZARLAMA VE YATIRIM A.Ş.', false),
  ('12123',     'LIAONINGXD XINGQI ELECTRIC MATERIAL CO.,LTD', false),
  ('12040',     'TRANSVICK INDUSTRIES PVT LTD', false),
  ('7466',      'WEIDMANN ELECTRICAL TECH.', false),
  ('13372',     'KREMPEL INDUSTRIES MEXICO', false),
  ('13578',     'THYSSENKRUPP ENGINEERED PLASTIC', false),
  ('8914P',     'VENAMECA MEXICO SA DE CV', false),
  ('14045',     'HPS EXIM PRIVATE LIMITED', false),
  ('1840',      'E.I.S.', false),
  ('2615',      'THE GUND CO INC.', false),
  ('1499',      'PERMALI WALLACE, LTD.', false),
  ('10602P',    'INDUSTRIAS LTG SA DE CV', false),
  ('7114',      'ROCHLING MACHINED PLASTICS', false),
  ('4093W',     'EMID, LLC', false),
  ('8917P',     'SERRA GLOBAL TECHNOLOGY SA DE CV', false),
  ('1299P',     'GRUPO MAGRUB, S.A. DE C.V.', false),
  ('12507',     'HITACHI ENERGY INDIA LIMITED', false),
  ('14497',     'SABAR INDUSTRIES', false),
  ('8250',      'WESCO DISTRIBUTION, INC.', false),
  ('2100',      'PRECISION PRODUCTS GROUP, INC.', false),
  ('750',       'ESSEX BROWNELL INC.', false),
  ('P00039157', 'PARAMOUNT TUBE ENGINEERED SOLUTIONS', false),
  ('8903P',     'KREMPEL MEXICO', false),
  ('4347',      'MCCLUNG LUMBER CO., INC', false),
  ('0563P',     'BYC INDUSTRIAS S.A. DE C.V.', false),
  ('12707',     'CHONGQING UBO ELECTRICAL EQUIPMENT CO.,LTD', false),
  ('17024',     'JAPAN PULP & PAPER CO., LTD.', false),
  ('16776',     'JIANGSU XINYUAN ELECTRICAL CO. LTD', false),
  ('16898',     'HONG KONG GUANGXIN POWER CO,. LIMITED', false),
  ('7154W',     'MEXTAPE, S DE R.L DE C.V', false),
  ('8926P',     'ELECTRICAL INSULATION SUPPLIERS DE MEXICO SA D', false),
  ('1818W',     'WEIDMANN TECNOLOGIA ELECTRICA DE MEXICO SA CV', false),
  ('10913',     'CINDUS CORPORATION', false),
  ('10758',     'HOSUM ELECTRIC (HK) LIMITED', false),
  ('2742',      'JBC TECHNOLOGIES INC', false),
  -- Inter-plant (excluded from monitoring)
  ('8012',      'VTCW P1', true),
  ('88888',     'VTCW P2', true),
  ('9999',      'VTC', true),
  ('8077',      'VTCU', true),
  ('10964',     'GTC - RINCON', true),
  -- Placeholders from the mother table (vendor code unknown - update in Settings > Vendors)
  ('SERTEK',    'SERTEK (code TBD)', false),
  ('AGYA',      'AGYA (code TBD)', false)
on conflict (vendor_code) do nothing;

insert into public.categories (name, unit, weekly_demand, sort_order) values
  ('Key Spacers',          'pcs',  1100000, 1),
  ('Rectangular Sticks',   'pcs',  null,    2),
  ('Cylinders',            'pcs',  null,    3),
  ('Pressure Rings',       'pcs',  null,    4),
  ('MC Kits / Core Blocks','kits', null,    5),
  ('Phase Blocks',         'pcs',  null,    6),
  ('Ramp / Risers / Jokers','pcs', null,    7),
  ('Static Rings',         'pcs',  null,    8),
  ('Saw Cuts',             'pcs',  null,    9)
on conflict (name) do nothing;

insert into public.category_prefixes (prefix, category_id)
select x.prefix, c.id
from (values
  -- Key Spacers
  ('12TM','Key Spacers'),('12LM','Key Spacers'),('12RS','Key Spacers'),('12LV','Key Spacers'),
  ('12HV','Key Spacers'),('12RV','Key Spacers'),('12TS','Key Spacers'),('12TV','Key Spacers'),
  ('12RW','Key Spacers'),('12PA','Key Spacers'),('12RM','Key Spacers'),('12AM','Key Spacers'),
  -- Rectangular Sticks
  ('12HS','Rectangular Sticks'),('12LS','Rectangular Sticks'),
  -- Cylinders
  ('12CY','Cylinders'),
  -- Pressure Rings (shared prefixes moved to MC Kits)
  ('12LC','Pressure Rings'),('12PR','Pressure Rings'),('12PM','Pressure Rings'),('12PL','Pressure Rings'),
  -- MC Kits / Core Blocks
  ('12BI','MC Kits / Core Blocks'),('12BL','MC Kits / Core Blocks'),('12BM','MC Kits / Core Blocks'),
  ('12CS','MC Kits / Core Blocks'),('12EC','MC Kits / Core Blocks'),('12EM','MC Kits / Core Blocks'),
  ('12LF','MC Kits / Core Blocks'),('12LG','MC Kits / Core Blocks'),('12PB','MC Kits / Core Blocks'),
  ('12PE','MC Kits / Core Blocks'),('12PI','MC Kits / Core Blocks'),('12SB','MC Kits / Core Blocks'),
  ('12TF','MC Kits / Core Blocks'),('12TC','MC Kits / Core Blocks'),('12U1','MC Kits / Core Blocks'),
  ('12U2','MC Kits / Core Blocks'),('12UB','MC Kits / Core Blocks'),('12UF','MC Kits / Core Blocks'),
  ('12US','MC Kits / Core Blocks'),('12UT','MC Kits / Core Blocks'),('12BS','MC Kits / Core Blocks'),
  ('12SS','MC Kits / Core Blocks'),('12SG','MC Kits / Core Blocks'),('12BP','MC Kits / Core Blocks'),
  ('12FR','MC Kits / Core Blocks'),('12FS','MC Kits / Core Blocks'),
  -- Ramp / Risers / Jokers
  ('12M1','Ramp / Risers / Jokers'),('12M2','Ramp / Risers / Jokers'),('12M3','Ramp / Risers / Jokers'),
  ('12M4','Ramp / Risers / Jokers'),('12M5','Ramp / Risers / Jokers'),
  -- Static Rings / Saw Cuts
  ('12SR','Static Rings'),('12SC','Saw Cuts')
) as x(prefix, cat)
join public.categories c on c.name = x.cat
on conflict (prefix) do nothing;

insert into public.supplier_capacities (category_id, vendor_code, weekly_capacity)
select c.id, x.vendor_code, x.cap
from (values
  ('Key Spacers','12123', 500000::numeric),
  ('Key Spacers','14642', 100000),
  ('Key Spacers','12040', 100000),
  ('Key Spacers','2294',  null),
  ('Key Spacers','4093W', 150000),
  ('Key Spacers','8903P', 40000),
  ('Key Spacers','14497', 56250),
  ('Key Spacers','10602P',100000),
  ('Key Spacers','2615',  50000),
  ('MC Kits / Core Blocks','SERTEK', 1.0),
  ('MC Kits / Core Blocks','4093W',  1.0),
  ('MC Kits / Core Blocks','14497',  1.5),
  ('MC Kits / Core Blocks','AGYA',   0.5),
  ('MC Kits / Core Blocks','2615',   null),
  ('MC Kits / Core Blocks','8903P',  1.0),
  ('MC Kits / Core Blocks','2294',   null)
) as x(cat, vendor_code, cap)
join public.categories c on c.name = x.cat
on conflict (category_id, vendor_code) do nothing;
