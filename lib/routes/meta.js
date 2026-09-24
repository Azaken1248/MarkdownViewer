/* The three endpoints that describe the app rather than serve it.
 *
 * /graphql is a read-only view of the library for a script that wants it in
 * one question, /oembed answers embed facts in the shape oEmbed consumers
 * expect, and /healthz proves the storage
 * the app depends on is readable — which is the failure that matters, unlike a
 * constant "ok" that only proves the process is up.
 */

const express = require("express");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema, GraphQLError, NoSchemaIntrospectionCustomRule } = require("graphql");
const { serializeFolders } = require("../docs/organizer");
const { EMBED_AUTHOR_NAME } = require("../site");

/* A read-only view of the library, as a graph.
 *
 * The REST API is what the client is built on and it is private; this is the
 * thing a script reaches for when it wants the library in one question rather
 * than a walk over several: every document under a folder with just its title
 * and size, one document with its text, a search with snippets, the links
 * filed under a group. Fields are read only when asked, so listing a thousand
 * documents does not open a thousand files and asking for one's content does.
 *
 * Read-only on purpose. Writes need CSRF, roles and the sanitising the REST
 * routes do, and there is nothing a mutation here would add except a second
 * copy of all of that. It answers with exactly what the REST reads answer
 * with — the same functions, not a parallel set — so the two cannot describe
 * a document differently.
 *
 * Behind requireRead, like every other read. It used to be behind nothing,
 * and handed an anonymous caller the number of documents in a library that
 * /api/docs would not show them. requireRead already does the right thing
 * under PUBLIC_READS.
 *
 * Three things a public GraphQL endpoint is expected to have and did not:
 * it answers POST only, so a query cannot be put in a URL and land in a proxy
 * log; a query may not nest deeper than the schema has reason to; and a query
 * may not name more than a few hundred fields, aliases included, since an
 * alias is how a single request asks for the same thing ten thousand times.
 *
 * Schema introspection is off by default. There is no GraphiQL served here,
 * so blocking introspection is the actual control; it is turned on
 * explicitly when working on the schema locally.
 */

const MAX_QUERY_DEPTH = 6;
const MAX_QUERY_FIELDS = 200;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;

/* Two validation rules in the shape graphql-js expects: a visitor that reports
 * through the context. The same shape as NoSchemaIntrospectionCustomRule,
 * which is the one that was already here.
 */
function depthLimitRule(maxDepth) {
  return (context) => {
    let depth = 0;
    return {
      SelectionSet: {
        enter(node) {
          depth += 1;
          if (depth > maxDepth) {
            context.reportError(new GraphQLError(
              `Query is nested ${depth} deep; the limit is ${maxDepth}.`, { nodes: [node] }));
          }
        },
        leave() {
          depth -= 1;
        }
      }
    };
  };
}

function fieldLimitRule(maxFields) {
  return (context) => {
    let fields = 0;
    let reported = false;
    return {
      Field(node) {
        fields += 1;
        if (fields > maxFields && !reported) {
          reported = true;
          context.reportError(new GraphQLError(
            `Query names more than ${maxFields} fields, aliases included.`, { nodes: [node] }));
        }
      }
    };
  };
}

function clampLimit(value, fallback = DEFAULT_LIST_LIMIT) {
  const n = Number.isInteger(value) && value > 0 ? value : fallback;
  return Math.min(n, MAX_LIST_LIMIT);
}

