# ConnectSphere — Event Operations Platform

A Next.js (App Router + TypeScript) rebuild of the ConnectSphere event-operations
prototype: one request moving through review, venue booking, equipment
reservation, and registration, with a different view per role.

There is no backend. All data is seeded in memory on load (see `lib/data.ts`)
and lives in a single React context (`lib/app-context.tsx`) for the length of
the session — reloading the page resets it.

## Project structure

```
app/
  layout.tsx                 Root layout: fonts, global CSS, AppProvider
  page.tsx                   "/" — redirects to /login or the role's home page
  login/page.tsx             Sign-in screen
  (dashboard)/layout.tsx     Signed-in shell: sidebar, top bar, modal, toast
  (dashboard)/queue/         Coordinator: review queue + event workspace (tabs)
  (dashboard)/board/         Coordinator: pipeline board
  (dashboard)/my-events/     Organiser: my requests + stats
  (dashboard)/new-request/   Organiser: 3-step new request wizard
  (dashboard)/bookings/      Venue staff: availability calendar + booking requests
  (dashboard)/catalogue/     Venue staff: venue catalogue
  (dashboard)/equipment/     Technical support: inventory + equipment requests
  (dashboard)/browse/        Attendee: browse & register for events

components/
  layout/          Sidebar, TopBar, NotificationsPanel
  ui/              Small shared primitives (Pill, Dot, ProgressBar)
  login/           Sign-in screen pieces
  queue/           Review queue list + event workspace + its 5 tabs
  board/, my-events/, new-request/, bookings/, catalogue/, equipment/, browse/
                   One folder per page, holding that page's own components
  Modal.tsx, Toast.tsx   Global overlays rendered from the dashboard layout

lib/
  types.ts         Shared domain types (Role, EventRecord, Venue, ...)
  data.ts          Static reference data + seed events/notifications
  selectors.ts     Pure helpers (freeQty, suitability, lookups) — no React
  app-context.tsx  Global state + every mutation (signIn, approve, requestBooking, ...)
  page-meta.ts     Per-route title/subtitle for the top bar
```

Each page's feature components live in their own folder next to the route
that uses them; only truly cross-page pieces sit in `components/layout` and
`components/ui`.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you'll land on the sign-in screen. Any password
is accepted; pick a demo account or type one of these emails:

| Email | Role |
|---|---|
| priya.tan@connectsphere.edu | Event Coordinator |
| maya.rahman@connectsphere.edu | Event Organiser |
| daniel.ortiz@connectsphere.edu | Venue Staff |
| wei.lim@connectsphere.edu | Technical Support |
| sam.adeyemi@student.connectsphere.edu | Attendee |

## Deploying to Vercel

This is a standard Next.js app — push it to GitHub and import the repo at
[vercel.com/new](https://vercel.com/new), or run `npx vercel` from this
directory. No environment variables or backend are required.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build locally
## Architecture
[Editable C4 diagrams (.drawio)](docs/architecture/ConnectSphere_C4_Editable.drawio)
The file contains three English diagrams: C1 System Context, C2 Containers, and C3 Backend Components. These describe the **Proposed Target Architecture**, not the current frontend-only implementation: Next.js / React, a Python monolith, and Supabase DB.
The Python framework, Supabase Auth usage, database connection method, and email provider remain TBD. Component boundaries and API connections are proposed and should be aligned with the implementation as it develops.
To edit, download the file and open it in draw.io / diagrams.net using **File > Open From > Device**. Use this `.drawio` file as the primary editable source.
