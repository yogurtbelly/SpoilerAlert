// ==========================================
// Spoiler Alert - Web App & Arduino Bridge
// ==========================================

const $ = id => document.getElementById(id);

// Pre-fill user repository details by default
const DEFAULT_CONFIG = {
  owner: 'yogurtbelly',
  repo: 'SpoilerAlert',
  token: ''
};

const savedCfg = JSON.parse(localStorage.getItem('sa_cfg') || '{}');
const cfg = {
  owner: savedCfg.owner || DEFAULT_CONFIG.owner,
  repo: savedCfg.repo || DEFAULT_CONFIG.repo,
  token: savedCfg.token || DEFAULT_CONFIG.token
};

// State
let items = [];
let sha = null;
let currentFilter = 'all';
let searchQuery = '';

// Food emoji dictionary for smart auto-detection
const EMOJI_MAP = {
  milk: '🥛', yogurt: '🥛', cheese: '🧀', butter: '🧈', cream: '🥛',
  meat: '🥩', beef: '🥩', steak: '🥩', chicken: '🍗', pork: '🥓', bacon: '🥓',
  fish: '🐟', salmon: '🐟', tuna: '🐟', shrimp: '🍤', egg: '🥚', eggs: '🥚',
  bread: '🍞', toast: '🍞', bagel: '🥯', croissant: '🥐', sandwich: '🥪',
  apple: '🍎', banana: '🍌', berry: '🍓', strawberry: '🍓', orange: '🍊', lemon: '🍋',
  grape: '🍇', watermelon: '🍉', avocado: '🥑', tomato: '🍅', potato: '🥔',
  carrot: '🥕', corn: '🌽', salad: '🥗', lettuce: '🥬', broccoli: '🥦',
  onion: '🧅', garlic: '🧄', soup: '🍲', pasta: '🍝', pizza: '🍕',
  rice: '🍚', cake: '🍰', cookie: '🍪', beer: '🍺', wine: '🍷', juice: '🧃'
};

function getEmojiForName(name) {
  if (!name) return '🥑';
  const clean = name.toLowerCase().trim();
  for (const [key, emoji] of Object.entries(EMOJI_MAP)) {
    if (clean.includes(key)) return emoji;
  }
  return '🍽️';
}

// GitHub API Endpoints
const api = () => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/items.json`;
const headers = () => ({
  Authorization: 'Bearer ' + cfg.token,
  Accept: 'application/vnd.github+json'
});

// Toast notification helper
function showToast(text, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Update connection status header
function updateConnectionStatus(isOnline, text = '') {
  const dot = $('statusDot');
  const label = $('repoLabel');
  if (isOnline) {
    dot.className = 'status-dot online';
    label.textContent = `${cfg.owner}/${cfg.repo}`;
  } else {
    dot.className = 'status-dot error';
    label.textContent = text || 'Disconnected from GitHub';
  }
}

// Populate Settings Form
function initSettingsUI() {
  $('owner').value = cfg.owner;
  $('repo').value = cfg.repo;
  $('token').value = cfg.token;
}

function saveSettings() {
  cfg.owner = $('owner').value.trim();
  cfg.repo = $('repo').value.trim();
  cfg.token = $('token').value.trim();
  localStorage.setItem('sa_cfg', JSON.stringify(cfg));
  showToast('Settings saved successfully', 'success');
  $('settingsSection').classList.add('hidden');
  load();
}

async function testConnection() {
  if (!cfg.token) {
    return showToast('Please enter a GitHub token', 'error');
  }
  showToast('Testing GitHub connection...', 'info');
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
      headers: headers()
    });
    if (r.ok) {
      showToast(`Connected to ${cfg.owner}/${cfg.repo}!`, 'success');
      updateConnectionStatus(true);
    } else {
      showToast(`Connection failed: HTTP ${r.status}`, 'error');
      updateConnectionStatus(false);
    }
  } catch (e) {
    showToast('Network error: ' + e.message, 'error');
  }
}

// Load items from GitHub
async function load() {
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    $('settingsSection').classList.remove('hidden');
    updateConnectionStatus(false, 'Setup required');
    return;
  }

  updateConnectionStatus(false, 'Syncing...');
  try {
    const r = await fetch(api(), { headers: headers(), cache: 'no-store' });
    if (r.status === 404) {
      items = [];
      sha = null;
      updateConnectionStatus(true);
    } else if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    } else {
      const data = await r.json();
      sha = data.sha;
      const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      items = JSON.parse(new TextDecoder().decode(bytes));
      updateConnectionStatus(true);
    }
    render();
    updateArduinoHardwarePreview();
  } catch (e) {
    updateConnectionStatus(false, 'Sync Error: ' + e.message);
    showToast('Failed to load items: ' + e.message, 'error');
  }
}

// Write items.json to GitHub
async function save(message) {
  const text = JSON.stringify(items, null, 2);
  const body = {
    message: message,
    content: btoa(String.fromCharCode(...new TextEncoder().encode(text)))
  };
  if (sha) body.sha = sha;

  const r = await fetch(api(), {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const errData = await r.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${r.status}`);
  }
  const res = await r.json();
  sha = res.content.sha;
  updateArduinoHardwarePreview();
}

