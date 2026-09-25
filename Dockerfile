# A reproducible way to run this, because "npm start on a host somewhere" only
# existed in the head of whoever set it up.
#
# Two stages. The first has the toolchain: the dev dependencies, esbuild for
# the optional bundles, and the compiler better-sqlite3 needs — it is a native
# module, so its binary is built for the platform the image is built for and
# cannot be copied in from a laptop. The second carries none of that.
#
# Debian slim rather than Alpine on purpose: better-sqlite3 publishes prebuilt
# binaries for glibc and not for musl, so Alpine means compiling it every
# build, for an image that is not much smaller once the compiler is in it.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# The lockfile first, so a change to the source does not re-resolve the tree.
# `npm ci` installs exactly what it pins, and fails if the two have drifted.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The bundles are optional at runtime — with none, the pages serve the scripts
# they name — but 3 requests beats 106, and this is the one place where doing
# it costs a deployment nothing. Then drop everything only the build needed,
# keeping the better-sqlite3 binary that was just compiled.
RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Never root. The `node` images already ship a non-root `node` user at uid and
# gid 1000, and reusing it rather than adding another is what makes 1000 a
# number this repository's documentation can promise — a fresh useradd picks a
# system id that would move the next time this file changed. That number is
# what a bind-mounted host directory has to be chowned to; a named volume
# takes its ownership from the image and needs none of it, which is why that
# is what the compose file in docs/OPERATIONS.md uses.
RUN mkdir -p /state && chown node:node /state

COPY --from=build --chown=node:node /app /app

USER node

ENV MDVIEWER_STATE_DIR=/state \
    PORT=4321
VOLUME ["/state"]
EXPOSE 4321

# /healthz reads the document directory, so this says storage is reachable
# rather than only that the process has not exited — which is the failure that
# actually happens. It answers 503 when it is not, and node's own fetch is
# used so the image needs neither curl nor wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
