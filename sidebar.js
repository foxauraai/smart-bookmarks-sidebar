const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// sidebar.js - Smart Bookmarks Sidebar Core Logic

// State management
let bookmarkTree = [];
let folderColors = {};
let expandedFolders = new Set();
let clickCounts = {};
let selectedFolderId = null;
let currentContextMenuFolderId = null;
let currentContextMenuElement = null;
let draggedId = null;
let activeDialogCallback = null;
let tintFilesEnabled = false;
let inlineRenameEnabled = false;
let tintMode = 'all'; // 'all' or 'selected'
let activeWheelCleanup = null;

// 18 curated colors covering the full spectrum
const colorsList = [
  { name: 'Black',       value: '#000000' },
  { name: 'Grey',        value: '#6b7280' },
  { name: 'Magenta',     value: '#d946ef' },
  { name: 'Red',         value: '#ef4444' },
  { name: 'Rose',        value: '#f43f5e' },
  { name: 'Pink',        value: '#ec4899' },
  { name: 'Orange',      value: '#f97316' },
  { name: 'Amber',       value: '#f59e0b' },
  { name: 'Yellow',      value: '#eab308' },
  { name: 'Green',       value: '#22c55e' },
  { name: 'Emerald',     value: '#10b981' },
  { name: 'Teal',        value: '#14b8a6' },
  { name: 'Cyan',        value: '#06b6d4' },
  { name: 'Sky',         value: '#0ea5e9' },
  { name: 'Blue',        value: '#3b82f6' },
  { name: 'Indigo',      value: '#6366f1' },
  { name: 'Violet',      value: '#7c3aed' },
  { name: 'Purple',      value: '#a855f7' },
];

// Document Ready
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

// Initialize extension UI and data
async function initApp() {
  await loadState();
  setupEventListeners();
  await refreshBookmarks();
}

// Load configurations from storage
async function loadState() {
  // Helper: read from sync storage
  const getSyncStorage = (keys) => {
    return new Promise((resolve) => {
      browserAPI.storage.sync.get(keys, (data) => {
        if (browserAPI.runtime.lastError || !data) resolve({});
        else resolve(data);
      });
    });
  };

  // Helper: read from local storage
  const getLocalStorage = (keys) => {
    return new Promise((resolve) => {
      browserAPI.storage.local.get(keys, (data) => {
        if (browserAPI.runtime.lastError || !data) resolve({});
        else resolve(data);
      });
    });
  };

  // folderColors/expandedFolders/clickCounts come from sync (with local fallback)
  const syncData = await getSyncStorage(['folderColors', 'expandedFolders', 'clickCounts']);

  // All UI settings are saved to local — always read them from local
  const localData = await getLocalStorage([
    'folderColors', 'expandedFolders', 'clickCounts',
    'saveLocation', 'tintFilesEnabled', 'tintMode',
    'inlineRenameEnabled', 'syncColorsEnabled'
  ]);

  // Merge: prefer sync for folderColors/expandedFolders/clickCounts if available
  folderColors    = syncData.folderColors    || localData.folderColors    || {};
  expandedFolders = new Set(syncData.expandedFolders || localData.expandedFolders || []);
  clickCounts     = syncData.clickCounts     || localData.clickCounts     || {};

  // Apply UI settings from local storage
  if (localData.tintFilesEnabled   !== undefined) tintFilesEnabled   = localData.tintFilesEnabled;
  if (localData.inlineRenameEnabled !== undefined) inlineRenameEnabled = localData.inlineRenameEnabled;
  if (localData.tintMode)                          tintMode            = localData.tintMode;

  const saveLocationSelect = document.getElementById('select-save-location');
  if (localData.saveLocation && saveLocationSelect) {
    saveLocationSelect.value = localData.saveLocation;
    selectedFolderId = localData.saveLocation;
  } else {
    selectedFolderId = '1'; // Default: Bookmarks Bar
  }

  // Apply loaded settings to UI immediately so they survive sidebar close/reopen
  const tintChk       = document.getElementById('chk-tint-files');
  const renameChk     = document.getElementById('chk-inline-rename');
  const syncColorsChk = document.getElementById('chk-sync-colors');
  const tintModeOpts  = document.getElementById('tint-mode-options');

  if (renameChk) renameChk.checked = inlineRenameEnabled;

  if (tintChk) {
    tintChk.checked = tintFilesEnabled;
    if (tintModeOpts) tintModeOpts.style.display = tintFilesEnabled ? 'block' : 'none';
    document.querySelectorAll('input[name="tint-mode"]').forEach(r => {
      if (r.value === tintMode) r.checked = true;
    });
  }

  // Sync colors toggle — load and persist its state
  if (localData.syncColorsEnabled !== undefined && syncColorsChk) {
    syncColorsChk.checked = localData.syncColorsEnabled;
  }
  if (syncColorsChk) {
    syncColorsChk.addEventListener('change', () => {
      browserAPI.storage.local.set({ syncColorsEnabled: syncColorsChk.checked });
    });
  }
}

// Save folder colors to storage
function saveColors() {
  const data = { folderColors };
  browserAPI.storage.sync.set(data, () => {
    if (browserAPI.runtime.lastError) {
      browserAPI.storage.local.set(data);
    }
  });
}

// Save expanded folder state
function saveExpanded() {
  const data = { expandedFolders: Array.from(expandedFolders) };
  browserAPI.storage.local.set(data);
}

// Save click counts for "Most Visited"
function saveClickCounts() {
  const data = { clickCounts };
  browserAPI.storage.local.set(data);
}

