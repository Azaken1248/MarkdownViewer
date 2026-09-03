/* The metadata a page carries into somebody else's window.
 *
 * Three renderers over the same handful of facts: the app shell, the standalone
 * share page, and the object the oEmbed and GraphQL endpoints answer with.
 *
 * Every URL here is absolute and built from the resolved base URL rather than
 * from the request, because a crawler resolves og:image against nothing and a
 * spoofed Host header must not be able to point a preview somewhere else.
 */

const { fillTemplate } = require("./html");
const { isAbsoluteHttpUrl, toAbsoluteUrl } = require("./urls");
const {
  SITE_NAME,
  EMBED_TITLE,
  EMBED_DESCRIPTION,
  EMBED_THEME_COLOR,
  FAVICON_PATH,
  EMBED_IMAGE_PATH,
  EMBED_IMAGE_WIDTH,
  EMBED_IMAGE_HEIGHT,
  EMBED_IMAGE_ALT,
  APPLE_TOUCH_ICON_PATH,
  ICON_PATH,
  EMBED_AUTHOR_NAME
} = require("../site");

function createEmbed({ getBaseUrl }) {
  function buildEmbedMeta(req, requestedUrl) {
    const baseUrl = getBaseUrl(req);
    const canonicalUrl = isAbsoluteHttpUrl(requestedUrl)
      ? requestedUrl
      : toAbsoluteUrl(baseUrl, "/");

    return {
      title: EMBED_TITLE,
      description: EMBED_DESCRIPTION,
      siteName: SITE_NAME,
      canonicalUrl,
      faviconUrl: toAbsoluteUrl(baseUrl, FAVICON_PATH),
      appleTouchIconUrl: toAbsoluteUrl(baseUrl, APPLE_TOUCH_ICON_PATH),
      iconUrl: toAbsoluteUrl(baseUrl, ICON_PATH),
      // Absolute, because a crawler resolves og:image against nothing.
      imageUrl: toAbsoluteUrl(baseUrl, EMBED_IMAGE_PATH),
      imageWidth: EMBED_IMAGE_WIDTH,
      imageHeight: EMBED_IMAGE_HEIGHT,
      imageAlt: EMBED_IMAGE_ALT,
      themeColor: EMBED_THEME_COLOR,
      oEmbedUrl: `${toAbsoluteUrl(baseUrl, "/oembed")}?url=${encodeURIComponent(canonicalUrl)}`,
      baseUrl
    };
  }

  function renderIndexWithEmbedMeta(htmlTemplate, embedMeta) {
    const replacements = {
      __EMBED_TITLE__: embedMeta.title,
      __EMBED_DESCRIPTION__: embedMeta.description,
      __EMBED_CANONICAL_URL__: embedMeta.canonicalUrl,
      __EMBED_SITE_NAME__: embedMeta.siteName,
      __EMBED_FAVICON_URL__: embedMeta.faviconUrl,
      __EMBED_APPLE_TOUCH_ICON_URL__: embedMeta.appleTouchIconUrl,
      __EMBED_IMAGE_URL__: embedMeta.imageUrl,
      __EMBED_IMAGE_WIDTH__: embedMeta.imageWidth,
      __EMBED_IMAGE_HEIGHT__: embedMeta.imageHeight,
      __EMBED_IMAGE_ALT__: embedMeta.imageAlt,
      __EMBED_THEME_COLOR__: embedMeta.themeColor,
      __EMBED_OEMBED_URL__: embedMeta.oEmbedUrl
    };

    return fillTemplate(htmlTemplate, replacements);
  }

  function renderShareHtml(template, {
    title,
    description,
    baseUrl,
    shareUrl = "",
    modifiedAt = ""
  }) {
    const replacements = {
      // The browser tab keeps the site name for context; og:title does not,
      // because the unfurl already shows og:site_name on its own line.
      __SHARE_TITLE__: `${title} | ${SITE_NAME}`,
      __SHARE_OG_TITLE__: title,
      __SHARE_DESCRIPTION__: description,
      __SHARE_URL__: shareUrl || toAbsoluteUrl(baseUrl, "/"),
      __SHARE_SITE_NAME__: SITE_NAME,
      __SHARE_AUTHOR__: EMBED_AUTHOR_NAME,
      __SHARE_MODIFIED__: modifiedAt,
      __SHARE_FAVICON_URL__: toAbsoluteUrl(baseUrl, FAVICON_PATH),
      __SHARE_APPLE_TOUCH_ICON_URL__: toAbsoluteUrl(baseUrl, APPLE_TOUCH_ICON_PATH),
      __SHARE_IMAGE_URL__: toAbsoluteUrl(baseUrl, EMBED_IMAGE_PATH),
      __SHARE_IMAGE_WIDTH__: EMBED_IMAGE_WIDTH,
      __SHARE_IMAGE_HEIGHT__: EMBED_IMAGE_HEIGHT,
      __SHARE_IMAGE_ALT__: EMBED_IMAGE_ALT,
      __SHARE_THEME_COLOR__: EMBED_THEME_COLOR
    };

    return fillTemplate(template, replacements);
  }

  return { buildEmbedMeta, renderIndexWithEmbedMeta, renderShareHtml };
}

module.exports = { createEmbed };
