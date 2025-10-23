# Atlas Flex API

A minimal, future-proof Node.js/Express API that connects to a MongoDB Atlas cluster and
can read from multiple collections (e.g., `tweets`, `tweet_tiktoks`) with simple filtering,
sorting, projection, and pagination.

## Quickstart

1. **Create `.env`** (copy from `.env.example`) and set `MONGODB_URI` + `DB_NAME`.
2. Install deps and run:

```bash
npm install
npm run dev
# or
npm start
```

The API will start on `http://localhost:${PORT:-4000}`.

## Endpoints

- `GET /health` — basic health check.
- `GET /api/:collection` — list documents with query options.
- `GET /api/:collection/:id` — get a single document by ObjectId.

### Query options for `GET /api/:collection`
- `page` (default 1), `limit` (default from env `DEFAULT_LIMIT`), `skip`
- `sort` — JSON string, e.g. `{ "datetime": -1 }`
- `fields` — comma separated list for projection, e.g. `tweetId,text,datetime`
- `q` — JSON filter. Allowed operators: `$eq,$ne,$gt,$gte,$lt,$lte,$in,$nin,$regex,$exists`

Examples:
```
/api/tweets?limit=10&sort={"datetime":-1}
/api/tweets?q={"account":"sentdefender"}&fields=text,datetime
/api/tweet_tiktoks?q={"tweetId":"1970870644582527046"}&limit=5
```

### Security & Safeguards
- Collection access can be whitelisted via `ALLOWED_COLLECTIONS`.
- Filter sanitization only allows a safe subset of MongoDB operators.
- Max hard limit via `MAX_LIMIT` to prevent huge scans.

## Project Layout

```
src/
  db.js            # Mongo client (singleton) & helpers
  middleware/
    sanitize.js    # input validation & filter sanitization
  routes/
    collections.js # dynamic REST routes for any collection
  server.js        # app bootstrap
```

## Adding Future Collections

No code changes needed — just hit `/api/<yourCollection>`.
Optionally add the name to `ALLOWED_COLLECTIONS` in `.env` to restrict access.

## Docker (optional)

```bash
docker build -t atlas-flex-api .
docker run --env-file .env -p 4000:4000 atlas-flex-api
```