// Event Listeners Configuration
function setupEventListeners() {
  // Search inputs
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  
  searchInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    if (value.length > 0) {
      clearSearchBtn.style.display = 'flex';
      renderSearchResults(value);
    } else {
      clearSearchBtn.style.display = 'none';
      switchTab('tree');
      renderTree();
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    switchTab('tree');
    renderTree();
    searchInput.focus();
  });

  // Hotkey listener: Ctrl+F to focus search, Alt+A to save active tab
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      saveCurrentTab();
    }
  });

  // Action Buttons
  document.getElementById('btn-quick-save').addEventListener('click', saveCurrentTab);
  document.getElementById('btn-add-bookmark').addEventListener('click', () => showBookmarkDialog());
  document.getElementById('btn-add-folder').addEventListener('click', () => showFolderDialog());
  
  // Settings Panel Toggles
  const settingsBtn = document.getElementById('btn-settings');
  const closeSettingsBtn = document.getElementById('btn-close-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const saveLocationSelect = document.getElementById('select-save-location');
  const resetColorsBtn = document.getElementById('btn-reset-colors');

  settingsBtn.addEventListener('click', () => {
    populateSettingsFolders();
    // Restore save location after populateSettingsFolders may have rebuilt the select
    if (saveLocationSelect && selectedFolderId) saveLocationSelect.value = selectedFolderId;
    const tintChk = document.getElementById('chk-tint-files');
    const renameChk = document.getElementById('chk-inline-rename');
    if (renameChk) renameChk.checked = inlineRenameEnabled;
    if (tintChk) {
      tintChk.checked = tintFilesEnabled;
      const modeOpts = document.getElementById('tint-mode-options');
      if (modeOpts) modeOpts.style.display = tintFilesEnabled ? 'block' : 'none';
      document.querySelectorAll('input[name="tint-mode"]').forEach(r => { if (r.value === tintMode) r.checked = true; });
    }
    settingsPanel.classList.add('open');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
  });

  saveLocationSelect.addEventListener('change', (e) => {
    selectedFolderId = e.target.value;
    browserAPI.storage.local.set({ saveLocation: selectedFolderId });
    showToast(`Default folder updated!`, 'info');
  });

  const inlineRenameChk = document.getElementById('chk-inline-rename');
  if (inlineRenameChk) {
    inlineRenameChk.checked = inlineRenameEnabled;
    inlineRenameChk.addEventListener('change', () => {
      inlineRenameEnabled = inlineRenameChk.checked;
      browserAPI.storage.local.set({ inlineRenameEnabled });
    });
  }

  const tintFilesChk = document.getElementById('chk-tint-files');
  const tintModeOptions = document.getElementById('tint-mode-options');
  const tintModeRadios = document.querySelectorAll('input[name="tint-mode"]');

  const updateTintModeVisibility = () => {
    if (tintModeOptions) tintModeOptions.style.display = tintFilesEnabled ? 'block' : 'none';
  };

  if (tintFilesChk) {
    tintFilesChk.checked = tintFilesEnabled;
    updateTintModeVisibility();
    tintModeRadios.forEach(r => { if (r.value === tintMode) r.checked = true; });

    tintFilesChk.addEventListener('change', () => {
      tintFilesEnabled = tintFilesChk.checked;
      browserAPI.storage.local.set({ tintFilesEnabled });
      updateTintModeVisibility();
      renderTree();
    });

    tintModeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        tintMode = radio.value;
        browserAPI.storage.local.set({ tintMode });
        renderTree();
      });
    });
  }

  resetColorsBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to reset all custom folder colors?")) {
      folderColors = {};
      saveColors();
      renderTree();
      showToast("Colors reset successfully!", "info");
      settingsPanel.classList.remove('open');
    }
  });

  // Tabs management
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
      if (tabName === 'recent') {
        renderRecent();
      } else if (tabName === 'frequent') {
        renderFrequent();
      } else {
        renderTree();
      }
    });
  });

  // Global click hides context menus/popovers
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu') && !e.target.closest('.action-btn')) {
      hideContextMenu();
    }
    if (!e.target.closest('.color-picker-popover') && !e.target.closest('#cm-color-picker-trigger')) {
      hideColorPicker();
    }
  });

  // Custom Color Wheel listeners (handled dynamically in showColorPicker)

  // Context Menu Actions
  document.getElementById('cm-add-bookmark').addEventListener('click', () => {
    showBookmarkDialog(currentContextMenuFolderId);
    hideContextMenu();
  });

  document.getElementById('cm-add-folder').addEventListener('click', () => {
    showFolderDialog(currentContextMenuFolderId, 'new');
    hideContextMenu();
  });

  document.getElementById('cm-rename').addEventListener('click', () => {
    if (currentContextMenuElement) {
      const nameSpan = currentContextMenuElement.querySelector('.item-name');
      startInlineRename(currentContextMenuFolderId, nameSpan);
    }
    hideContextMenu();
  });

  document.getElementById('cm-move-to-folder').addEventListener('click', () => {
    showMoveDialog(currentContextMenuFolderId);
    hideContextMenu();
  });

  document.getElementById('cm-color-picker-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    // Find the folder row element to keep it visible while picking
    const folderRow = document.querySelector(`#bookmark-${currentContextMenuFolderId} > .tree-row`);
    const anchorRect = folderRow ? folderRow.getBoundingClientRect() : e.target.closest('li').getBoundingClientRect();
    showColorPicker(anchorRect, currentContextMenuFolderId);
  });

  document.getElementById('cm-delete').addEventListener('click', () => {
    browserAPI.bookmarks.get(currentContextMenuFolderId, (nodes) => {
      if (nodes && nodes[0]) {
        const node = nodes[0];
        const isFolder = !node.url;
        const isSystem = isSystemFolder(node);
        if (isFolder) {
          if (isSystem) {
            if (confirm(`"${node.title || 'Untitled Folder'}" is a system folder and cannot be deleted itself. Would you like to delete all of its contents?`)) {
              browserAPI.bookmarks.getChildren(node.id, (children) => {
                const promises = children.map(child => {
                  return new Promise((resolve) => {
                    if (child.url) {
                      browserAPI.bookmarks.remove(child.id, resolve);
                    } else {
                      browserAPI.bookmarks.removeTree(child.id, resolve);
                    }
                  });
                });
                Promise.all(promises).then(() => {
                  showToast("System folder cleared", "success");
                  refreshBookmarks();
                });
              });
            }
          } else {
            if (confirm(`Are you sure you want to delete the folder "${node.title || 'Untitled Folder'}" and all its contents?`)) {
              browserAPI.bookmarks.removeTree(node.id, () => {
                showToast("Folder deleted", "success");
              });
            }
          }
        } else {
          if (confirm(`Are you sure you want to delete the bookmark "${node.title || node.url}"?`)) {
            browserAPI.bookmarks.remove(node.id, () => {
              showToast("Bookmark deleted", "success");
            });
          }
        }
      }
    });
    hideContextMenu();
  });

  // Modal Dialog Actions
  const dialogOverlay = document.getElementById('dialog-overlay');
  const dialogCancel = document.getElementById('dialog-btn-cancel');
  const dialogConfirm = document.getElementById('dialog-btn-confirm');
  const dialogInput = document.getElementById('dialog-input');
  const dialogInputUrl = document.getElementById('dialog-input-url');

  dialogCancel.addEventListener('click', () => closeDialog());

  dialogConfirm.addEventListener('click', () => {
    if (activeDialogCallback) {
      activeDialogCallback();
    }
  });

  const handleDialogKeydown = (e) => {
    if (e.key === 'Enter') {
      dialogConfirm.click();
    }
    if (e.key === 'Escape') {
      dialogCancel.click();
    }
  };

  dialogInput.addEventListener('keydown', handleDialogKeydown);
  dialogInputUrl.addEventListener('keydown', handleDialogKeydown);

  // Sync with browser's native bookmark events in real-time
  browserAPI.bookmarks.onCreated.addListener(async () => { await refreshBookmarks(); });
  browserAPI.bookmarks.onRemoved.addListener(async () => { await refreshBookmarks(); });
  browserAPI.bookmarks.onChanged.addListener(async () => { await refreshBookmarks(); });
  browserAPI.bookmarks.onMoved.addListener(async () => { await refreshBookmarks(); });

  // Prevent bounce/overscroll at both ends of the content area
  const contentArea = document.querySelector('.content-area');
  contentArea.addEventListener('wheel', (e) => {
    const { scrollTop, scrollHeight, clientHeight } = contentArea;
    const atTop    = scrollTop <= 0 && e.deltaY < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
    if (atTop || atBottom) e.preventDefault();
  }, { passive: false });
}

// Switch Sidebar tabs
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

// Fetch fresh bookmarks from browser API
async function refreshBookmarks() {
  return new Promise((resolve) => {
    browserAPI.bookmarks.getTree((tree) => {
      // The tree root contains the folders.
      bookmarkTree = tree[0]?.children || [];
      renderTree();
      resolve();
    });
  });
}

// Helper: Get list of folders recursively for dropdown selectors
function getFoldersList() {
  const list = [];
  function traverse(node, depth = 0) {
    if (!node.url) { // It's a folder
      const indent = '\u00A0\u00A0'.repeat(depth);
      list.push({ id: node.id, title: indent + (node.title || 'Root') });
      if (node.children) {
        node.children.forEach(child => traverse(child, depth + 1));
      }
    }
  }
  bookmarkTree.forEach(node => traverse(node, 0));
  return list;
}

