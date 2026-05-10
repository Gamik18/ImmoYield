# ImmoYield
<<<<<<< HEAD
# Creates list of real estates in Detroit ans lists based on their yields.
=======

Simple website that ranks properties for sale by estimated gross rental yield.

## How it works

- Pulls sale listings from `/v3/for-sale`.
- Pulls rent listings from `/v3/for-rent`.
- For each sale listing, finds nearby rentals within 50 km using coordinate distance.
- Computes:
  - `avgMonthlyRent` = average of nearby rent comps
  - `annualRent` = `avgMonthlyRent * 12`
  - `grossYieldPct` = `(annualRent / listPrice) * 100`
- Sorts results descending by `grossYieldPct`.
- Excludes outlier yields outside the 1% to 50% range.

## Run

```bash
RAPIDAPI_KEY=your_key_here node server.js
```

Open: `http://localhost:3000`

## API endpoint

Local endpoint used by the frontend:

`GET /api/yields?city=Detroit&state_code=MI&sale_limit=42&rent_limit=60`

## UI features

- Sorted list by highest estimated gross yield first.
- Client-side filters:
  - minimum yield %
  - maximum sale price
- Pagination with configurable rows per page.
- CSV export for currently filtered results.
>>>>>>> be15bb7 (Initial ImmoYield app)
