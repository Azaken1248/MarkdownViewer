# Cart Documentation Viewer

A modern markdown documentation viewer with support for Mermaid ER diagrams, syntax highlighting, and full-text search.

## Features

- Markdown Support: View and edit markdown files with live preview
- Full-Text Search: Search across documents, filenames, and content
- Mermaid Diagrams: Render Entity-Relationship diagrams inline
- Syntax Highlighting: Code blocks with Catppuccin theme
- Responsive Design: Works on desktop and mobile devices
- Fast & Lightweight: Built with vanilla JS, no heavy frameworks

## Project Structure

```
├── public/
│   ├── index.html          # Main HTML file
│   ├── css/
│   │   └── app.css        # Global styles with Catppuccin theme
│   ├── js/
│   │   └── app.js         # Frontend application logic
│   └── docs/
│       ├── ERD-Guideline-Cart-Application.md
│       └── SRS-Cart-Application.md
├── server.js              # Express server
├── package.json           # Dependencies
├── package-lock.json      # Locked dependency versions
└── README.md             # This file
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Available Scripts

- `npm start` - Start the development server
- `npm test` - Run tests (if configured)

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Express.js
- **Markdown**: marked.js
- **Diagrams**: Mermaid 11.x
- **Syntax Highlighting**: highlight.js with Catppuccin theme
- **Sanitization**: DOMPurify
- **Fonts**: Space Grotesk, JetBrains Mono
- **Icons**: Font Awesome 6

## Configuration

The application runs on port 3000 by default. To change the port:

```bash
PORT=8080 npm start
```

For production unfurl/embed accuracy, set a public base URL so metadata always uses your real domain:

```bash
PUBLIC_BASE_URL=https://docs.example.com npm start
```

## Document Management

### Uploading Documents

1. Click the "Upload" button in the header
2. Select a markdown file (.md, .markdown, .mmd, .mermaid)
3. The file will be saved to `public/docs/`

### Editing Documents

1. Click the "Edit" button when viewing a document
2. Make your changes in the editor
3. Click "Save" to persist changes

### Creating Documents

1. Click the "New" button in the header
2. Enter a filename and content
3. Click "Save" to create the document

## Color Scheme

The application uses the Catppuccin Mocha color palette:
- **Base**: `#1e1e2e`
- **Surface 0**: `#313244`
- **Surface 1**: `#45475a`
- **Text**: `#cdd6f4`
- **Blue**: `#89b4fa`
- **Mauve**: `#cba6f7`

## API Endpoints

- `GET /api/docs` - List all documents
- `GET /api/docs/:file` - Get document content
- `POST /api/docs` - Create a new document
- `PUT /api/docs/:file` - Update a document
- `POST /api/docs/:file/delete` - Soft or hard delete (`mode: "soft" | "hard"`), always moved to `deleted_markdowns/`
- `GET /api/recycle-bin` - List recycle bin documents (soft-deleted)
- `GET /api/recycle-bin/:entry/content` - Get recycle bin document content
- `POST /api/recycle-bin/:entry/restore` - Restore a soft-deleted document back to docs
- `POST /api/recycle-bin/:entry/hard-delete` - Move recycle bin document to hard-deleted archive
- `ALL /graphql` - GraphQL endpoint (includes GraphiQL) with `embedMeta`, `docsCount`, and `health`
- `GET /oembed` - oEmbed metadata endpoint for unfurl/link-preview consumers

## Deployment

To deploy this application:

1. Ensure Node.js is installed on your server
2. Clone or upload the project
3. Run `npm install` to install dependencies
4. Set the PORT environment variable if needed
5. Run `npm start` or use a process manager like PM2

Example with PM2:
```bash
npm install -g pm2
pm2 start server.js --name "cart-docs"
pm2 save
pm2 startup
```

## Troubleshooting

### Diagrams not rendering
- Ensure Mermaid CDN is accessible
- Check browser console for parsing errors
- Verify ER diagram syntax is correct

### Documents not appearing
- Check that files are in `public/docs/` directory
- Verify file extensions are `.md`, `.markdown`, `.mmd`, or `.mermaid`
- Restart the server after adding files manually

## License

Proprietary - 7-Eleven, Inc.
