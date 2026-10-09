# deploy

Configuration for watching a deployment, kept here rather than in a paragraph
of `docs/OPERATIONS.md` because the difference between the two is an afternoon
of work and a decision.

| | |
| --- | --- |
| `prometheus.yml` | the scrape job, with the bearer token read from a file |
| `alerts.yml` | six rules — see below |
| `alertmanager.yml` | where a page goes, and it goes nowhere until you say |
| `docker-compose.monitoring.yml` | the app, Prometheus, Alertmanager, blackbox and node-exporter together |

```bash
echo -n "the-value-of-METRICS_TOKEN" > deploy/metrics-token
chmod 600 deploy/metrics-token
docker compose -f deploy/docker-compose.monitoring.yml up -d
```

## Three things this cannot supply

1. **A host to run it on.** The compose file names `ghcr.io/…:latest`, which
   the release workflow publishes; everything else is local.
2. **Somewhere for a page to go.** `alertmanager.yml` has a receiver that
   delivers nothing, on purpose and loudly. An alert that fires into the void
   is worse than no alert, because it looks like monitoring.
3. **The real mountpoint.** `AzaDocsDiskFilling` matches on
   `mountpoint="/state"`, which is a guess about the host. Until it is the real
   one the rule matches nothing and will never fire.

## The rules

| Alert | When | Why this one |
| --- | --- | --- |
| `AzaDocsDown` | the scrape fails for 2m | the only one that always matters |
| `AzaDocsUnhealthy` | `/healthz` fails for 2m | the failure that actually happens: the process is up and the state directory is not readable, so every request 500s while `/metrics` answers perfectly well |
| `AzaDocsErrorRate` | 5xx over 1% for 5m | something broke and nobody reported it |
| `AzaDocsSlow` | p95 over 2s for 10m | the listing is linear in the number of documents, and the load harness says it is what degrades first |
| `AzaDocsCacheThrash` | evicting steadily with a hit rate under 50%, for 30m | the three byte budgets were picked once with no data; this is how you find out they were wrong |
| `AzaDocsDiskFilling` | under 20% free for 15m | documents, uploads and the recycle bin only grow |

The last two are the ones a generic template would not have. They are about
this app's own numbers, and both are tickets rather than pages: neither is an
outage, and a page nobody acts on is a page nobody reads.
