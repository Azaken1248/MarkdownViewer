/* What this site says it is.
 *
 * The strings a crawler, an unfurler and a browser tab see. They live together
 * because they are one answer to one question — what is this thing called and
 * what does it look like — and because every page that renders them was
 * previously reaching into the server's scope for them one at a time.
 */

const SITE_NAME = "AzaDocs";
const EMBED_TITLE = "AzaDocs";
const EMBED_DESCRIPTION = "A personal markdown library: browse, search and edit documents, with Mermaid diagrams and Jupyter notebooks rendered inline.";
// The dark background, because a card sitting on a light one looks broken.
const EMBED_THEME_COLOR = "#06090a";
const FAVICON_PATH = "/favicon.svg";
// A raster icon as well as the SVG favicon: unfurlers do not render SVG.
const EMBED_IMAGE_PATH = "/img/embed-card.png";
const EMBED_IMAGE_WIDTH = "1200";
const EMBED_IMAGE_HEIGHT = "630";
const EMBED_IMAGE_ALT = "AzaDocs";
const APPLE_TOUCH_ICON_PATH = "/img/icon-180.png";
const ICON_PATH = "/img/icon-512.png";
const EMBED_AUTHOR_NAME = "Azaken1248";

module.exports = {
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
};
