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

The documents are files on disk in their real folders, readable without this
app — that is deliberate, and it means `tar` over the state directory is a
complete backup. The database is SQLite in WAL mode, so a copy taken while the
app is running can be torn; use `sqlite3 data/azadocs.db ".backup out.db"`, or
stop the container for the length of the copy.

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

Request logging is one line per request on stdout (`LOG_REQUESTS`, on by
default; `LOG_STATIC` adds the asset requests, off by default because they
drown out everything else). The security events — sign-ins, failures, lockouts,
permission refusals — are a separate JSON-lines stream controlled by
`AUDIT_LOG`.
