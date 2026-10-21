# Supplier Capacity Dashboard (Insulation Purchasing)

Web application built for Virginia Transformer Corp (VTC) insulation purchasing team to monitor open purchase order loads against supplier weekly capacities by subassembly part category.

## Tech Stack
- **Frontend:** React 19, Vite, Tailwind CSS v4, Lucide Icons
- **Visualizations:** Recharts (stacked bars, capacity lines, demand lines, heatmaps)
- **Data Parsing:** SheetJS (XLSX, XLS, CSV)
- **Backend / Database:** Supabase (PostgreSQL, Views, RLS, RPC)

## Features
- **Open Order Ingestion:** Drag-and-drop `.xlsx` or `.csv` files. Client-side validation and preview before atomically replacing the active open order.
- **Automated Classification:** Automatically classifies lines into categories by part-number prefix (first 4 characters, e.g. `12HV`, `12CY`, `12M1`).
- **Inter-plant Order Filtering:** Excludes internal transfer orders between VTC/GTC plants (e.g. `8012`, `88888`, `9999`).
- **Dynamic Capacity & Demand Tracking:** Compares open balance (`BAL QTY`) against weekly supplier capacities and weekly category demand.
- **Past Due & Horizon Views:** Weekly (Monday start) or Monthly views spanning across current year and following two years. Past due orders bucketed separately.
- **Utilization Heatmap & Drill-Down:** Color-coded saturation (<80% green, 80-100% yellow, >100% red). Click any cell to view the exact underlying PO lines.
- **Mother Table & Settings:** Full CRUD interface for maintaining categories, units, prefixes, vendor registry, and weekly supplier capacities.

## Getting Started

### 1. Database Setup (Supabase)
Run the script in [`supabase/setup.sql`](./supabase/setup.sql) in your Supabase SQL Editor. It creates:
- Core tables (`categories`, `category_prefixes`, `vendors`, `supplier_capacities`, `open_orders`, `uploads`)
- Aggregated views (`v_monitored_orders`, `v_prefix_summary`)
- Atomic swap function (`commit_upload`)
- Initial seed data from the mother table and known VTC vendors

### 2. Environment Variables
Create a `.env` file with:
```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

### 3. Install & Run
```bash
npm install
npm run dev
```

### 4. Build for Production (Hostinger / Static Hosting)
```bash
npm run build
```
Upload the contents of the `dist/` directory to your web server (e.g. `public_html`).