// Days remaining calculation
function getDaysRemaining(expiryStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryStr + 'T00:00:00');
  return Math.round((expiry - today) / 86400000);
}

// Update simulated Arduino hardware LEDs & state
function updateArduinoHardwarePreview() {
  const ledGreen = $('ledGreen');
  const ledYellow = $('ledYellow');
  const ledRed = $('ledRed');
  const statusText = $('arduinoStatusText');
  const detailText = $('arduinoDetail');

  ledGreen.classList.remove('active');
  ledYellow.classList.remove('active');
  ledRed.classList.remove('active');

  if (items.length === 0) {
    ledGreen.classList.add('active');
    statusText.textContent = '🟢 Safe: Inventory is empty';
    detailText.textContent = 'Wi-Fi: HyoBiznet • Polling every 60s';
    return;
  }

  let expiredCount = 0;
  let warnCount = 0;
  let safeCount = 0;

  items.forEach(item => {
    const days = getDaysRemaining(item.expiry);
    if (days <= 1) expiredCount++;
    else if (days <= 3) warnCount++;
    else safeCount++;
  });

  if (expiredCount > 0) {
    ledRed.classList.add('active');
    statusText.textContent = `🔴 RED ALERT: ${expiredCount} item(s) urgent/spoiled!`;
    detailText.textContent = `Buzzer active • ${warnCount} warning • ${safeCount} fresh`;
  } else if (warnCount > 0) {
    ledYellow.classList.add('active');
    statusText.textContent = `🟡 WARNING: ${warnCount} item(s) expiring in 2-3 days`;
    detailText.textContent = `Yellow LED lit • ${safeCount} fresh`;
  } else {
    ledGreen.classList.add('active');
    statusText.textContent = `🟢 ALL CLEAR: All ${safeCount} item(s) fresh`;
    detailText.textContent = 'Green LED lit • Arduino safe status';
  }
}

// Preset shelf life chip handler
function initPresets() {
  const chips = document.querySelectorAll('.chip');
  chips.forEach(chip => {
    chip.onclick = () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const days = parseInt(chip.dataset.days);
      const d = new Date();
      d.setDate(d.getDate() + days);
      $('date').value = d.toLocaleDateString('en-CA');

      // If item name is empty, suggest the emoji
      if (!$('name').value) {
        $('emojiPreview').textContent = chip.dataset.emoji || '🥑';
      }
    };
  });
}

// Add Item
async function addItem() {
  const nameInput = $('name');
  const dateInput = $('date');
  const addBtn = $('addBtn');

  const name = nameInput.value.trim();
  const date = dateInput.value;

  if (!name) {
    showToast('Please enter an item name', 'error');
    nameInput.focus();
    return;
  }
  if (!date) {
    showToast('Please pick an expiration date', 'error');
    dateInput.focus();
    return;
  }

  addBtn.disabled = true;
  addBtn.innerHTML = 'Saving...';

  items.push({ name: name.slice(0, 20), expiry: date });
  items.sort((a, b) => a.expiry.localeCompare(b.expiry));

  try {
    await save(`Add item: ${name}`);
    nameInput.value = '';
    dateInput.value = '';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    $('emojiPreview').textContent = '🥑';
    render();
    showToast(`Added ${name}! Arduino will update.`, 'success');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
    load();
  } finally {
    addBtn.disabled = false;
    addBtn.innerHTML = '<span class="btn-icon">＋</span> Add Item';
  }
}

// Remove single item
async function removeItem(index) {
  const [removed] = items.splice(index, 1);
  render();
  updateArduinoHardwarePreview();

  try {
    await save(`Remove item: ${removed.name}`);
    showToast(`Removed ${removed.name}`, 'info');
  } catch (e) {
    showToast('Failed to delete on GitHub: ' + e.message, 'error');
    load();
  }
}

