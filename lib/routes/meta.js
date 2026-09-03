/* The three endpoints that describe the app rather than serve it.
 *
 * /graphql answers embed metadata for an unfurler, /oembed answers the same
 * facts in the shape oEmbed consumers expect, and /healthz proves the storage
 * the app depends on is readable — which is the failure that matters, unlike a
 * constant "ok" that only proves the process is up.
 */

const express = require("express");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema, NoSchemaIntrospectionCustomRule } = require("graphql");
const { EMBED_AUTHOR_NAME } = require("../site");

/* Schema introspection is on by default in graphql-http and lets anyone
 * enumerate the API. There is no GraphiQL UI served here, so blocking
 * introspection is the actual control; the caller turns it on explicitly when
 * working on the schema locally.
 */
function createMetaRoutes({
  buildEmbedMeta,
  getDocs,
  enableIntrospection
}) {
  const router = express.Router();

  const graphQLSchema = buildSchema(`
    type EmbedMeta {
      title: String!
      description: String!
      siteName: String!
      canonicalUrl: String!
      faviconUrl: String!
      themeColor: String!
      oEmbedUrl: String!
    }

    type Query {
      embedMeta(url: String): EmbedMeta!
      docsCount: Int!
      health: String!
    }
  `);

  const graphQLRootValue = {
    embedMeta: ({ url }, context) => buildEmbedMeta(context?.request, url),
    docsCount: async () => (await getDocs()).length,
    health: () => "ok"
  };

  router.all(
    "/graphql",
    createHandler({
      schema: graphQLSchema,
      rootValue: graphQLRootValue,
      validationRules: enableIntrospection ? [] : [NoSchemaIntrospectionCustomRule],
      context: (request) => ({ request: request.raw || request })
    })
  );

  // A health check a process manager or uptime monitor can actually use. The
  // GraphQL `health` field returns a constant string and so only proves the
  // process is up; this proves the storage the app depends on is readable, which
  // is the failure that matters. Returns 503 when it is not, so a monitor sees a
  // failure rather than a cheerful 200.
  router.get("/healthz", async (req, res) => {
    const startedAt = Date.now();

    try {
      const docs = await getDocs();
      res.json({
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        documents: docs.length,
        checkMs: Date.now() - startedAt
      });
    } catch (error) {
      console.error("Health check failed", error);
      res.status(503).json({
        status: "unhealthy",
        error: "Document storage is not readable",
        checkMs: Date.now() - startedAt
      });
    }
  });

  router.get("/oembed", (req, res) => {
    const requestedUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    const embedMeta = buildEmbedMeta(req, requestedUrl);

    res.json({
      version: "1.0",
      type: "link",
      provider_name: embedMeta.siteName,
      provider_url: embedMeta.baseUrl,
      author_name: EMBED_AUTHOR_NAME,
      author_url: embedMeta.baseUrl,
      title: embedMeta.title,
      url: embedMeta.canonicalUrl,
      // The raster icon, not the favicon: a consumer of this is an unfurler, and
      // an unfurler that is handed an SVG shows nothing.
      thumbnail_url: embedMeta.iconUrl,
      thumbnail_width: 512,
      thumbnail_height: 512,
      cache_age: 3600
    });
  });

  return router;
}

module.exports = { createMetaRoutes };
