(function () {
  'use strict';

  const editToggle = document.getElementById('edit-toggle');
  const saveBtn = document.getElementById('save-btn');
  const previewView = document.getElementById('preview-view');
  const editorView = document.getElementById('editor-view');
  const editor = document.getElementById('editor');
  const editorPreview = document.getElementById('editor-preview');
  const toastEl = document.getElementById('toast');

  let editMode = false;
  let toastTimeout = null;

  const md = window.markdownit({ html: false, linkify: true, breaks: true });

  function renderMarkdown(src) {
    const raw = md.render(src);
    return DOMPurify.sanitize(raw);
  }

  function showToast(message, type) {
    toastEl.textContent = message;
    toastEl.className = 'toast toast--visible toast--' + type;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      toastEl.className = 'toast';
    }, 3000);
  }

  function updatePreview() {
    editorPreview.innerHTML = renderMarkdown(editor.value);
  }

  function enterEditMode() {
    editMode = true;
    previewView.style.display = 'none';
    editorView.style.display = 'grid';
    editToggle.querySelector('span').textContent = 'Preview';
    editToggle.classList.add('header-btn--active');
    saveBtn.style.display = '';
    updatePreview();
    editor.focus();
  }

  function enterPreviewMode() {
    editMode = false;
    editorView.style.display = 'none';
    previewView.style.display = '';
    editToggle.querySelector('span').textContent = 'Edit';
    editToggle.classList.remove('header-btn--active');
    saveBtn.style.display = 'none';
  }

  editToggle.addEventListener('click', function () {
    if (editMode) {
      enterPreviewMode();
    } else {
      enterEditMode();
    }
  });

  saveBtn.addEventListener('click', function () {
    saveFile();
  });

  editor.addEventListener('input', updatePreview);

  editor.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      if (editMode) {
        enterPreviewMode();
      } else {
        enterEditMode();
      }
    }
  });

  function saveFile() {
    var content = editor.value;
    var filePath = window.__FILE_PATH__;

    showToast('Saving...', 'info');

    fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: content }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.ok) {
          showToast('Saved successfully', 'success');
        } else {
          showToast(data.error || 'Save failed', 'error');
        }
      })
      .catch(function () {
        showToast('Network error — could not save', 'error');
      });
  }

  document.getElementById('preview-view').addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (link) {
      event.preventDefault();
    }
  });
})();
