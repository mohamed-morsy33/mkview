<div align="center">
  <img src="./assets/mkview_banner.png" alt="Project Logo" width="512" height="1028">
  <h1>Mkview</h1>
</div>

<div align="center">

![License](https://img.shields.io/github/license/mohamed-morsy33/mkview)
![Last Commit](https://img.shields.io/github/last-commit/mohamed-morsy33/mkview)
![Issues](https://img.shields.io/github/issues/mohamed-morsy33/mkview)
![Stars](https://img.shields.io/github/stars/mohamed-morsy33/mkview?style=social)

</div>

<div align="center">
  <h1>Demo</h1>
  <video src="https://github.com/user-attachments/assets/ac7c0d21-d684-4fae-b863-a3e1c025508a" width="720" height="auto" controls muted autoplay loop></video>
</div>


# Features

### Markdown Preview

- Full GitHub-flavored Markdown rendering (headings, lists, tables, blockquotes, code blocks, task lists)
- Server-side rendering with markdown-it + DOMPurify sanitization
- Premium typography with Inter and JetBrains Mono fonts
- Responsive design — works on desktop and mobile
- Print-friendly layout
- Custom scrollbar and smooth animations

### Live Editor
- Side-by-side markdown editor with real-time preview
- Split pane layout (stacked on mobile)
- Toggle between preview and edit mode via button or Ctrl+E / Cmd+E
Save to Dropbox
- Save edits directly back to Dropbox via API
- One-click Save button in the header
- Keyboard shortcut: Ctrl+S / Cmd+S
- Toast notifications for save status (saving, success, error)

### Authentication
- Dropbox OAuth 2.0 with offline token support
- Seamless auth flow — redirects back to the file after login
- Session-based token storage

### Dropbox Extension
- Opens from Dropbox's "Open with" menu
- Passes file context automatically
- Supports .md, .markdown, and .txt files
