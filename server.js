require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Dropbox } = require('dropbox');
const fetch = require('node-fetch');
const MarkdownIt = require('markdown-it');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const app = express();
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const DOMPurify = createDOMPurify(new JSDOM('').window);

const {
  DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET,
  DROPBOX_REDIRECT_URI,
  SESSION_SECRET,
  PORT = 8080,
} = process.env;

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: true },
  })
);

app.get('/auth/login', async (req, res) => {
  try {
    const dbx = new Dropbox({
      clientId: DROPBOX_APP_KEY,
      clientSecret: DROPBOX_APP_SECRET,
      fetch,
    });
    const authUrl = await dbx.auth.getAuthenticationUrl(
      DROPBOX_REDIRECT_URI,
      req.query.return_to || undefined, 
      'code',
      'offline', 
      undefined,
      undefined,
      false
    );
    res.redirect(authUrl);
  } catch (err) {
    console.error('Failed to build authentication URL:', err);
    res.status(500).send(renderError('Login Failed', 'Could not start the Dropbox login flow. Please try again.'));
  }
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send(renderError('Missing Code', 'The OAuth authorization code was not provided.'));

  try {
    const dbx = new Dropbox({
      clientId: DROPBOX_APP_KEY,
      clientSecret: DROPBOX_APP_SECRET,
      fetch,
    });
    const tokenResponse = await dbx.auth.getAccessTokenFromCode(
      DROPBOX_REDIRECT_URI,
      code
    );
    req.session.dropboxTokens = tokenResponse.result;

    // state carries the original /view URL from the auth/login step
    const returnTo = state || '/view';
    res.redirect(returnTo);
  } catch (err) {
    console.error('OAuth exchange failed:', err);
    res.status(500).send(renderError('Authorization Failed', 'The authorization process encountered an error. Please try again.'));
  }
});

app.get('/auth/success', (req, res) => {
  res.send(
    '<p>Authorized. You can close this tab and use "Open with Markdown Preview" from Dropbox.</p>'
  );
});

// ---------------------------------------------------------------------------
// 4. Save edited markdown back to Dropbox.
// ---------------------------------------------------------------------------
app.post('/save', async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'Missing file path or content.' });
  }

  const tokens = req.session.dropboxTokens;
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const dbx = new Dropbox({ accessToken: tokens.access_token, fetch });
    await dbx.filesUpload({
      path: filePath,
      contents: Buffer.from(content, 'utf-8'),
      mode: { '.tag': 'overwrite' },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save file:', err);
    res.status(500).json({ error: 'Could not save the file to Dropbox.' });
  }
});

app.get('/view', async (req, res) => {
  console.log('Extension launch query params:', req.query);

  const fileId =
    req.query.file_id ||
    req.query.id ||
    (req.query.context && safeParseFileId(req.query.context));

  if (!fileId) {
    return res
      .status(400)
      .send(renderError('No File Selected', 'No file reference was received from Dropbox. Open a Markdown file and try again.'));
  }

  const tokens = req.session.dropboxTokens;
  if (!tokens) {
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/auth/login?return_to=${returnTo}`);
  }

  try {
    const dbx = new Dropbox({ accessToken: tokens.access_token, fetch });

    // Confirm it's actually a markdown file and get its path.
    const meta = await dbx.filesGetMetadata({ path: fileId });
    const path = meta.result.path_display;

    if (!/\.(md|markdown|txt)$/i.test(path)) {
      return res.status(415).send(renderError('Unsupported File', 'This extension only previews Markdown files (.md, .markdown, .txt).'));
    }

    const download = await dbx.filesDownload({ path });
    const content = download.result.fileBinary.toString('utf-8');

    const rawHtml = md.render(content);
    const safeHtml = DOMPurify.sanitize(rawHtml);

    res.send(renderPage(meta.result.name, safeHtml, path, content));
  } catch (err) {
    console.error('Failed to load file from Dropbox:', err);
    res.status(500).send(renderError('Load Failed', 'Could not load the file from Dropbox. Please check your connection and try again.'));
  }
});

function safeParseFileId(context) {
  try {
    const parsed = JSON.parse(context);
    return parsed.file_id || parsed.id;
  } catch {
    return null;
  }
}

function renderPage(title, bodyHtml, filePath, rawContent) {
  const escapedContent = rawContent
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
  const escapedPath = filePath
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)} — Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;650&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="icon" type="image/png" href="/static/favicon.png" />
  <link rel="stylesheet" href="/static/preview.css" />
</head>
<body>
  <header class="preview-header">
    <span class="filename">${escapeHtml(title)}</span>
    <div class="header-actions">
      <button id="edit-toggle" class="header-btn" title="Edit markdown">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span>Edit</span>
      </button>
      <button id="save-btn" class="header-btn header-btn--save" title="Save (Ctrl+S)" style="display:none;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span>Save</span>
      </button>
    </div>
  </header>

  <div id="preview-view" class="markdown-body">
    ${bodyHtml}
  </div>

  <div id="editor-view" class="editor-container" style="display:none;">
    <div class="editor-pane">
      <div class="editor-pane-header">Markdown</div>
      <textarea id="editor" spellcheck="false">${escapeHtml(rawContent)}</textarea>
    </div>
    <div class="editor-pane">
      <div class="editor-pane-header">Preview</div>
      <div id="editor-preview" class="markdown-body editor-preview-content"></div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <footer class="preview-footer">
    Markdown Preview &middot; Dropbox Extension
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
  <script src="/static/preview.js"></script>
  <script>
    window.__INITIAL_CONTENT__ = \`${escapedContent}\`;
    window.__FILE_PATH__ = \`${escapedPath}\`;
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderError(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;650&display=swap" rel="stylesheet" />
  <link rel="icon" type="image/png" href="/static/favicon.png" />
  <link rel="stylesheet" href="/static/preview.css" />
</head>
<body>
  <div class="error-page">
    <div class="error-card">
      <div class="error-icon">!</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a href="/view">Try Again</a>
    </div>
  </div>
</body>
</html>`;
}

app.use('/static', express.static(`${__dirname}/public`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Markdown preview extension running on http://localhost:${PORT}`);
});