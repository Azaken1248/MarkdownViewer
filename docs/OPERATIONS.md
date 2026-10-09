# Running this somewhere

Everything here is about a deployment somebody else has to keep working. For
what the app *is*, and how to work on it, see the [README](../README.md).

There is no config file. Every setting is an environment variable, and two of
them have consequences their names do not suggest — see
[the variables that are security settings](#the-variables-that-are-security-settings)
before the first deploy rather than after.

---

## The short version

```bash
docker compose up -d
docker compose logs -f     # the first boot prints an admin password, once
```

[`docker-compose.yml`](../docker-compose.yml) is in the repository root and is
annotated; the notes below are why it says what it says. Or, without Docker:

```bash
npm ci --omit=dev
npm run build                      # optional: 3 requests instead of 106
MDVIEWER_STATE_DIR=/var/lib/mdviewer \
PUBLIC_BASE_URL=https://example.com \
TRUST_PROXY=true \
node server.js
```

Node 20 or newer (`engines` says `>=20`; CI runs 20 and 22).

The first boot with no accounts prints a generated admin password **once**, to
stdout. Catch it, or set `SEED_ADMIN_PASSWORD` beforehand — either way the
first sign-in has to change it before anything else is allowed, so a scripted
setup needs a `POST /api/auth/password` after the login and before its first
write, or it gets `password_change_required` and nothing else.

---

## Docker

The [`Dockerfile`](../Dockerfile) builds in two stages: the first carries the
dev dependencies, esbuild for the bundles, and the compiler `better-sqlite3`
needs; the second carries none of that. It runs as a non-root user and puts
state in `/state`.

[`docker-compose.yml`](../docker-compose.yml) builds it, binds the port to
loopback — the thing listening on 443 should be a reverse proxy, not this —
and mounts a named volume at `/state`.

It binds 4321, which is also what `npm start` uses, so bringing it up on a
machine already running this from a checkout fails with `address already in
use`. That is the right failure; change the host side of the mapping if you
want both.

Two things about that volume:

- **A named volume, not a bind mount.** The image runs as uid 1000 (`node`,
  the user the base image already ships), and a named volume inherits
  `/state`'s ownership from the image. A bind-mounted host directory keeps the
  host's ownership instead, so `mkdir` inside it fails with `EACCES` and the
  app will not start. If you want a host path, `chown 1000:1000` it first.
- **`AUDIT_LOG: stderr`** hands the security events to the container's log
  rather than writing them inside the volume, which is usually what you want
  when something else is already collecting stdout.

`docker compose exec mdviewer node -e "fetch('http://127.0.0.1:4321/healthz').then(r=>r.text()).then(console.log)"`
asks the same question the `HEALTHCHECK` does.

---

## Behind a reverse proxy

The app does not terminate TLS and does not redirect HTTP to HTTPS; both are
the proxy's job. What it needs from the proxy is the original host and scheme,
and what the proxy needs from you is `TRUST_PROXY` set — without it
`X-Forwarded-*` is ignored, which is the safe default and the wrong one here.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # A document, a folder upload or a pasted image goes through here. The app
    # has its own limits (MAX_DOC_BYTES, MAX_ASSET_BYTES); this only has to be
    # above them, or nginx refuses the upload before the app can say why.
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
    }
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
```

### Caddy

```
example.com {
    reverse_proxy 127.0.0.1:4321
}
```

Caddy sets the `X-Forwarded-*` headers itself and terminates TLS without being
asked, so the whole configuration is that line.

With either, set `PUBLIC_BASE_URL=https://example.com` and `TRUST_PROXY=true`.

---

## The variables that are security settings

Two of them decide more than their names say:

**`PUBLIC_BASE_URL` decides whether the session cookie is `Secure`, and whether
HSTS is sent.** Both are derived from whether it starts with `https://`, and
deliberately not from the request — a request's idea of its own scheme is
something an attacker can set. So a deployment served over HTTPS with
`PUBLIC_BASE_URL` left at an `http://` value issues a cookie that will travel
in clear text on the first plain-HTTP request, and sends no HSTS to prevent
there being one. It is also the first entry in the CSRF origin allow-list.

