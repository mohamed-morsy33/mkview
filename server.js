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

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

// ---------------------------------------------------------------------------
// 1. OAuth: kick off the flow from your own site (Dropbox requires this —
//    users can't start auth from inside dropbox.com).
// ---------------------------------------------------------------------------
app.get('/auth/login', async (req, res) => {
  try {
    const dbx = new Dropbox({
      clientId: DROPBOX_APP_KEY,
      clientSecret: DROPBOX_APP_SECRET,
      fetch,
    });
    const authUrl = await dbx.auth.getAuthenticationUrl(
      DROPBOX_REDIRECT_URI,
      req.query.return_to || undefined, // state: carry return URL through the OAuth flow
      'code',
      'offline', // token_access_type: get a refresh token, not just a short-lived one
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

// ---------------------------------------------------------------------------
// 2. OAuth callback: exchange the code for tokens, stash in session.
//    In production, persist refresh_token per-user in a real DB instead.
// ---------------------------------------------------------------------------
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
    // tokenResponse.result contains access_token, refresh_token, expires_in
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
// 3. The Extension entry point.
//
//    IMPORTANT — verify this against your App Console config and the current
//    Extensions Guide before relying on it: Dropbox redirects the user's
//    browser to whatever "action URL" you registered for the extension,
//    passing file context as query params. The exact param names have
//    changed across Dropbox's docs revisions, so this handler defensively
//    checks a few likely shapes. Log req.query once against a real click to
//    confirm the actual shape for your app, then trim this down.
// ---------------------------------------------------------------------------
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
    // Bounce through auth, then return here with the same file reference.
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

    res.send(renderPage(meta.result.name, safeHtml));
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

function renderPage(title, bodyHtml) {
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
  <link rel="stylesheet" href="/static/preview.css" />
</head>
<body>
  <header class="preview-header">
    <span class="filename">${escapeHtml(title)}</span>
  </header>
  <main class="markdown-body">
    ${bodyHtml}
  </main>
  <footer class="preview-footer">
    Markdown Preview &middot; Dropbox Extension
  </footer>
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Markdown preview extension running on http://localhost:${PORT}`);
});