// Populate the Settings "Quick Save Location" dropdown
function populateSettingsFolders() {
  const select = document.getElementById('select-save-location');
  if (!select) return;
  select.innerHTML = '';

  const list = getFoldersList();

  list.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.title;
    if (item.id === selectedFolderId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

// Populate target folder selection inside dialog
function populateFolderSelect(selectElement, selectedId) {
  selectElement.innerHTML = '';
  const list = getFoldersList();
  
  list.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.title;
    if (item.id === selectedId) {
      opt.selected = true;
    }
    selectElement.appendChild(opt);
  });
}

// Main Bookmarks Tree Render (Lazy & Recursive)
function renderTree() {
  const container = document.getElementById('bookmarks-tree');
  if (!container) return;
  
  if (bookmarkTree.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="32" height="32"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        <span>No bookmarks found</span>
      </div>`;
    return;
  }

  container.innerHTML = '';
  
  // Render direct children of the root nodes
  bookmarkTree.forEach(child => {
    const element = createTreeNode(child, 0);
    container.appendChild(element);
  });

  // Re-apply selected tints after re-render (for 'selected' mode)
  if (tintFilesEnabled && tintMode === 'selected') updateSelectedTints(selectedFolderId);
}

// Build a DOM Node for the tree view
function createTreeNode(node, depth, parentColor = null) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.id = `bookmark-${node.id}`;
  item.setAttribute('data-id', node.id);
  
  const isFolder = !node.url;
  item.classList.add(isFolder ? 'folder-item' : 'file-item');

  // Load folder custom color (hex, rgb, hsl, or legacy name lookup)
  if (isFolder && folderColors[node.id]) {
    const colorVal = folderColors[node.id];
    if (colorVal.startsWith('#') || colorVal.startsWith('rgb') || colorVal.startsWith('hsl') || colorVal.startsWith('var(')) {
      item.style.setProperty('--folder-color', colorVal);
    } else {
      const color = colorsList.find(c => c.name.toLowerCase() === colorVal.toLowerCase());
      if (color) {
        item.style.setProperty('--folder-color', color.value);
      }
    }
  }

  // Row content
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${(depth * 14) + 6}px`;
  row.setAttribute('data-id', node.id);

  // Apply parent folder color as background to direct bookmark children only (not subfolders)
  if (!isFolder && parentColor && tintFilesEnabled) {
    const parentId = node.parentId;
    const shouldTint = tintMode === 'all' || (tintMode === 'selected' && parentId === selectedFolderId);
    if (shouldTint) {
      row.style.setProperty('--file-tint', parentColor + '22');
      row.classList.add('file-tinted');
    }
  }
  
  // Active highlight
  if (node.id === selectedFolderId) {
    row.classList.add('active');
  }

  // Drag and Drop Draggable status (blocked for permanent system folders)
  const isSystem = isSystemFolder(node);
  if (!isSystem) {
    row.draggable = true;
    setupDragAndDropEvents(row, node, item);
  } else {
    row.draggable = false;
  }

  // Toggle button (only for folder)
  if (isFolder) {
    const toggle = document.createElement('div');
    toggle.className = 'folder-toggle';
    const isExpanded = expandedFolders.has(node.id);
    if (!isExpanded) {
      toggle.classList.add('collapsed');
    }
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M7 10l5 5 5-5H7z"/>
      </svg>`;
    
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolder(node.id, item, toggle);
    });
    row.appendChild(toggle);
  } else {
    // Spacer for alignment of items with folders
    const spacer = document.createElement('div');
    spacer.className = 'folder-toggle';
    spacer.style.opacity = 0;
    spacer.innerHTML = '&nbsp;';
    row.appendChild(spacer);
  }

  // Icon (Folder SVG or Favicon)
  const iconSpan = document.createElement('span');
  iconSpan.className = 'item-icon';

  if (isFolder) {
    iconSpan.innerHTML = `
      <svg class="folder-icon" viewBox="0 0 24 24" width="16" height="16">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>`;
  } else {
    // Favicon load with fallback
    const img = document.createElement('img');
    img.className = 'favicon-icon';
    const domain = getDomain(node.url);
    img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    img.onerror = () => {
      // Fallback text icon
      const initial = domain ? domain.charAt(0).toUpperCase() : 'B';
      const fallback = document.createElement('div');
      fallback.className = 'fallback-favicon';
      fallback.textContent = initial;
      
      // Give it a subtle random background color
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
      const index = Math.abs(hashCode(domain)) % colors.length;
      fallback.style.borderColor = colors[index];
      fallback.style.color = colors[index];
      
      if (img.parentNode) {
        img.parentNode.replaceChild(fallback, img);
      }
    };
    iconSpan.appendChild(img);
  }
  row.appendChild(iconSpan);

  // Title name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'item-name';
  nameSpan.textContent = node.title || (isFolder ? 'Untitled Folder' : node.url);
  row.appendChild(nameSpan);

  // Quick Action Buttons (Add, Context Menu, Edit, Delete)
  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (isFolder) {
    // "+ Add Subfolder" inside row actions
    const addBtn = document.createElement('button');
    addBtn.className = 'action-btn';
    addBtn.title = "Add Subfolder";
    addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>`;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderDialog(node.id, 'new');
    });
    actions.appendChild(addBtn);

    // "Color Picker dots" in actions
    const colorBtn = document.createElement('button');
    colorBtn.className = 'action-btn';
    colorBtn.title = "Choose Folder Color";
    colorBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
      </svg>`;
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Pass the folder row rect so the picker never covers the folder name/icon
      const rowRect = row.getBoundingClientRect();
      showColorPicker(rowRect, node.id);
    });
    actions.appendChild(colorBtn);
  }

  // Delete Action for folders and bookmarks
  // Note: Permanent system root folders cannot be natively deleted, but we allow clearing their contents
  if (!isSystem || isFolder) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn btn-delete';
    deleteBtn.title = isSystem ? "Clear Folder Contents" : (isFolder ? "Delete Folder" : "Delete Bookmark");
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isFolder) {
        if (isSystem) {
          if (confirm(`"${node.title || 'Untitled Folder'}" is a system folder and cannot be deleted itself. Would you like to delete all of its contents?`)) {
            browserAPI.bookmarks.getChildren(node.id, (children) => {
              const promises = children.map(child => {
                return new Promise((resolve) => {
                  if (child.url) {
                    browserAPI.bookmarks.remove(child.id, resolve);
                  } else {
                    browserAPI.bookmarks.removeTree(child.id, resolve);
                  }
                });
              });
              Promise.all(promises).then(() => {
                showToast("System folder cleared", "success");
                refreshBookmarks();
              });
            });
          }
        } else {
          if (confirm(`Are you sure you want to delete the folder "${node.title || 'Untitled Folder'}" and all its contents?`)) {
            browserAPI.bookmarks.removeTree(node.id, () => {
              showToast("Folder deleted", "success");
            });
          }
        }
      } else {
        if (confirm(`Are you sure you want to delete the bookmark "${node.title || node.url}"?`)) {
          browserAPI.bookmarks.remove(node.id, () => {
            showToast("Bookmark deleted", "success");
          });
        }
      }
    });
    actions.appendChild(deleteBtn);
  }

  // Row click actions
  row.addEventListener('click', (e) => {
    if (nameSpan.getAttribute('contenteditable') === 'true') return;
    
    if (isFolder) {
      // Folders: select to save current tab, and toggle open
      selectedFolderId = node.id;
      // Refresh active class in UI
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      updateSelectedTints(node.id);
      
      toggleFolder(node.id, item, item.querySelector('.folder-toggle'));
    } else {
      // Files: Open link in active tab (default click), Alt click/Middle click opens in new tab
      clickCounts[node.id] = (clickCounts[node.id] || 0) + 1;
      saveClickCounts();

      if (e.ctrlKey || e.metaKey || e.button === 1) {
        browserAPI.tabs.create({ url: node.url });
      } else {
        browserAPI.tabs.update({ url: node.url });
      }
    }
  });

  // Right-click context menu (both folder and file, context menu displays different actions)
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    selectedFolderId = node.id;
    document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('active'));
    row.classList.add('active');

    if (isFolder) {
      showContextMenu(e.clientX, e.clientY, node.id, item);
    } else {
      // Standard bookmarks context menu (simple rename / delete)
      showFileContextMenu(e.clientX, e.clientY, node.id, item);
    }
  });

  // Inline rename triggers on double click (blocked for permanent system folders)
  if (!isSystem) {
    nameSpan.addEventListener('dblclick', (e) => {
      if (!inlineRenameEnabled) return;
      e.stopPropagation();
      startInlineRename(node.id, nameSpan);
    });
  }

  row.appendChild(actions);
  item.appendChild(row);

  // Lazy Render Children!
  // Renders children elements only if folder is expanded
  if (isFolder && node.children) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    
    if (expandedFolders.has(node.id)) {
      // Expanded: Render immediately
      const thisFolderColor = folderColors[node.id] || null;
      node.children.forEach(child => {
        // Pass color only to direct bookmark children, not subfolders
        const colorForChild = child.url ? thisFolderColor : null;
        childrenContainer.appendChild(createTreeNode(child, depth + 1, colorForChild));
      });
      childrenContainer.style.display = 'block';
    } else {
      childrenContainer.style.display = 'none';
    }
    
    item.appendChild(childrenContainer);
  }

  return item;
}

// Update file tints when selected folder changes (for 'selected' mode)
function updateSelectedTints(folderId) {
  if (!tintFilesEnabled || tintMode !== 'selected') return;

  // Remove all existing tints
  document.querySelectorAll('.tree-row.file-tinted').forEach(row => {
    row.classList.remove('file-tinted');
    row.style.removeProperty('--file-tint');
  });

  if (!folderId) return;

  // Find the folder's color
  const color = folderColors[folderId];
  if (!color) return;

  // Find the folder's children container in the DOM and tint its direct file rows
  const folderEl = document.getElementById(`bookmark-${folderId}`);
  if (!folderEl) return;

  const childrenContainer = folderEl.querySelector(':scope > .folder-children');
  if (!childrenContainer) return;

  childrenContainer.querySelectorAll(':scope > .file-item > .tree-row').forEach(row => {
    row.style.setProperty('--file-tint', color + '22');
    row.classList.add('file-tinted');
  });
}

// Toggle folder open/collapsed state
function toggleFolder(folderId, liElement, toggleBtn) {
  const childrenContainer = liElement.querySelector('.folder-children');
  if (!childrenContainer) return;

  const isCollapsed = expandedFolders.has(folderId);

  if (isCollapsed) {
    // Collapse
    expandedFolders.delete(folderId);
    if (toggleBtn) toggleBtn.classList.add('collapsed');
    
    // Animate collapse
    childrenContainer.style.display = 'none';
  } else {
    // Expand
    expandedFolders.add(folderId);
    if (toggleBtn) toggleBtn.classList.remove('collapsed');
    
    // Clear and lazy-render children to save resources
    childrenContainer.innerHTML = '';
    
    // Find node in our local cache to get children list
    const node = findBookmarkNode(bookmarkTree, folderId);
    if (node && node.children) {
      const depth = getDepth(liElement);
      const thisFolderColor = folderColors[folderId] || null;
      node.children.forEach(child => {
        const colorForChild = child.url ? thisFolderColor : null;
        childrenContainer.appendChild(createTreeNode(child, depth + 1, colorForChild));
      });
    }
    childrenContainer.style.display = 'block';
  }
  
  saveExpanded();
}

// Helper: Check if a node is a permanent system folder (e.g. Bookmarks Bar, Other Bookmarks)
function isSystemFolder(node) {
  return !node || !node.parentId || node.parentId === '0' || node.parentId === 'root________';
}

// Helper: Calculate DOM hierarchy depth
function getDepth(element) {
  let depth = 0;
  let parent = element.parentNode;
  while (parent && !parent.classList.contains('tree-root')) {
    if (parent.classList.contains('folder-children')) {
      depth++;
    }
    parent = parent.parentNode;
  }
  return depth;
}

// Helper: Find bookmark node by ID recursively
function findBookmarkNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findBookmarkNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Save Current Active Tab
function saveCurrentTab() {
  browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (browserAPI.runtime.lastError || !tabs || tabs.length === 0) {
      showToast("Cannot read active tab info", "error");
      return;
    }
    const currentTab = tabs[0];
    const parentId = selectedFolderId || '1'; // Default folder
    
    browserAPI.bookmarks.create({
      parentId: parentId,
      title: currentTab.title,
      url: currentTab.url
    }, (newBookmark) => {
      if (browserAPI.runtime.lastError) {
        showToast("Error saving bookmark", "error");
        console.error(browserAPI.runtime.lastError);
      } else {
        // Expand folder to show saved item
        expandedFolders.add(parentId);
        saveExpanded();
        
        showToast(`Saved: ${newBookmark.title.slice(0, 20)}...`, "success");
        refreshBookmarks();
      }
    });
  });
}

// Show Folder creation Modal Dialog
function showFolderDialog(parentId = null) {
  const overlay = document.getElementById('dialog-overlay');
  const title = document.getElementById('dialog-title');
  const input = document.getElementById('dialog-input');
  const folderSelect = document.getElementById('dialog-folder-select');
  const confirmBtn = document.getElementById('dialog-btn-confirm');
  
  const formGroupUrl = document.getElementById('form-group-url');
  const formGroupFolder = document.getElementById('form-group-folder');

  overlay.style.display = 'flex';
  input.value = '';
  input.placeholder = "Folder name...";
  input.focus();

  title.textContent = "New Folder";
  confirmBtn.textContent = "Create Folder";
  
  if (formGroupUrl) formGroupUrl.style.display = 'none';
  
  if (parentId) {
    if (formGroupFolder) formGroupFolder.style.display = 'none';
  } else {
    if (formGroupFolder) formGroupFolder.style.display = 'block';
    populateFolderSelect(folderSelect, selectedFolderId || '1');
  }

  activeDialogCallback = () => {
    const folderName = input.value.trim();
    if (!folderName) {
      showToast("Folder name cannot be empty", "error");
      return;
    }
    
    const targetParentId = parentId || folderSelect.value || '1';

    browserAPI.bookmarks.create({
      parentId: targetParentId,
      title: folderName
    }, () => {
      // Auto-expand parent to show the new folder
      expandedFolders.add(targetParentId);
      saveExpanded();
      
      closeDialog(); // Use closeDialog to reset display wrappers
      showToast("Folder created", "success");
      refreshBookmarks();
    });
  };
}

// Show Bookmark creation Modal Dialog
function showBookmarkDialog(parentId = null) {
  const overlay = document.getElementById('dialog-overlay');
  const title = document.getElementById('dialog-title');
  const inputTitle = document.getElementById('dialog-input');
  const inputUrl = document.getElementById('dialog-input-url');
  const folderSelect = document.getElementById('dialog-folder-select');
  const confirmBtn = document.getElementById('dialog-btn-confirm');

  const formGroupUrl = document.getElementById('form-group-url');
  const formGroupFolder = document.getElementById('form-group-folder');

  overlay.style.display = 'flex';
  inputTitle.value = '';
  inputTitle.placeholder = "Bookmark Title...";
  inputTitle.focus();

  inputUrl.value = '';
  inputUrl.placeholder = "URL (https://...)";
  if (formGroupUrl) formGroupUrl.style.display = 'block';

  title.textContent = "New Bookmark";
  confirmBtn.textContent = "Add Bookmark";

  if (parentId) {
    if (formGroupFolder) formGroupFolder.style.display = 'none';
  } else {
    if (formGroupFolder) formGroupFolder.style.display = 'block';
    populateFolderSelect(folderSelect, selectedFolderId || '1');
  }

  activeDialogCallback = () => {
    const bTitle = inputTitle.value.trim() || "Untitled Bookmark";
    let bUrl = inputUrl.value.trim();
    const targetParentId = parentId || folderSelect.value || '1';

    if (!bUrl) {
      showToast("URL cannot be empty", "error");
      return;
    }

    // Add protocol if missing
    if (!/^https?:\/\//i.test(bUrl)) {
      bUrl = 'https://' + bUrl;
    }

    browserAPI.bookmarks.create({
      parentId: targetParentId,
      title: bTitle,
      url: bUrl
    }, () => {
      // Auto-expand parent to show the new bookmark
      expandedFolders.add(targetParentId);
      saveExpanded();
      
      closeDialog(); // Use closeDialog to reset display wrappers
      showToast("Bookmark created", "success");
      refreshBookmarks();
    });
  };
}

// Show Move-to-Folder Modal Dialog for any bookmark or folder
function showMoveDialog(nodeId) {
  browserAPI.bookmarks.get(nodeId, (nodes) => {
    if (!nodes || !nodes[0]) return;
    const node = nodes[0];

    const overlay = document.getElementById('dialog-overlay');
    const titleEl = document.getElementById('dialog-title');
    const input = document.getElementById('dialog-input');
    const folderSelect = document.getElementById('dialog-folder-select');
    const confirmBtn = document.getElementById('dialog-btn-confirm');
    const formGroupUrl = document.getElementById('form-group-url');
    const formGroupFolder = document.getElementById('form-group-folder');
    const headerIcon = document.querySelector('.dialog-header-icon svg');

    // Swap header icon to a move/folder icon
    if (headerIcon) {
      headerIcon.setAttribute('viewBox', '0 0 24 24');
      headerIcon.innerHTML = '<path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H9v-2h5v2zm3-4H9v-2h8v2z"/>';
    }

    overlay.style.display = 'flex';
    titleEl.textContent = `Move "${(node.title || node.url || 'Item').slice(0, 28)}"`;
    confirmBtn.textContent = 'Move Here';

    // Only show folder picker
    if (formGroupUrl) formGroupUrl.style.display = 'none';
    // Hide the entire title/name form group (label + input)
    const formGroupTitle = input.closest('.form-group');
    if (formGroupTitle) formGroupTitle.style.display = 'none';
    if (formGroupFolder) {
      formGroupFolder.style.display = 'block';
      // Pre-select current parent folder
      populateFolderSelect(folderSelect, node.parentId || '1');
      // Exclude the item itself if it's a folder (can't move into itself)
      if (!node.url) {
        Array.from(folderSelect.options).forEach(opt => {
          if (opt.value === node.id) opt.disabled = true;
        });
      }
    }

    activeDialogCallback = () => {
      const targetParentId = folderSelect.value;
      if (!targetParentId || targetParentId === node.parentId) {
        closeDialog();
        return;
      }

      // Guard against moving a folder into its own child
      if (!node.url && isChildOf(node.id, targetParentId)) {
        showToast("Cannot move a folder inside its own children", "error");
        return;
      }

      browserAPI.bookmarks.move(nodeId, { parentId: targetParentId }, () => {
        if (browserAPI.runtime.lastError) {
          showToast(`Move failed: ${browserAPI.runtime.lastError.message}`, "error");
        } else {
          expandedFolders.add(targetParentId);
          saveExpanded();
          showToast("Moved successfully", "success");
          refreshBookmarks();
        }
        closeDialog();
      });
    };
  });
}


function startInlineRename(nodeId, nameSpan) {
  nameSpan.setAttribute('contenteditable', 'true');
  
  // Highlight full text
  const range = document.createRange();
  range.selectNodeContents(nameSpan);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  nameSpan.focus();

  const finishRename = () => {
    nameSpan.removeAttribute('contenteditable');
    const newName = nameSpan.textContent.trim();
    
    if (newName) {
      browserAPI.bookmarks.update(nodeId, { title: newName }, () => {
        showToast("Renamed successfully", "success");
      });
    } else {
      // Revert to original
      refreshBookmarks();
    }
  };

  nameSpan.addEventListener('blur', finishRename, { once: true });
  nameSpan.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameSpan.blur(); // Triggers blur listener
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Revert text and blur
      refreshBookmarks();
    }
  });
}

// Shared helper: position an already-visible context menu so it never clips outside the viewport
function positionContextMenu(menu, x, y) {
  // Menu must be visible (display:block) before calling so getBoundingClientRect returns real size
  const { width, height } = menu.getBoundingClientRect();
  const pad = 6;
  const left = (x + width  > window.innerWidth)  ? window.innerWidth  - width  - pad : x;
  const top  = (y + height > window.innerHeight) ? window.innerHeight - height - pad : y;
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top  = `${Math.max(pad, top)}px`;
}

// Show Context Menu for Folder
function showContextMenu(x, y, folderId, element) {
  currentContextMenuFolderId = folderId;
  currentContextMenuElement = element;
  hideColorPicker();
  
  const menu = document.getElementById('custom-context-menu');
  const node = findBookmarkNode(bookmarkTree, folderId);
  const isSystem = isSystemFolder(node);

  // Configure visible items
  document.getElementById('cm-color-picker-trigger').style.display = 'flex';
  document.getElementById('cm-add-bookmark').style.display = 'flex';
  document.getElementById('cm-add-folder').style.display = 'flex';
  document.getElementById('cm-rename').style.display = isSystem ? 'none' : 'flex';
  document.getElementById('cm-move-to-folder').style.display = isSystem ? 'none' : 'flex';
  document.getElementById('cm-delete').style.display = 'flex';
  document.querySelector('#cm-delete span').textContent = isSystem ? "Clear Folder Contents" : "Delete Folder";

  // Show first so the browser can compute real dimensions, then reposition
  menu.style.left = '-9999px';
  menu.style.top  = '-9999px';
  menu.style.display = 'block';
  positionContextMenu(menu, x, y);
}

// Context menu for bookmarks (simplified options)
function showFileContextMenu(x, y, fileId, element) {
  currentContextMenuFolderId = fileId;
  currentContextMenuElement = element;
  hideColorPicker();
  
  const menu = document.getElementById('custom-context-menu');
  document.getElementById('cm-color-picker-trigger').style.display = 'none';
  document.getElementById('cm-add-bookmark').style.display = 'none';
  document.getElementById('cm-add-folder').style.display = 'none';
  document.getElementById('cm-rename').style.display = 'flex';
  document.getElementById('cm-move-to-folder').style.display = 'flex';
  document.getElementById('cm-delete').style.display = 'flex';
  document.querySelector('#cm-delete span').textContent = "Delete Bookmark";

  // Show first so the browser can compute real dimensions, then reposition
  menu.style.left = '-9999px';
  menu.style.top  = '-9999px';
  menu.style.display = 'block';
  positionContextMenu(menu, x, y);
}

function hideContextMenu() {
  const menu = document.getElementById('custom-context-menu');
  if (menu) menu.style.display = 'none';
}

// Draw the HSL color wheel on a canvas element with a given lightness (0-100)
function drawColorWheel(canvas, lightness = 50) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      if (dist <= radius) {
        const angle = Math.atan2(dy, dx);
        let hue = angle * (180 / Math.PI);
        if (hue < 0) hue += 360;
        const sat = (dist / radius) * 100;

        // Convert HSL to RGB inline for ImageData
        const [r, g, b] = hslToRgb(hue, sat, lightness);
        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      } else {
        data[idx + 3] = 0; // transparent outside circle
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// Convert HSL (0-360, 0-100, 0-100) to RGB (0-255)
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Get pixel colour from canvas at (x, y)
function getCanvasColor(canvas, x, y) {
  const ctx = canvas.getContext('2d');
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Custom Color Picker implementation
// anchorRect: getBoundingClientRect() of the trigger element
function showColorPicker(anchorRect, folderId) {
  const popover = document.getElementById('color-picker-popover');
  const grid = popover.querySelector('.color-grid');
  grid.innerHTML = '';
  
  const currentColor = folderColors[folderId] || '';

  // Populate preset swatches
  colorsList.forEach(color => {
    const cell = document.createElement('div');
    cell.className = 'color-option';
    cell.style.backgroundColor = color.value;
    cell.title = color.name;
    if (color.value === currentColor) {
      cell.classList.add('selected');
    }
    
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentColor === color.value) {
        delete folderColors[folderId];
      } else {
        folderColors[folderId] = color.value;
      }
      saveColors();
      renderTree();
      hideColorPicker();
      hideContextMenu();
      showToast(`Folder color: ${color.name}`, 'success');
    });
    
    grid.appendChild(cell);
  });

  // --- Canvas Color Wheel ---
  const canvas = document.getElementById('wheel-canvas');
  const preview = document.getElementById('wheel-color-preview');
  const confirmBtn = document.getElementById('btn-confirm-wheel');
  const lightnessSlider = document.getElementById('wheel-lightness');

  // Track last picked hue/sat so slider can re-pick same position
  let lastCanvasX = canvas.width / 2;
  let lastCanvasY = canvas.height / 2;
  let currentLightness = 50;

  // Reset slider to 50 each time picker opens
  if (lightnessSlider) lightnessSlider.value = 50;

  // Draw the wheel at current lightness
  drawColorWheel(canvas, currentLightness);

  // Track selected color
  let selectedWheelColor = currentColor.startsWith('hsl') || currentColor.startsWith('rgb') || currentColor.startsWith('#') ? currentColor : '#6366f1';
  if (preview) preview.style.backgroundColor = selectedWheelColor;

  let isDragging = false;

  const updateFromCanvas = (canvasX, canvasY) => {
    lastCanvasX = canvasX;
    lastCanvasY = canvasY;
    selectedWheelColor = getCanvasColor(canvas, canvasX, canvasY);
    if (preview) preview.style.backgroundColor = selectedWheelColor;
    const folderItem = document.getElementById(`bookmark-${folderId}`);
    if (folderItem) folderItem.style.setProperty('--folder-color', selectedWheelColor);
  };

  const pickColor = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const canvasX = Math.round((clientX - rect.left) * scaleX);
    const canvasY = Math.round((clientY - rect.top) * scaleY);

    const dx = canvasX - cx;
    const dy = canvasY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = canvas.width / 2;

    const clampedX = dist <= r ? canvasX : Math.round(cx + dx / dist * (r - 1));
    const clampedY = dist <= r ? canvasY : Math.round(cy + dy / dist * (r - 1));

    updateFromCanvas(clampedX, clampedY);
  };

  // Lightness slider redraws wheel and re-samples same position
  const onLightnessChange = () => {
    currentLightness = parseInt(lightnessSlider.value);
    drawColorWheel(canvas, currentLightness);
    updateFromCanvas(lastCanvasX, lastCanvasY);
  };
  lightnessSlider.addEventListener('input', onLightnessChange);

  const onDown = (e) => {
    isDragging = true;
    const pt = e.touches ? e.touches[0] : e;
    pickColor(pt.clientX, pt.clientY);
  };
  const onMove = (e) => {
    if (!isDragging) return;
    const pt = e.touches ? e.touches[0] : e;
    pickColor(pt.clientX, pt.clientY);
  };
  const onUp = () => { isDragging = false; };

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('touchstart', onDown, { passive: true });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: true });
  document.addEventListener('touchend', onUp);

  const cleanup = () => {
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('touchstart', onDown);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    lightnessSlider.removeEventListener('input', onLightnessChange);
  };

  if (activeWheelCleanup) activeWheelCleanup();
  activeWheelCleanup = cleanup;

  confirmBtn.onclick = (e) => {
    e.stopPropagation();
    folderColors[folderId] = selectedWheelColor;
    saveColors();
    renderTree();
    hideColorPicker();
    hideContextMenu();
    showToast('Custom color applied!', 'success');
  };

  // Hide the context menu so only the color picker is visible
  hideContextMenu();

  // Render off-screen first to measure real dimensions
  popover.style.left = '-9999px';
  popover.style.top  = '-9999px';
  popover.style.display = 'block';

  const { width: pW, height: pH } = popover.getBoundingClientRect();
  const pad = 10;
  const gap = 16;  // gap between picker and folder row
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;

  // anchorRect is the folder ROW — the picker must never overlap it.
  // Measure space in all four directions around that row.
  const spaceAbove = anchorRect.top  - pad;
  const spaceBelow = vh - anchorRect.bottom - pad;
  const spaceLeft  = anchorRect.left - pad;
  const spaceRight = vw - anchorRect.right - pad;

  // --- Vertical: pick the side with more room, prefer above ---
  let top;
  if (spaceAbove >= pH || spaceAbove >= spaceBelow) {
    // Place above — bottom edge of picker touches top of folder row
    top = anchorRect.top - pH - gap;
  } else {
    // Place below — top edge of picker touches bottom of folder row
    top = anchorRect.bottom + gap;
  }

  // --- Horizontal: align left edge of picker with left edge of folder row,
  //     flip right if it would overflow ---
  let left = anchorRect.left;
  if (left + pW > vw - pad) {
    left = vw - pW - pad;
  }

  // Final hard clamp — never bleed outside viewport
  left = Math.min(Math.max(pad, left), vw - pW - pad);
  top  = Math.min(Math.max(pad, top),  vh - pH - pad);

  popover.style.left = `${left}px`;
  popover.style.top  = `${top}px`;
}

function hideColorPicker() {
  const popover = document.getElementById('color-picker-popover');
  if (popover) popover.style.display = 'none';
  if (activeWheelCleanup) {
    activeWheelCleanup();
    activeWheelCleanup = null;
  }
}

// Flat search matching list builder
function renderSearchResults(query) {
  switchTab('tree'); // Render inside the tree view tab container
  const container = document.getElementById('bookmarks-tree');
  if (!container) return;
  
  container.innerHTML = '';
  
  const results = [];
  const lowercaseQuery = query.toLowerCase();

  function traverseSearch(node, path = []) {
    const matchesTitle = node.title && node.title.toLowerCase().includes(lowercaseQuery);
    const matchesUrl = node.url && node.url.toLowerCase().includes(lowercaseQuery);
    
    if (matchesTitle || matchesUrl) {
      results.push({ node, path: path.join(' > ') });
    }
    
    if (node.children) {
      const currentPath = node.title ? [...path, node.title] : path;
      node.children.forEach(child => traverseSearch(child, currentPath));
    }
  }

  bookmarkTree.forEach(node => traverseSearch(node));

  if (results.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('viewBox', '0 0 24 24');
    svgEl.setAttribute('width', '32');
    svgEl.setAttribute('height', '32');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z');
    svgEl.appendChild(pathEl);
    const noMatchSpan = document.createElement('span');
    noMatchSpan.textContent = `No matches found for "${query}"`;
    emptyState.appendChild(svgEl);
    emptyState.appendChild(noMatchSpan);
    container.appendChild(emptyState);
    return;
  }

  results.forEach(result => {
    const item = document.createElement('div');
    item.className = 'tree-item file-item';
    
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = '10px';

    const isFolder = !result.node.url;

    // Icon
    const iconSpan = document.createElement('span');
    iconSpan.className = 'item-icon';
    if (isFolder) {
      const folderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      folderSvg.setAttribute('viewBox', '0 0 24 24');
      folderSvg.setAttribute('width', '16');
      folderSvg.setAttribute('height', '16');
      folderSvg.setAttribute('fill', 'var(--text-muted)');
      const folderPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      folderPath.setAttribute('d', 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z');
      folderSvg.appendChild(folderPath);
      iconSpan.appendChild(folderSvg);
    } else {
      const img = document.createElement('img');
      img.className = 'favicon-icon';
      img.src = `https://www.google.com/s2/favicons?domain=${getDomain(result.node.url)}&sz=32`;
      img.onerror = () => {
        const fallback = document.createElement('div');
        fallback.className = 'fallback-favicon';
        fallback.textContent = 'B';
        img.parentNode.replaceChild(fallback, img);
      };
      iconSpan.appendChild(img);
    }
    row.appendChild(iconSpan);

    // Text & Path information
    const textWrapper = document.createElement('div');
    textWrapper.style.display = 'flex';
    textWrapper.style.flexDirection = 'column';
    textWrapper.style.overflow = 'hidden';
    textWrapper.style.gap = '2px';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'item-name';
    appendHighlightedText(titleSpan, result.node.title || result.node.url, query);
    textWrapper.appendChild(titleSpan);

    if (result.path) {
      const pathSpan = document.createElement('span');
      pathSpan.className = 'settings-help';
      pathSpan.style.fontSize = '10.5px';
      pathSpan.textContent = result.path;
      textWrapper.appendChild(pathSpan);
    }
    row.appendChild(textWrapper);

    row.addEventListener('click', () => {
      if (isFolder) {
        // Switch back to tree view and expand target folder
        document.getElementById('search-input').value = '';
        document.getElementById('btn-clear-search').style.display = 'none';
        expandedFolders.add(result.node.id);
        saveExpanded();
        renderTree();
        
        // Scroll to highlighted folder
        setTimeout(() => {
          const el = document.getElementById(`bookmark-${result.node.id}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      } else {
        clickCounts[result.node.id] = (clickCounts[result.node.id] || 0) + 1;
        saveClickCounts();
        browserAPI.tabs.update({ url: result.node.url });
      }
    });

    item.appendChild(row);
    container.appendChild(item);
  });
}

// Highlight matched search letters
function appendHighlightedText(container, text, search) {
  if (!text) return;
  const index = text.toLowerCase().indexOf(search.toLowerCase());
  if (index >= 0) {
    container.appendChild(document.createTextNode(text.substring(0, index)));
    const mark = document.createElement('span');
    mark.style.backgroundColor = 'rgba(234, 179, 8, 0.4)';
    mark.style.color = 'inherit';
    mark.style.fontWeight = '600';
    mark.style.borderRadius = '2px';
    mark.style.padding = '0 1px';
    mark.textContent = text.substring(index, index + search.length);
    container.appendChild(mark);
    container.appendChild(document.createTextNode(text.substring(index + search.length)));
  } else {
    container.textContent = text;
  }
}

// Recent Bookmarks Render
function renderRecent() {
  const container = document.getElementById('recent-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  browserAPI.bookmarks.getRecent(20, (recentItems) => {
    container.innerHTML = '';
    
    if (!recentItems || recentItems.length === 0) {
      container.innerHTML = '<div class="empty-state"><span>No recent bookmarks</span></div>';
      return;
    }

    recentItems.forEach(node => {
      container.appendChild(createFlatItemNode(node));
    });
  });
}

// Frequent Bookmarks Render
function renderFrequent() {
  const container = document.getElementById('frequent-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  // Find all file bookmarks recursively to filter by clickCount
  const list = [];
  function traverse(node) {
    if (node.url) {
      list.push(node);
    }
    if (node.children) {
      node.children.forEach(child => traverse(child));
    }
  }

  bookmarkTree.forEach(node => traverse(node));

  // Sort by clickCount
  const sorted = list
    .filter(item => clickCounts[item.id] > 0)
    .sort((a, b) => clickCounts[b.id] - clickCounts[a.id])
    .slice(0, 20);

  container.innerHTML = '';
  
  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="32" height="32"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        <span>No visited bookmarks yet. Open some bookmarks from this sidebar to see them here!</span>
      </div>`;
    return;
  }

  sorted.forEach(node => {
    const el = createFlatItemNode(node);
    // Append visits badge
    const visits = document.createElement('span');
    visits.className = 'settings-help';
    visits.style.fontSize = '11px';
    visits.style.marginRight = '8px';
    visits.style.backgroundColor = 'var(--bg-input)';
    visits.style.padding = '2px 6px';
    visits.style.borderRadius = '10px';
    visits.textContent = `${clickCounts[node.id]} visits`;
    el.querySelector('.tree-row').appendChild(visits);
    
    container.appendChild(el);
  });
}

// Helper: Make flat single row node for Recent/Frequent tabs
function createFlatItemNode(node) {
  const item = document.createElement('div');
  item.className = 'tree-item file-item';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = '8px';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'item-icon';
  const img = document.createElement('img');
  img.className = 'favicon-icon';
  img.src = `https://www.google.com/s2/favicons?domain=${getDomain(node.url)}&sz=32`;
  img.onerror = () => {
    const fallback = document.createElement('div');
    fallback.className = 'fallback-favicon';
    fallback.textContent = 'B';
    img.parentNode.replaceChild(fallback, img);
  };
  iconSpan.appendChild(img);
  row.appendChild(iconSpan);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'item-name';
  nameSpan.textContent = node.title || node.url;
  row.appendChild(nameSpan);

  row.addEventListener('click', () => {
    clickCounts[node.id] = (clickCounts[node.id] || 0) + 1;
    saveClickCounts();
    browserAPI.tabs.update({ url: node.url });
  });

  item.appendChild(row);
  return item;
}

// Drag & Drop event bindings on individual tree rows
function setupDragAndDropEvents(row, node, item) {
  // Each row keeps its own resolved drop position in a closure variable.
  // This avoids the shared global `dropPosition` going stale when the cursor
  // moves over child elements (icon, name span) that have no dragover listener.
  let localDropPosition = null;
  let autoExpandTimer = null;

  row.setAttribute('draggable', 'true');

  row.addEventListener('dragstart', (e) => {
    draggedId = node.id;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
  });

  row.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    clearDragOverClasses();
    draggedId = null;
    localDropPosition = null;
    clearTimeout(autoExpandTimer);
  });

  // dragenter: start auto-expand timer for collapsed folders
  row.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!node.url && !expandedFolders.has(node.id)) {
      autoExpandTimer = setTimeout(() => {
        toggleFolder(node.id, item, item.querySelector('.folder-toggle'));
      }, 700);
    }
  });

  row.addEventListener('dragleave', (e) => {
    // Only cancel when truly leaving this row (not entering a child element)
    if (!row.contains(e.relatedTarget)) {
      clearTimeout(autoExpandTimer);
      autoExpandTimer = null;
    }
  });

  // dragover: calculate drop zone and store in closure; DO NOT stopPropagation
  row.addEventListener('dragover', (e) => {
    e.preventDefault(); // required to allow drop — never stopPropagation here

    const activeDraggedId = draggedId;
    if (!activeDraggedId || node.id === activeDraggedId) return;

    const isFolder = !node.url;
    const isTopLevel = node.parentId === '0' || !node.parentId;
    const rect = row.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const h = rect.height;

    clearDragOverClasses();

    if (isFolder) {
      if (isTopLevel) {
        // Top-level system folders: always drop inside
        localDropPosition = 'inside';
        row.classList.add('drag-over-inside');
      } else if (relY < h * 0.25) {
        localDropPosition = 'above';
        row.classList.add('drag-over-above');
      } else if (relY > h * 0.75) {
        localDropPosition = 'below';
        row.classList.add('drag-over-below');
      } else {
        // Middle 50% of folder row → drop INSIDE the folder
        localDropPosition = 'inside';
        row.classList.add('drag-over-inside');
      }
    } else {
      // Bookmark (file) rows: above/below only
      if (relY < h * 0.5) {
        localDropPosition = 'above';
        row.classList.add('drag-over-above');
      } else {
        localDropPosition = 'below';
        row.classList.add('drag-over-below');
      }
    }
  });

  // drop: use the closure-local position — reliable regardless of child element cursor position
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation(); // stop from bubbling to item-level handler below

    clearTimeout(autoExpandTimer);
    const activeDraggedId = draggedId;
    clearDragOverClasses();

    if (!activeDraggedId || node.id === activeDraggedId || !localDropPosition) return;

    const pos = localDropPosition;
    localDropPosition = null;

    browserAPI.bookmarks.get(node.id, (targetNodes) => {
      if (browserAPI.runtime.lastError || !targetNodes || !targetNodes[0]) return;
      const targetNode = targetNodes[0];

      let parentId, index;

      if (pos === 'inside') {
        // Drop INSIDE folder
        parentId = targetNode.id;
        index = 0;
        // Auto-expand so user sees where item landed
        expandedFolders.add(parentId);
        saveExpanded();
      } else {
        // Drop above/below a sibling item
        parentId = targetNode.parentId;
        index = targetNode.index;
        if (pos === 'below') index += 1;
      }

      if (isChildOf(activeDraggedId, parentId)) {
        showToast("Cannot move a folder inside its own children", "error");
        return;
      }

      browserAPI.bookmarks.move(activeDraggedId, { parentId, index }, () => {
        if (browserAPI.runtime.lastError) {
          showToast(`Move failed: ${browserAPI.runtime.lastError.message}`, "error");
        } else {
          showToast("Moved", "success");
          refreshBookmarks();
        }
      });
    });
  });

  // For folder items: also accept drops on the children container area
  // (the empty space below children when folder is expanded)
  if (!node.url) {
    item.addEventListener('dragover', (e) => {
      if (e.target.closest && e.target.closest('.tree-row')) return; // handled by row above
      e.preventDefault();
      const activeDraggedId = draggedId;
      if (!activeDraggedId || node.id === activeDraggedId) return;
      clearDragOverClasses();
      row.classList.add('drag-over-inside');
    });

    item.addEventListener('drop', (e) => {
      if (e.target.closest && e.target.closest('.tree-row')) return; // handled by row above
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(autoExpandTimer);
      const activeDraggedId = draggedId;
      clearDragOverClasses();
      if (!activeDraggedId || node.id === activeDraggedId) return;

      if (isChildOf(activeDraggedId, node.id)) {
        showToast("Cannot move a folder inside its own children", "error");
        return;
      }
      expandedFolders.add(node.id);
      saveExpanded();
      browserAPI.bookmarks.move(activeDraggedId, { parentId: node.id, index: 0 }, () => {
        if (browserAPI.runtime.lastError) {
          showToast(`Move failed: ${browserAPI.runtime.lastError.message}`, "error");
        } else {
          showToast("Moved", "success");
          refreshBookmarks();
        }
      });
    });
  }
}

