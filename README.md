# World Cup 2026 Predictor

A lightweight starter project for building a World Cup 2026 predictor in plain Node.js and browser JavaScript.

## What it does

- Simulates the 48-team format with 12 groups of four.
- Advances group winners, runners-up, and the best eight third-placed teams.
- Uses a strength-adjusted Poisson Monte Carlo model to estimate title odds.
- Produces group win, top-two, advancement, and average-points projections.
- Computes analytical pre-match win/draw/loss forecasts for group-stage matches.
- Supports editable rating modifiers for form, squad strength, injuries, fatigue, and chemistry.
- Includes both a CLI runner and a simple browser UI.

## Important note

This repo now ships with the **48 qualified teams and official groups** in [data/teams-2026-qualified.json](/C:/Users/jesse/Documents/World%20Cup/data/teams-2026-qualified.json).

As of June 9, 2026, the default dataset uses the official FIFA group draw. The predictor still supports auto-generating a **provisional group stage** when `group` values are missing in a custom file.

The predictor matches the current 2026 format from FIFA:

- 48 teams
- 12 groups of four
- Top two from each group plus the best eight third-placed teams

The round-of-32 seeding in this project is an **approximation** designed for modeling and experimentation. Group winners are rewarded in the pairing logic, and same-group rematches are avoided where possible, but it is not a line-by-line implementation of FIFA's published bracket mapping.

The fallback provisional draw is also an approximation:

- Mexico, Canada, and the United States are pinned to Groups A, B, and C
- the rest of the field is split into strength pots from the provided ratings
- confederation balancing is applied with `UEFA <= 2` and all other confederations `<= 1`

## Run it

Start the local site:

```bash
node server.js
```

Then open [index.html](/C:/Users/jesse/Documents/World%20Cup/index.html) or visit `http://localhost:3000`.

Run the CLI simulator:

```bash
node src/cli.js 5000 20260611
```

Arguments:

1. Number of simulations
2. RNG seed
3. Optional path to a JSON team file

Example:

```bash
node src/cli.js 8000 20260611 data/teams-2026-qualified.json
```

Initialize or refresh the squad context file:

```bash
node scripts/update-squads.js
```

Auto-pull public World Cup squads and score them:

```bash
node scripts/fetch-squads.js
```

Auto-refresh completed match results for the tracker:

```bash
node scripts/fetch-results.js
```

## Vercel + Supabase

This app can now run in a more automatic setup:

- Vercel serves the frontend and API routes
- Supabase stores the latest `results` and `squad_context`
- Vercel cron jobs call the refresh endpoint on a schedule

Files involved:

- [api/bootstrap.js](/C:/Users/jesse/Documents/World%20Cup/api/bootstrap.js)
- [api/refresh.js](/C:/Users/jesse/Documents/World%20Cup/api/refresh.js)
- [lib/data-store.js](/C:/Users/jesse/Documents/World%20Cup/lib/data-store.js)
- [supabase/schema.sql](/C:/Users/jesse/Documents/World%20Cup/supabase/schema.sql)
- [vercel.json](/C:/Users/jesse/Documents/World%20Cup/vercel.json)

Environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

How it works:

- the browser first requests `/api/bootstrap`
- if live data is available in Supabase, the app uses that
- if not, it falls back to the local JSON files in `data/`
- Vercel cron can hit `/api/refresh?target=squads` and `/api/refresh?target=results`
- the refresh route reuses the same fetch logic from `scripts/fetch-squads.js` and `scripts/fetch-results.js`

Supabase setup:

1. Create a Supabase project.
2. Run the SQL in [supabase/schema.sql](/C:/Users/jesse/Documents/World%20Cup/supabase/schema.sql).
3. Add the env vars in Vercel.
4. Deploy the repo to Vercel.

If Supabase env vars are missing, the app still works locally by falling back to the checked-in JSON files.

## Team file shape

```json
[
  {
    "name": "Argentina",
    "group": "J",
    "rating": 2140,
    "attackRating": 2165,
    "defenseRating": 2115,
    "confederation": "CONMEBOL",
    "host": false,
    "adjustments": {
      "form": 12,
      "squad": 18,
      "injuries": -10,
      "fatigue": -4,
      "chemistry": 6
    }
  }
]
```

If you add explicit `group` values, the predictor will use them directly. If you omit them, it will auto-draw provisional groups.
Adjustment notes:
- Positive numbers help the team.
- Negative numbers hurt the team.
- `injuries` should usually be negative when key players are missing.
- The model now shows `Adj Rt` as base rating plus these modifiers.
- `attackRating` and `defenseRating` are optional. If omitted, the model derives both from `rating` plus context.

## Semi-Auto Squad Context

The first version of squad automation uses [data/squad-context.json](/C:/Users/jesse/Documents/World%20Cup/data/squad-context.json).

Workflow:
- Run `node scripts/fetch-squads.js`
- The script pulls squad lists from the public 2026 squads source
- It scores players automatically and regenerates team squad modifiers
- The site and CLI automatically read that file on the next run

Team context shape:

```json
{
  "Argentina": {
    "source": "wikipedia-squads",
    "lastChecked": "2026-06-14",
    "manual": {
      "form": 10,
      "fatigue": -3,
      "chemistry": 5
    },
    "players": [
      { "name": "Player A", "role": "starter", "impact": 16, "status": "available" },
      { "name": "Player B", "role": "starter", "impact": 14, "status": "out" },
      { "name": "Player C", "role": "rotation", "impact": 9, "status": "doubtful" }
    ]
  }
}
```

Player fields:
- `role`: `starter`, `rotation`, or `bench`
- `impact`: a rough player importance score, usually `4-18`
- `status`: `available`, `doubtful`, `out`, or `suspended`

Generated values:
- `generated.squad`: positive/negative squad strength modifier
- `generated.injuries`: negative injury/suspension penalty

This first version is now no-manual for squads:
- squad lists are pulled from a public 2026 squads page
- player scoring is automatic
- squad modifiers are automatic
- the predictor uses the generated numbers automatically

What still is not automated:
- injuries and suspensions beyond what appears in the published squad list
- custom form/fatigue/chemistry unless you choose to add them

## Good next upgrades

- Replace the current ratings with your preferred source or a richer power model.
- If FIFA updates naming or squad status, refresh the dataset while keeping the official group assignments.
- Add a proper FIFA bracket resolver for each third-place qualification pattern.
- Blend multiple signals into the rating:
  recent form, squad value, injuries, expected goals, travel, and rest.
- Store match-by-match predictions and expose them in the UI.
