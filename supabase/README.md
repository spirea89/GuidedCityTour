# Supabase cache for GuidedCityTour

**Project:** `ifoybmzofjdgekvvrsot`  
**URL:** `https://ifoybmzofjdgekvvrsot.supabase.co`

Stores verified tour stories and discovered map pins so repeat visits do not call OpenAI again.

## Tables

| Table | Purpose |
|-------|---------|
| `place_research` | Verified story / tour JSON per building (`verified_payload`) |
| `area_locations` | Notable pins for a map area (`places` JSON array) |

See [docs/ai/supabase-cache.md](../docs/ai/supabase-cache.md) for cache keys and TTL policy.

## One-time setup

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/ifoybmzofjdgekvvrsot/sql/new).
2. Paste and run the contents of `migrations/20260819000000_initial_schema.sql`.
3. The **publishable key** is already in `SupabaseConfig.swift` and `js/config.js` (safe for client apps with RLS).

### CLI (optional)

```bash
supabase login
supabase link --project-ref ifoybmzofjdgekvvrsot
supabase db push
```

## Security notes

- RLS allows **read** of non-expired rows and **upsert** for cache entries only.
- Do not commit the service-role key; use it only in a Cloudflare Worker for server-side writes if you add one later.
- The anon key is safe in mobile/web clients when RLS is enabled as above.