**`TRUST_PROXY` decides which address the app thinks a request came from.** It
is what makes `X-Forwarded-*` believed, and `req.ip` feeds the rate limiter's
buckets, the login lockout and the audit log. Left off behind a proxy, every
request appears to come from the proxy — so one client's failed logins lock the
bucket for everyone. Turned on when there is *no* proxy, any client can claim
any address by sending the header, and the lockout becomes trivial to evade.
Set it when and only when something is actually in front.

> An earlier version of this app also switched the CSRF origin check off
> entirely under `TRUST_PROXY`, which meant the deployment that most needed it
> — the public one, behind a proxy — was the one that did not get it. That is
> fixed: the check compares against a configured list of origins, so it runs
> the same either way. `TRUST_PROXY` no longer has anything to do with it.

**`PUBLIC_READS=true`** makes every document readable by anyone with no sign-in
at all. It is the behaviour from before accounts existed, kept for a library
that is meant to be public. Individual documents can be shared without it.

**`ENABLE_GRAPHQL_INTROSPECTION=true`** publishes the schema. It is for working
on the schema locally and should not be on in production.

The full table of every variable, with defaults, is in the
[README](../README.md#configuration).

---

## State, and what to back up

Everything a running instance cannot regenerate lives under
`MDVIEWER_STATE_DIR` (`/state` in the image):

| | what is in it |
| --- | --- |
| `docs/` | the documents themselves, in the folder layout the tree shows |
| `assets/` | pasted and uploaded images |
| `deleted_markdowns/` | the recycle bin, which is a real directory and not a flag |
| `data/azadocs.db` | accounts, sessions, share links, saved links, folder metadata (plus its `-wal` and `-shm` siblings) |
| `data/audit.jsonl` | the security events, unless `AUDIT_LOG` says otherwise |

Those five are the product. Every document, every folder assignment, every
account, every share token, every uploaded image. They are correctly not in
git, and the atomic-write discipline that protects them from a crash mid-write
does nothing about a lost disk, a deleted volume, or an `rm -rf` in the wrong
terminal. The recycle bin is a user-facing undo on the same disk, which is not
a backup of anything.

### Taking one

```bash
npm run backup -- --state /var/lib/mdviewer --out /mnt/backups --keep 30
```

```bash
# ...or from inside the container, writing to a second volume
docker compose exec mdviewer node tools/backup.js --out /backups --keep 30
```

**It runs while the app is running.** Nothing is stopped, quiesced or locked:
the database is copied with SQLite's own online backup, which takes and
releases a read lock as it walks the pages, so a writer is never blocked and
what lands is one consistent point in time rather than a file that was being
written to. Everything else is plain files written atomically, so a copy gets
the old one or the new one and never half of one.

What is still possible is skew — a document saved between the database
snapshot and the file copy. The app treats the directory as the truth and the
database as an index it rebuilds from, so that resolves itself; it is the
reason the script copies the database first and the documents second rather
than the other way round.

`--keep N` drops all but the newest N archives in `--out`. The script will tell
you if you have pointed `--out` inside the directory it is backing up, because
a copy on the same disk is not a backup.

A nightly cron line, with the archive going somewhere else afterwards:

```cron
17 3 * * *  cd /srv/mdviewer && npm run backup -- --state /var/lib/mdviewer --out /mnt/backups --keep 30 >> /var/log/mdviewer-backup.log 2>&1
```

### Restoring one, which is the half that matters

```bash
npm run restore -- /mnt/backups/azadocs-2026-09-25T03-17-00-000.tar.gz --state /tmp/check
```

It refuses a directory that already has something in it unless `--force`,
because the obvious use is restoring beside a running instance to see whether
the archive is any good, and the obvious accident is typing the live path while
doing it. After unpacking it opens the database, checks it has the five tables
whose absence would mean lost accounts, sessions, share links, saved links or
folders, and counts what it found.

Then boot against it, which is the end of the proof:

```bash
MDVIEWER_STATE_DIR=/tmp/check PORT=4322 npm start
curl -s localhost:4322/healthz     # reads the document directory; 503 if it cannot
```

**A backup nobody has restored is a hypothesis**, so that round trip is a test.
`npm test restore` seeds a server, writes a document and hands out a share
link, takes an archive while the server is still answering, unpacks it
elsewhere, boots a second server against the result and checks that the
document is there, that the share link handed out before the backup still
opens, and that the account can still sign in with the password it had. It runs
on every CI run, so "we have backups" is checked rather than believed.

---

## What to watch

`GET /healthz` reads the document directory and answers `200` with a document
count, or `503` when storage is not readable. It needs no session, and it is
rate-limited per address like anything else that does not.

```json
{ "status": "ok", "uptimeSeconds": 4210, "documents": 128, "checkMs": 3 }
```

That is the useful check: the process being up is not the failure that happens,
a volume that did not mount is.

It does not, however, say whether the pages work. The app stamps a hash of each
asset into the URL that names it, so a page and its assets cannot disagree
about a version — and a stamped URL that does not resolve is a page that loads
and then does nothing, which `/healthz` cannot see. After a deploy:

```bash
npm run smoke https://example.com
```

It fetches the app shell and the error page, pulls every asset out of the HTML
as served, and fetches each one at the stamped address it was named at. It also
checks the security headers are on the response and that a 404 is the app's own
error page rather than a stack trace. CI runs the same checks against a
`NODE_ENV=production` boot on every run, and the `production` suite runs them
against a server it starts itself.

### The log

One line per request on stdout, written when the response finishes so the
status and the duration are real (`LOG_REQUESTS`, on by default; `LOG_STATIC`
adds the asset requests, off by default because they drown out everything
else).

```
2026-09-25T09:45:02.684Z GET /api/docs status=200 ms=1.7 id=00f2d3ea user=aza
```

`LOG_FORMAT=json` makes each line an object instead, which is what to set when
something is collecting them:

```json
{"ts":"2026-09-25T09:45:02.684Z","level":"info","msg":"GET /api/docs",
 "status":200,"ms":"1.7","id":"00f2d3eaad3449f2","user":"aza","userId":"user_7451…"}
```

`LOG_LEVEL` is `debug`, `info`, `warn` or `error`, and is how the volume comes
down without a deploy. Warnings and errors go to stderr either way, so a
pipeline that separates the two keeps working.

**The id is the useful part.** Every request gets one, it is echoed as
`X-Request-Id`, and it is on both the access line and the stack trace of a 500
— so a user reporting "it broke" has a number in their response headers that
finds the exact failure. Behind a proxy that already sets `X-Request-Id`, that
one is kept instead, so a request is one id across the chain; with
`TRUST_PROXY` off the header is ignored, because otherwise a client chooses
what its own log line says.

A request the client abandoned carries `aborted=true` and is counted like any
other. `finish` — the response reaching the socket — does not fire when the
client hangs up first, so listening for it alone meant an abandoned request was
neither logged nor counted, which is backwards: a client abandoning requests is
exactly the thing nobody would otherwise see.

**What a line never carries:** the query string (search terms are the contents
of somebody's documents), the body, or any header. Who made the request is on
it, because that is the question being asked of a log.

The security events — sign-ins, failures, lockouts, permission refusals — are a
separate JSON-lines stream controlled by `AUDIT_LOG`.

### Metrics

`GET /metrics` is Prometheus text. It is a 404 unless `METRICS_TOKEN` is set,
and then it wants that token as a bearer:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: mdviewer
    authorization:
      credentials: the-value-of-METRICS_TOKEN
    static_configs:
      - targets: ["127.0.0.1:4321"]
```

A scrape says how many requests failed and how long they took, which is more
than an anonymous caller should learn about a private library — hence the
token rather than an "allow from this network" rule there is no good way to
get right here. The comparison is timing-safe and the route is rate-limited
per address like `/healthz`.

What is in it:

| | |
| --- | --- |
| `mdviewer_requests_total{method,status}` | request rate and error rate, by status class |
| `mdviewer_request_duration_seconds` | a histogram, so p50/p95/p99 are queryable |
| `mdviewer_cache_{entries,bytes,bytes_max}` | how full each of the three in-memory caches is |
| `mdviewer_cache_{hits,misses,evictions}_total` | whether its budget is the right budget |
| `mdviewer_uptime_seconds` | how long since this process started |

Nothing is labelled by path. A label with a request path in it has one value
per document, and a scraper keeps every series it ever saw — that is how a
metrics endpoint ends up holding every document title the app has served.

The cache numbers are there for a specific question. Those three budgets —
32MB, 48MB, 16MB — are constants somebody picked once with no data, and
whether they are right is not answerable from the source. A cache that never
evicts is bigger than it needs to be; one that misses constantly is smaller.
Now there is a number.

### Something to scrape it

`deploy/` has the rest: a Prometheus job, six alert rules, an Alertmanager
config and a compose file that brings the lot up beside the app.

```bash
echo -n "the-value-of-METRICS_TOKEN" > deploy/metrics-token
chmod 600 deploy/metrics-token
docker compose -f deploy/docker-compose.monitoring.yml up -d
```

| Alert | When | Why this one |
| --- | --- | --- |
| `AzaDocsDown` | the scrape fails for 2m | the only one that always matters |
| `AzaDocsUnhealthy` | `/healthz` fails for 2m | the failure that actually happens: the process is up and the state directory is not readable, so every request 500s while `/metrics` answers perfectly well |
| `AzaDocsErrorRate` | 5xx over 1% for 5m | something broke and nobody reported it |
| `AzaDocsSlow` | p95 over 2s for 10m | the listing is linear in the number of documents, and the load harness above says it is what degrades first |
| `AzaDocsCacheThrash` | evicting steadily with a hit rate under 50%, for 30m | the three budgets were picked with no data; this is how you find out they were wrong |
| `AzaDocsDiskFilling` | under 20% free for 15m | documents, uploads and the recycle bin only grow |

The last two are about this app's own numbers rather than any app's, and both
are tickets rather than pages: neither is an outage, and a page nobody acts on
is a page nobody reads.

**Three things that directory cannot supply, and says so:** a host to run it
on; somewhere for a page to go — `alertmanager.yml` ships a receiver that
delivers nothing, deliberately and loudly, because an alert firing into the
void is worse than no alert; and the real mountpoint for `AzaDocsDiskFilling`,
which is a fact about the host and until it is filled in matches nothing.

The metric names in those rules are checked against what `lib/metrics.js`
actually renders — by the `operations` suite, which asks the renderer rather
than searching the source, because half the names are assembled from two
strings. An alert on a metric that no longer exists never fires, and never
firing looks exactly like nothing being wrong.

---

## How many people can use this

Nobody knew. This is a single process on a single event loop, and until
`tools/load.js` existed nothing had measured what happens when more than one
person asks at once.

```bash
node tools/load.js                     # its own server, 60 documents
node tools/load.js --corpus 1000       # ...and a thousand
node tools/load.js --origin https://md.example.com --cookie "mdv_session=…"
```

Measured on an Intel i7-6500U (two cores, four threads, 2015), Node 20, eight
connections — each one a different signed-in session, which is what "how many
people" means. A current server will do better. These are not a promise; they
are the answer to a question that previously had none.

**60 documents**

| Scenario | req/s | p50 | p97.5 | max |
| --- | --- | --- | --- | --- |
| `shell` — the page itself | 491 | 14ms | 29ms | 80ms |
| `listing` — `/api/docs` | 253 | 29ms | 48ms | 59ms |
| `search` | paced 16 | 25ms | 84ms | 130ms |
| `document` — one read | 1287 | 5ms | 11ms | 74ms |

**1000 documents**

| Scenario | req/s | p50 | p97.5 | max |
| --- | --- | --- | --- | --- |
| `shell` — the page itself | 476 | 11ms | 19ms | 49ms |
| `listing` — `/api/docs` | **15** | **353ms** | 694ms | 708ms |
| `search` | paced 12 | **202ms** | 501ms | 803ms |
| `document` — one read | 800 | 5ms | 16ms | 580ms |

### What that says

**Reading a document does not care how big the library is.** 1287 req/s at
sixty documents, 800 at a thousand, 5ms either way. The content cache is doing
its job and the disk is not in the way.

**The listing does care, and it is the ceiling.** `/api/docs` goes from 253
requests a second to fifteen, and from 29ms to 353ms, for sixteen times the
library. It reads the organizer and stats the directory on every request, and
that is linear in the number of documents. At a thousand documents it is the
slowest thing this server does.

**Which is most of what a search costs.** `searchDocuments` in `server.js`
calls `getDocs()` before it asks the index, so a query pays for the listing
first. Measured directly, over a thousand documents with everything warm: the
listing alone is 106ms, a search through the index is 101ms, and a search
through the scan the index replaced is 124ms.

`docs/ARCHITECTURE.md` says a query "used to read every document in the library
to find out which ones matched; it now asks the index and reads none". That is
exactly true and worth keeping — the `search` suite checks it by counting what
each path opens, and the index opens **zero** documents against the scan's
thousand. What the numbers add is where the time actually goes: the index made
the matching free, and the listing in front of it is what a search now costs.

So the thing to make faster, if a library ever gets big enough to need it, is
the listing — not the search.

### Rate limits are part of the measurement

Two scenarios cannot be measured the obvious way, and the tool says so rather
than printing a number that reads like capacity:

- **Searching is capped at 240 a minute per session.** Pointed at one session,
  a load generator measures that cap: the first version of this harness
  reported 1194 req/s for search, of which 4537 requests out of 4777 were 429s.
  It is paced to stay inside the ceiling now, and only its latency is reported.
- **`/healthz` is capped at 60 a minute by address**, and every connection from
  one machine is one address. That cap is right — a monitor polling every ten
  seconds uses a tenth of it — and it makes `/healthz` unmeasurable from a
  single host. The shell page is the floor instead; nothing rate-limits it.

The tool prints a loud line if any request came back non-2xx, because a
measurement that met a ceiling is the limiter's arithmetic and not the app's.

---

## Rate limits

Every ceiling is a fixed window of one minute, and every one is a ceiling
against a runaway rather than a security boundary — the guards are the
boundary. They are set in one place at the top of `server.js` and mounted in
one place beside it, so what is limited is answerable without reading a route.

| What | Per | Budget |
| --- | --- | --- |
| State changes on `/api/*` (POST, PUT, PATCH, DELETE) | account, or address with no session | 300, or 60 |
| Saves — `POST /api/docs`, `PUT /api/docs/…` | account | 120 |
| Uploads — a document, a folder, a pasted image | account | 30 |
| `GET /api/docs/search` | account | 240 |
| Link previews fetched from elsewhere | account | 20 |
| `/healthz`, which needs no session, and `/graphql` | address | 60 |
| `POST /api/export/pdf`, which starts a browser | address | 10 |

Reads are not counted by the wide ceiling on purpose. The client reads a great
deal — it fetches every document once to warm its offline search — and that
grows with the library, so a cap on reads low enough to mean anything would
break it and one high enough to allow it would mean nothing. The reads that
cost something have the buckets above.

A refusal is a `429` with a `Retry-After` header and a message saying which
budget ran out. The map behind each bucket is capped at ten thousand keys, so
a caller presenting addresses by the thousand fills it and is forgotten rather
than growing it. The limits are per process: under two, every ceiling is
twice as high, which for a ceiling is fine.

The login lockout is the one limit that is a boundary rather than a ceiling,
and it is the one that does not work this way. Eight wrong guesses in fifteen
minutes lock an account for fifteen; forty from one address lock the address.
The count lives in the database, so a restart does not reset it — a crash loop
or a redeploy used to turn the lockout into a speed bump — and two processes
share one count rather than each allowing eight. The `db` suite checks all
three.

---

## Drawing PDFs

A PDF export is laid out in the reader's browser — the pages are measured and
cut there, the diagrams fitted, the ink placed — and posted here as one
self-contained HTML file. This server hands it to Chromium, which embeds a
subset of each font and writes the text as text, and sends the result back.
Roughly 450KB for a hundred pages against 8MB for the same thing drawn as
pictures, and the words are in it rather than over it.

It is optional. Install the browser with:

```sh
npx playwright install --with-deps chromium
```

or set `PDF_BROWSER` to one already on the machine. With neither, the endpoint
answers `503 no_renderer`, the page says so in its export menu before you
choose, and it draws the file itself instead.

The browser starts on the first export and stops two minutes after the last,
so a server nobody is exporting from carries none of it. Each render gets a
fresh context with JavaScript turned off and every network request refused —
the document is self-contained by construction, so anything it asks for is
something it should not have. That leaves the HTML and CSS parsers as the
whole of what a posted document can reach, which is why this is rate limited
by address rather than by account: a share link published with exporting
allowed is a credential anybody may be holding.

The Docker image does not ship a browser. Adding one roughly doubles it, so
it is a decision rather than a default: add the install line above to the
Dockerfile, or point `PDF_BROWSER` at a Chromium on the host.

## The audit log

The request log says what was asked and how it was answered. It does not say
who signed in from where, whose password was changed by whom, or who erased a
document — so after an incident, "what did this account do before we
noticed?" had no answer. `data/audit.jsonl` is the answer: one JSON line per
event that matters, appended, owner-readable only.

| Event | When |
| --- | --- |
| `login.ok`, `login.failed`, `login.refused` | a sign-in, a wrong guess (with the reason the response never gives: no such user, disabled, bad password), a guess made while locked |
| `login.locked` | the guess that locked an account or an address, and for how long |
| `permission.denied` | a signed-in account asking for what its role does not allow — a viewer trying to write |
| `share.created`, `share.rotated`, `share.revoked` | a share link's life; rotation is how a leaked link is revoked |
| `password.changed`, `password.change.failed` | by the owner or by an admin; and a wrong current password, which is a guess from inside a session |
| `user.created`, `user.role`, `user.disabled`, `user.enabled`, `user.deleted` | what changed about an account, and by whom |
| `doc.erased` | the one thing here that cannot be undone |

Every line carries who (the signed-in account, when there is one), the
address, and a user agent cut to 120 characters. Never a document's text, a
search term, a token, a password or a hash of one — the `audit` suite walks a
server through all of the above and then searches the log for each of those
and requires them absent. Reads and saves write no line: the log is for what
an incident review asks about, not a second request log.

`AUDIT_LOG=stderr` hands the lines to whatever collects the process's output,
for a deployment that ships logs somewhere; the default is a file because the
point is to still have it later.

---

## Notes on the public deployment

The canonical origin is baked in rather than read from the request. A `Host`
header is attacker-controlled, and building the canonical or oEmbed URL from it
lets someone else decide where a link preview points. `PUBLIC_BASE_URL`
overrides the default; nothing else does.

Behind a reverse proxy, set `TRUST_PROXY` — otherwise `req.protocol` reports the
proxy hop rather than the client's scheme.

A write that arrives with an `Origin` header has to name an origin this
deployment answers on: `PUBLIC_BASE_URL`, anything in `ALLOWED_ORIGINS`, or
loopback on `PORT`. That list is configuration, not something read off the
request, and the check no longer switches itself off under `TRUST_PROXY` — it
used to, on the grounds that behind a proxy the request's own idea of its
origin could differ from the public one, which meant the deployment that
most needed the check was the one without it. It is the layer in front of
the CSRF token, not the only lock.

Every response carries the same set of headers — a Content Security Policy,
`nosniff`, a referrer policy, `X-Frame-Options`, a same-origin opener policy
and resource policy, and a permissions policy that denies the camera, the
microphone, location, USB and payment — including static files, errors and
refused API calls, because a policy that covers only the pages somebody
remembered to cover is not a policy. They live in `lib/http/headers.js` with
the reason for each, and the `headers` suite asks eight kinds of response for
the set.

The Content Security Policy allows no inline or evaluated *script*. It does
allow inline *styles* — `style-src 'unsafe-inline'` — and that is a deliberate
trade with three reasons, all of them checked by the `headers` suite so the
allowance expires the day none of them holds: the app's own diagram drawing
writes `style` attributes whose values come from the document (a box's colour
from its `classDef`), which no hash can cover and no nonce applies to, since
nonces cover `<style>` elements and never attributes; KaTeX sets inline style
attributes on what it typesets; and Mermaid injects a `<style>` into every SVG
it renders. Styles cannot execute; what style injection can do is redress the
page, and scripts — the vector that matters — stay pinned to this origin and
two SRI-checked CDNs.

`Strict-Transport-Security` is the one that depends on the deployment. It is
sent when `PUBLIC_BASE_URL` is HTTPS and not otherwise: a plain-HTTP box that
sent it would tell the browser never to come back the way it can. A year,
with subdomains, and without `preload` — that submits the domain to a list
browsers ship with and is effectively irreversible, so it is a decision to
make on purpose.

The resource policy means the app's own responses — a pasted image, an icon,
the embed card — cannot be embedded by a page on another origin. A crawler
fetching `og:image` for a link preview is a server, not a browser, and is not
affected.

---

---

## Deploying

```bash
npm ci
pm2 start server.js --name azadocs --update-env
pm2 save
```

With a reverse proxy in front:

```bash
TRUST_PROXY=true pm2 start server.js --name azadocs --update-env
```

Set `TRUST_PROXY` when there is a proxy in front, or `req.ip` is the proxy's
address for everyone — which makes the per-address rate limit meaningless — and
the session cookie's `Secure` flag is decided from `PUBLIC_BASE_URL`, so serve
over HTTPS.

`SIGTERM` and `SIGINT` shut down gracefully: the server stops accepting
connections, lets in-flight requests finish, and exits — with a 10-second
backstop. This matters because organizer writes are read-modify-write behind a
lock, and killing the process mid-write is exactly the corruption that used to
wipe every folder assignment.

### Releasing

CI proves a commit is good. `.github/workflows/release.yml` is what puts one
somewhere.

```bash
git tag v1.2.3
git push origin v1.2.3
```

On a tag, not on every push to main. There is no automated rollback here and
one person to notice, so the gate is somebody deciding that this commit is a
release rather than the fact that it merged. A run can also be started by hand
from the Actions tab with a tag typed in.

**What happens, and what does not.** The workflow has two jobs, and only the
first of them works today.

`image` builds the Dockerfile and pushes it to this repository's own container
registry, tagged twice — once with the version, which is what a rollback asks
for by name, and once as `latest`, which is what `docker compose pull` takes
without one. It needs no host, no third-party account and no secret: the
`GITHUB_TOKEN` the run already has, with `packages: write`, is the whole of it.
A tagged, built, pullable image per release is most of what a deploy is, and it
is worth having on its own.

```bash
docker pull ghcr.io/<owner>/<repo>:v1.2.3
```

`deploy` pulls that image on a host over SSH, brings it up, and runs
`tools/smoke.js` against it — which is the difference between "the container
started" and "the pages work". It is written and it is inert. It is gated on a
GitHub Environment called `production`, and skipped entirely while
`vars.DEPLOY_HOST` is unset, so it does not pretend to have run.

**To turn the deploy half on**, make an Environment called `production` and
give it:

| | What |
| --- | --- |
| `vars.DEPLOY_HOST` | the host to ssh to — also the switch: the job is skipped while this is empty |
| `vars.DEPLOY_USER` | the account to ssh as |
| `vars.DEPLOY_PATH` | the directory on that host holding the compose file |
| `vars.DEPLOY_ORIGIN` | the public origin, for the smoke check |
| `secrets.DEPLOY_SSH_KEY` | a private key for that account |

The compose file on the host names `ghcr.io/<owner>/<repo>:latest`; the deploy
is `docker compose pull && docker compose up -d` and nothing else.

**Rolling back** is pulling the previous tag: change the compose file's image
to `:v1.2.2`, `docker compose up -d`, and run `node tools/smoke.js <origin>`
against it. There is nothing automatic about this and it is not pretended
otherwise.

**There is no staging environment**, and that is a decision rather than an
omission. The production instance is the only instance, so every deploy is the
first time that code has run anywhere but CI — which is the honest reason the
release gate is a deliberate tag and the smoke check runs after the deploy
rather than instead of one.

---

---

## Troubleshooting

**Diagrams do not render.** Check the browser console for Mermaid parse errors —
a block that fails to parse falls back to showing its source. If nothing renders
at all, the CDN is likely unreachable; every third-party asset is pinned with an
SRI hash, so a hash mismatch also blocks the script. The engine is fetched on
demand rather than up front, so this shows up as a toast when a document with a
diagram is opened, not as a failure at startup — and the same goes for maths and
syntax highlighting.

**A notebook does not render.** It has to be valid `.ipynb` JSON. Very large
outputs are worth trimming before upload.

**Documents do not appear.** They must be in `public/docs/` (or
`$MDVIEWER_STATE_DIR/docs/`) with a supported extension. The list is served from
disk on each request, so a refresh is enough — no restart needed.

**Editing controls are missing.** They are hidden rather than disabled for
accounts that cannot use them. Check the role on your account — a `viewer` sees
no create, upload or edit buttons.

**Locked out entirely.** If the last admin password is lost, stop the server
and empty the accounts: `sqlite3 data/azadocs.db "DELETE FROM users"` (sessions
go with them). The next boot sees no account, seeds a fresh admin and prints a
new generated password once. Documents, folders, shares and links are
untouched.

**"Too many failed attempts."** That account is locked for 15 minutes. It clears
on a server restart, since the limiter is in memory.

**Link previews point at the wrong host.** `PUBLIC_BASE_URL` wins over
everything, including the request. Check what it is set to.

---
