# AzaDocs

A self-hosted markdown library. Browse a nested file tree, search the full text
of every document, and edit in place. Mermaid diagrams, LaTeX and Jupyter
notebooks render inline.

Live at <https://md.azaken.com>.

The client is vanilla JavaScript with no framework and no required build step.
The server is Express 5. The documents themselves are the source of truth:
plain files in real directories, readable and editable without this app.

## Features

- **Full-text search** across every document, with snippets and match
  highlighting.
- **Edit in place** on the page you are reading, block by block, or as
  markdown source. Only the blocks you touch are rewritten.
- **Diagrams, maths and notebooks** rendered inline: Mermaid, KaTeX, and
  `.ipynb` files. Notebook code cells can run Python in the browser via
  Pyodide, on request.
- **A visual flowchart builder** that reads and writes ordinary Mermaid, so a
  diagram stays a diagram in the file.
- **Live task lists**: click a checkbox while reading and that one character
  changes in the file.
- **Paste screenshots** straight into a document. Images are stored by content
  hash, so the same picture is kept once.
- **Saved links**, filed into groups, each card carrying the target page's own
  title, description and icon.
- **Accounts and roles**, private by default. Individual documents can be
  published as standalone share links.
- **Real addresses**: every document has one, such as
  `/Notes/Roadmap/day-008.md`, that can be typed, refreshed and shared.

## Requirements

Node 20 or newer. No database server, no external services.

## Quick start

```bash
git clone https://github.com/Azaken1248/MarkdownViewer.git
cd MarkdownViewer
npm install
npm start
```

Open <http://localhost:4321>.

With no accounts yet, the server creates an admin, generates a password and
prints it once:

```
  No accounts existed, so an admin was created:

      username: aza
      password: k3n9Q2xWv8mLp0Ra

  That password was generated just now and is printed here once.
```

Sign in with it. You will be required to change it before anything else. For a
scripted setup, set `SEED_ADMIN_PASSWORD` instead; the value is never written
to the log, and the forced change still applies.

### With Docker

```bash
docker compose up -d
docker compose logs -f     # the generated password appears here, once
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for a production setup: a reverse
proxy, backups, health checks and metrics.

## Configuration

Everything is an environment variable; there is no config file. Two of them
decide more than their names suggest — `PUBLIC_BASE_URL` controls whether the
session cookie is `Secure`, and `TRUST_PROXY` controls which address the rate
limiter and audit log believe. [docs/OPERATIONS.md](docs/OPERATIONS.md#the-variables-that-are-security-settings)
explains both before you need to know.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4321` | Port to listen on. |
| `PUBLIC_READS` | `false` | When `true`, anyone can read every document without signing in — the behaviour before accounts existed. Leave it off unless you want the whole library public; individual documents can be shared without it. |
| `PUBLIC_BASE_URL` | `https://md.azaken.com` | Origin used to build canonical, `og:*` and oEmbed URLs. Set it to `http://localhost:4321` when working locally if you want link previews to point at your own machine. |
| `TRUST_PROXY` | `false` | Set to `true` (or an Express trust-proxy value like `loopback`) only when running behind a reverse proxy. Controls whether `X-Forwarded-*` is honoured. |
| `AUDIT_LOG` | `data/audit.jsonl` | Where the security events go: a path, `stderr` to hand them to whatever collects the process's output, or `off`. |
| `SEED_ADMIN_PASSWORD` | *(generated)* | The first admin's password, for a scripted setup. Used only when no account exists yet; not echoed to the log. Without it one is generated and printed once at first boot. |
| `ALLOWED_ORIGINS` | *(none)* | Extra origins the CSRF origin check accepts, comma-separated, for a deployment reached under more than one name. `PUBLIC_BASE_URL` and loopback on `PORT` are always accepted. |
| `MDVIEWER_STATE_DIR` | the checkout | Moves the documents, recycle bin and organizer somewhere else, so runtime state can live outside the repo. The test suite uses it to point at a temp directory. |
| `LOG_REQUESTS` | `true` | One log line per request, written when the response finishes. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. How the volume comes down without a deploy. |
| `LOG_FORMAT` | `text` | `text` for a person reading `docker compose logs`, `json` for something collecting it. |
| `LOG_STATIC` | `false` | Include static assets in that log. Off by default because they drown out everything else. |
| `METRICS_TOKEN` | *(none)* | Turns on `/metrics` and is the bearer token it wants. Unset, that route is a 404. |
| `ENABLE_GRAPHQL_INTROSPECTION` | `false` | Re-enables GraphQL schema introspection for local schema work. |

## Documentation

| | |
| --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | Everything the interface does: editing, diagrams, notebooks, links, sharing, keyboard shortcuts |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying it: Docker, reverse proxies, backups, logging, metrics, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is put together, and why: the storage model, the module layout, what loads when |
| [docs/API.md](docs/API.md) | The HTTP API and the GraphQL read endpoint |
| [docs/TESTING.md](docs/TESTING.md) | The test suites, and the checks that run beside them |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Conventions for changes: commits, tests, documentation |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |

## Development

```bash
npm test                 # every suite
npm test auth            # one suite
npm run lint
npm run typecheck
```

| Script | What it does |
| --- | --- |
| `npm start` | Run the server |
| `npm run build` | Optional: bundle each page's scripts and stylesheets into one of each |
| `npm test` | Run every test suite |
| `npm run coverage` | The same suite under c8; the report of what it never reaches lands in `coverage/` |
| `npm test <suite>` | Run one suite. An unknown name prints the list |
| `npm run images` | Redraw the PNGs that link previews use |
| `npm run lint` | ESLint over the server, the client and the tests |
| `npm run lint:fix` | The same, applying the fixes it can |
| `npm run typecheck` | Check the JSDoc types with `tsc --checkJs`. No TypeScript, no build |
| `npm run audit:cdn` | Advisories and integrity for the eight libraries loaded from a CDN, which `npm audit` cannot see |
| `npm run backup` | A consistent copy of the state directory, taken while the app is running |
| `npm run restore` | Unpack one into a directory and check the database came across |

The test suites start real servers against temporary directories and drive the
real client in jsdom; they do not touch your documents. See
[docs/TESTING.md](docs/TESTING.md) for what each one covers.

## Security

Private by default: every read needs a session unless `PUBLIC_READS` is on.
Rendered markdown is sanitized with DOMPurify, the Content-Security-Policy
allows no inline script, and share links are stored as hashes rather than
tokens.

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please do not open a
public issue for one.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: one change per commit, a
prose commit subject, a test for anything a test could catch, and `npm test`,
`npm run lint` and `npm run typecheck` green before it is pushed.

## License

MIT. See [LICENSE](LICENSE).

You may use, modify and distribute this code, including commercially. The one
condition is attribution: keep the copyright notice and the licence text with
it. If you build something on this, a link back is appreciated but not
required.