const graphQLSchema = buildSchema(`
  """A document in the library. \`content\` is read only when asked for."""
  type Document {
    file: String!
    title: String!
    size: Int!
    updatedAt: String!
    folderId: String
    folderName: String
    folderPath: String
    content: String!
  }

  """A folder in the tree, with its place in it."""
  type Folder {
    id: String!
    name: String!
    parentId: String
    depth: Int!
    path: String!
    order: Int!
  }

  """One result of a search: where the words were found, and a snippet around them."""
  type SearchResult {
    file: String!
    title: String!
    folderName: String
    score: Int!
    snippet: String!
    updatedAt: String!
  }

  """
  A saved link. \`icon\` is an address to fetch the icon from, "" when the
  site had none, and null when it has never been asked.
  """
  type Link {
    id: String!
    url: String!
    title: String!
    description: String!
    siteName: String!
    note: String!
    groups: [String!]!
    icon: String
    fetched: Boolean!
    createdAt: String!
    createdBy: String
    refreshedAt: String
  }

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
    """Every document, or those directly in one folder. Ordered as the app lists them."""
    documents(folderId: String, limit: Int): [Document!]!
    """One document by its path, or null if there is no such document."""
    document(file: String!): Document
    """The folder tree, depth-first, as the app draws it."""
    folders: [Folder!]!
    """Full-text search: the same words, the same order, the same snippets as the search box."""
    search(query: String!, limit: Int): [SearchResult!]!
    """Saved links, all of them or those filed under one group."""
    links(group: String): [Link!]!
    docsCount: Int!
    health: String!
    embedMeta(url: String): EmbedMeta!
  }
`);

// A document as the graph answers it: the listing's record, plus content
// as a function, which graphql-js calls only if the query asks for it.
function documentNode(doc, readDocument) {
  return {
    ...doc,
    content: async () => (await readDocument(doc.file)).content
  };
}

/* What each field answers with. The same functions the REST routes use, so
 * the graph cannot drift from what /api says.
 */
function graphQLRootValue(deps) {
  const { buildEmbedMeta, getDocs, readOrganizerState, searchDocuments, readDocument, listLinks } = deps;

  return {
  embedMeta: ({ url }, context) => buildEmbedMeta(context?.request, url),
  docsCount: async () => (await getDocs()).length,
  health: () => "ok",

  documents: async ({ folderId, limit }) => {
    const docs = await getDocs(await readOrganizerState());
    const wanted = folderId === undefined || folderId === null
      ? docs
      : docs.filter((doc) => (doc.folderId || null) === (folderId || null));
    return wanted.slice(0, clampLimit(limit)).map((doc) => documentNode(doc, readDocument));
  },

  document: async ({ file }) => {
    const read = await readDocument(file);
    if (!read) {
      return null;
    }

    const docs = await getDocs(await readOrganizerState());
    const listed = docs.find((doc) => doc.file === read.file);
    return listed ? { ...documentNode(listed), content: read.content } : null;
  },

  folders: async () => serializeFolders((await readOrganizerState()).folders),

  search: async ({ query, limit }) => {
    const { matches } = await searchDocuments(query, "docs");
    return matches.slice(0, clampLimit(limit)).map((match) => ({
      file: match.file,
      title: match.title,
      folderName: match.folderName || null,
      score: Math.round(match.score),
      snippet: match.snippet,
      updatedAt: match.updatedAt
    }));
  },

  links: ({ group }) => {
    const all = listLinks();
    const wanted = typeof group === "string" && group.trim()
      ? all.filter((link) => (link.groups || []).some(
        (name) => name.toLowerCase() === group.trim().toLowerCase()))
      : all;
    return wanted.map((link) => ({ ...link, icon: link.icon === undefined ? null : link.icon }));
  }
};
}

const validationRulesFor = (enableIntrospection) => [
  depthLimitRule(MAX_QUERY_DEPTH),
  fieldLimitRule(MAX_QUERY_FIELDS),
  ...(enableIntrospection ? [] : [NoSchemaIntrospectionCustomRule])
];

/* The routes themselves: the graph, the health check and the oEmbed endpoint.
 */
function createMetaRoutes(deps) {
  const { buildEmbedMeta, getDocs, requireRead, enableIntrospection } = deps;
  const router = express.Router();

  router.post(
    "/graphql",
    requireRead,
    createHandler({
      schema: graphQLSchema,
      rootValue: graphQLRootValue(deps),
      validationRules: validationRulesFor(enableIntrospection),
      context: (request) => ({ request: request.raw || request })
    })
  );

  // POST only. A GET puts the query in the URL, and a URL is what a proxy
  // logs; saying 405 rather than falling through to a page says why.
  router.all("/graphql", (req, res) => {
    res.set("Allow", "POST");
    res.status(405).json({ error: "Use POST for /graphql." });
  });

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