function clearDragOverClasses() {
  document.querySelectorAll('.tree-row').forEach(el => {
    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });
}

// Recursive helper: Check if childId is nested under parentId
function isChildOf(folderId, checkParentId) {
  if (folderId === checkParentId) return true;
  
  // Find checkParentNode in tree
  const parentNode = findBookmarkNode(bookmarkTree, checkParentId);
  if (!parentNode) return false;
  
  let currentParentId = parentNode.parentId;
  while (currentParentId && currentParentId !== '0') {
    if (currentParentId === folderId) {
      return true;
    }
    const currentParent = findBookmarkNode(bookmarkTree, currentParentId);
    currentParentId = currentParent ? currentParent.parentId : null;
  }
  
  return false;
}

// Show Toast Status Message
function showToast(message, type = 'info') {
  // Create or retrieve container
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '16px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '2000';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.padding = '8px 14px';
  toast.style.borderRadius = 'var(--radius-md)';
  toast.style.fontSize = '12px';
  toast.style.fontWeight = '500';
  toast.style.color = '#ffffff';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.transition = 'all 0.25s ease';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(10px)';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.webkitBackdropFilter = 'blur(10px)';

  if (type === 'success') {
    toast.style.backgroundColor = 'rgba(16, 185, 129, 0.9)'; // emerald
  } else if (type === 'error') {
    toast.style.backgroundColor = 'rgba(239, 68, 68, 0.9)'; // red
  } else {
    toast.style.backgroundColor = 'rgba(99, 102, 241, 0.9)'; // indigo
  }

  toast.textContent = message;
  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 10);

  // Remove toast
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      toast.remove();
    }, 250);
  }, 2200);
}

// Utilities
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function hashCode(str) {
  let hash = 0;
  if (!str || str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

// Global Dialog Closer Helper
function closeDialog() {
  const dialogOverlay = document.getElementById('dialog-overlay');
  if (dialogOverlay) dialogOverlay.style.display = 'none';
  const formGroupUrl = document.getElementById('form-group-url');
  const formGroupFolder = document.getElementById('form-group-folder');
  const dialogInput = document.getElementById('dialog-input');
  if (formGroupUrl) formGroupUrl.style.display = 'none';
  if (formGroupFolder) formGroupFolder.style.display = 'none';
  // Restore title form group in case it was hidden for move dialog
  if (dialogInput) {
    dialogInput.style.display = '';
    const formGroupTitle = dialogInput.closest('.form-group');
    if (formGroupTitle) formGroupTitle.style.display = '';
  }
  activeDialogCallback = null;
}