// Clear all expired items at once
async function clearExpired() {
  const initialLen = items.length;
  items = items.filter(item => getDaysRemaining(item.expiry) > 0);
  const removedCount = initialLen - items.length;

  if (removedCount === 0) return;

  render();
  updateArduinoHardwarePreview();
  try {
    await save(`Cleaned up ${removedCount} expired items`);
    showToast(`Removed ${removedCount} expired items`, 'success');
  } catch (e) {
    showToast('Failed to update GitHub: ' + e.message, 'error');
    load();
  }
}

// Render the inventory list
function render() {
  const list = $('list');
  const emptyState = $('emptyState');
  const totalCountBadge = $('totalCount');
  const clearExpiredBtn = $('clearExpiredBtn');

  list.innerHTML = '';
  totalCountBadge.textContent = items.length;

  const expiredItems = items.filter(i => getDaysRemaining(i.expiry) <= 0);
  if (expiredItems.length > 0) {
    clearExpiredBtn.classList.remove('hidden');
    clearExpiredBtn.textContent = `Clear ${expiredItems.length} Expired`;
  } else {
    clearExpiredBtn.classList.add('hidden');
  }

  // Filter & Search
  let visibleItems = items.map((item, originalIndex) => ({ ...item, originalIndex }));

  if (searchQuery) {
    visibleItems = visibleItems.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }

  if (currentFilter === 'urgent') {
    visibleItems = visibleItems.filter(i => getDaysRemaining(i.expiry) <= 1);
  } else if (currentFilter === 'warn') {
    visibleItems = visibleItems.filter(i => {
      const d = getDaysRemaining(i.expiry);
      return d > 1 && d <= 3;
    });
  } else if (currentFilter === 'safe') {
    visibleItems = visibleItems.filter(i => getDaysRemaining(i.expiry) > 3);
  }

  if (visibleItems.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }

  visibleItems.forEach(item => {
    const days = getDaysRemaining(item.expiry);
    const li = document.createElement('li');

    let stateClass = 'state-safe';
    let pillClass = 'pill-safe';
    let badgeText = `${days}d left`;

    if (days < 0) {
      stateClass = 'state-urgent';
      pillClass = 'pill-urgent';
      badgeText = `Expired (${Math.abs(days)}d ago)`;
    } else if (days === 0) {
      stateClass = 'state-urgent';
      pillClass = 'pill-urgent';
      badgeText = 'Expires Today';
    } else if (days === 1) {
      stateClass = 'state-urgent';
      pillClass = 'pill-urgent';
      badgeText = '1 day left';
    } else if (days <= 3) {
      stateClass = 'state-warn';
      pillClass = 'pill-warn';
      badgeText = `${days} days left`;
    }

    li.className = `item-card ${stateClass}`;

    const emoji = getEmojiForName(item.name);

    li.innerHTML = `
      <div class="item-main">
        <span class="item-emoji">${emoji}</span>
        <div class="item-details">
          <span class="item-name">${escapeHtml(item.name)}</span>
          <span class="item-date">Expires: ${item.expiry}</span>
        </div>
      </div>
      <div class="item-right">
        <span class="expiry-pill ${pillClass}">${badgeText}</span>
        <button class="delete-btn" title="Remove item" aria-label="Delete">✕</button>
      </div>
    `;

    li.querySelector('.delete-btn').onclick = () => removeItem(item.originalIndex);
    list.appendChild(li);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Live emoji detection on name input
$('name').addEventListener('input', e => {
  const val = e.target.value;
  const emoji = getEmojiForName(val);
  const preview = $('emojiPreview');
  preview.textContent = emoji;
  preview.classList.remove('bounce');
  void preview.offsetWidth; // Trigger reflow for animation
  preview.classList.add('bounce');
});

// Event Listeners
$('saveSettings').onclick = saveSettings;
$('testConnection').onclick = testConnection;
$('addBtn').onclick = addItem;
$('syncBtn').onclick = load;
$('clearExpiredBtn').onclick = clearExpired;

$('toggleSettingsBtn').onclick = () => {
  $('settingsSection').classList.toggle('hidden');
};
$('closeSettingsBtn').onclick = () => {
  $('settingsSection').classList.add('hidden');
};

$('toggleTokenVisibility').onclick = () => {
  const tokenInput = $('token');
  const btn = $('toggleTokenVisibility');
  if (tokenInput.type === 'password') {
    tokenInput.type = 'text';
    btn.textContent = 'Hide';
  } else {
    tokenInput.type = 'password';
    btn.textContent = 'Show';
  }
};

// Enter key support
$('name').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('date').focus();
});
$('date').addEventListener('keydown', e => {
  if (e.key === 'Enter') addItem();
});

// Search input
$('searchBar').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  render();
});

// Filter tabs
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    render();
  };
});

// Initialization
initSettingsUI();
initPresets();
load();
