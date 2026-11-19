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

// Multi-Account / Fridge Profile State
const DEFAULT_PROFILE = { id: 'default', name: 'Main Fridge', path: 'items.json' };
let profiles = JSON.parse(localStorage.getItem('sa_profiles') || 'null');
if (!Array.isArray(profiles) || profiles.length === 0) {
  profiles = [DEFAULT_PROFILE];
}
let activeProfileId = localStorage.getItem('sa_active_profile') || 'default';
if (!profiles.some(p => p.id === activeProfileId)) {
  activeProfileId = profiles[0].id;
}

function getActiveProfile() {
  return profiles.find(p => p.id === activeProfileId) || profiles[0];
}

function saveProfilesState() {
  localStorage.setItem('sa_profiles', JSON.stringify(profiles));
  localStorage.setItem('sa_active_profile', activeProfileId);
}

// State
let items = [];
let sha = null;
let currentFilter = 'all';
let searchQuery = '';
let selectedPantryQuery = '';
let lastRecipes = [];

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
const api = () => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${getActiveProfile().path}`;
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
  const prof = getActiveProfile();
  if (isOnline) {
    dot.className = 'status-dot online';
    label.textContent = `${cfg.owner}/${cfg.repo} • ${prof.name}`;
  } else {
    dot.className = 'status-dot error';
    label.textContent = text || 'Disconnected from GitHub';
  }
}

// Populate Account Selector & Settings Form
function renderAccountSelect() {
  const sel = $('accountSelect');
  if (!sel) return;
  sel.innerHTML = '';
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeProfileId) opt.selected = true;
    sel.appendChild(opt);
  });

  const delBtn = $('deleteAccountBtn');
  if (delBtn) {
    delBtn.classList.toggle('hidden', activeProfileId === 'default' || profiles.length <= 1);
  }
}

function switchAccount(profileId) {
  if (!profiles.some(p => p.id === profileId)) return;
  activeProfileId = profileId;
  saveProfilesState();
  items = [];
  sha = null;
  selectedPantryQuery = '';
  renderAccountSelect();
  render();
  load();
  showToast(`Switched to ${getActiveProfile().name}`, 'info');
}

function addAccountProfile() {
  const input = $('newAccountName');
  const rawName = (input?.value || '').trim();
  if (!rawName) return showToast('Enter an account/fridge name', 'error');

  const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `user-${Date.now()}`;
  if (profiles.some(p => p.id === slug)) {
    return showToast('An account with that name already exists', 'error');
  }

  profiles.push({
    id: slug,
    name: rawName,
    path: `profiles/${slug}.json`
  });
  input.value = '';
  switchAccount(slug);
}

function deleteCurrentAccountProfile() {
  if (activeProfileId === 'default' || profiles.length <= 1) return;
  const removed = getActiveProfile();
  profiles = profiles.filter(p => p.id !== activeProfileId);
  activeProfileId = profiles[0].id;
  saveProfilesState();
  switchAccount(activeProfileId);
  showToast(`Removed profile "${removed.name}"`, 'info');
}

// Populate Settings Form
function initSettingsUI() {
  $('owner').value = cfg.owner;
  $('repo').value = cfg.repo;
  $('token').value = cfg.token;
  renderAccountSelect();
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

// Write items.json to GitHub (auto-fetches latest SHA if Arduino updated GitHub)
async function save(message) {
  if (!sha) {
    try {
      const rSha = await fetch(`${api()}?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
      if (rSha.ok) {
        const dSha = await rSha.json();
        sha = dSha.sha;
      }
    } catch (_) {}
  }

  const text = JSON.stringify(items, null, 2);
  const encodeContent = () => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

  let body = {
    message: message,
    content: encodeContent()
  };
  if (sha) body.sha = sha;

  let r = await fetch(api(), {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // If Arduino just deleted an item and changed the SHA on GitHub (409), refresh SHA & retry
  if (r.status === 409) {
    const rLatest = await fetch(`${api()}?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
    if (rLatest.ok) {
      const dLatest = await rLatest.json();
      sha = dLatest.sha;
      body.sha = sha;
      r = await fetch(api(), {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
  }

  if (!r.ok) {
    const errData = await r.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${r.status}`);
  }
  const res = await r.json();
  sha = res.content.sha;
  updateArduinoHardwarePreview();
}

// Background auto-sync so items deleted on the Arduino disappear in the Web App automatically
let isSavingOrLoading = false;
async function silentSync() {
  if (isSavingOrLoading || !cfg.owner || !cfg.repo || !cfg.token) return;
  try {
    const r = await fetch(`${api()}?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    if (data.sha && data.sha !== sha) {
      const prevCount = items.length;
      sha = data.sha;
      const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      items = JSON.parse(new TextDecoder().decode(bytes));
      updateConnectionStatus(true);
      render();
      updateArduinoHardwarePreview();
      if (items.length < prevCount) {
        showToast('Item removed from Arduino display!', 'info');
      } else {
        showToast('Inventory synced with Arduino', 'info');
      }
    }
  } catch (_) {
    // Ignore transient background poll errors
  }
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
  const tabCount = $('fridgeTabCount');
  if (tabCount) tabCount.textContent = items.length;
  renderPantryChips();

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

// ==========================================
// SuperCook / Forkify v2 Recipe Finder
// ==========================================
const FORKIFY_API = 'https://forkify-api.jonas.io/api/v2/recipes';

function normalizeImageUrl(url) {
  if (!url) return '';
  return url.replace('http://forkify-api.herokuapp.com', 'https://forkify-api.herokuapp.com');
}

function renderPantryChips() {
  const container = $('pantryChips');
  if (!container) return;
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<span class="sub">No ingredients in this fridge yet. Add items in "My Fridge" or search manually below.</span>';
    return;
  }

  // Show unique item names sorted closest to expiry first
  const seen = new Set();
  const sorted = [...items].sort((a, b) => getDaysRemaining(a.expiry) - getDaysRemaining(b.expiry));
  sorted.forEach(item => {
    const clean = item.name.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);

    const days = getDaysRemaining(item.expiry);
    const dotClass = days <= 1 ? 'urgent' : (days <= 3 ? 'warn' : 'safe');
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `pantry-chip${selectedPantryQuery.toLowerCase() === key ? ' selected' : ''}`;
    chip.innerHTML = `<span class="pantry-dot ${dotClass}"></span>${getEmojiForName(clean)} ${escapeHtml(clean)} <span style="opacity:.7">(${days}d)</span>`;
    chip.onclick = () => {
      selectedPantryQuery = clean;
      $('recipeQuery').value = clean;
      renderPantryChips();
      searchRecipes(clean);
    };
    container.appendChild(chip);
  });
}

async function searchRecipes(queryOverride = null) {
  const query = (queryOverride !== null ? queryOverride : $('recipeQuery').value).trim();
  if (!query) {
    return showToast('Pick a fridge ingredient or type a recipe keyword', 'error');
  }

  $('recipeDetailCard').classList.add('hidden');
  $('recipeQueryLabel').textContent = `Searching "${query}"...`;
  $('recipeEmptyState').classList.add('hidden');
  $('recipeResults').innerHTML = '';

  try {
    const r = await fetch(`${FORKIFY_API}?search=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    lastRecipes = data?.data?.recipes || [];
    $('recipeCount').textContent = lastRecipes.length;
    $('recipeQueryLabel').textContent = `Results for "${query}"`;

    if (lastRecipes.length === 0) {
      $('recipeEmptyState').classList.remove('hidden');
      $('recipeEmptyState').querySelector('.empty-title').textContent = `No recipes found for "${query}"`;
      $('recipeEmptyState').querySelector('.empty-sub').textContent = 'Try a simpler ingredient name (e.g. "steak", "milk", "egg", "tomato").';
      return;
    }

    lastRecipes.slice(0, 12).forEach(rec => {
      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.innerHTML = `
        <img class="recipe-thumb" src="${escapeHtml(normalizeImageUrl(rec.image_url))}" alt="${escapeHtml(rec.title)}" loading="lazy">
        <div class="recipe-card-body">
          <div class="recipe-title">${escapeHtml(rec.title)}</div>
          <div class="recipe-publisher">${escapeHtml(rec.publisher)}</div>
        </div>
      `;
      card.onclick = () => openRecipeDetail(rec.id);
      $('recipeResults').appendChild(card);
    });
  } catch (e) {
    $('recipeQueryLabel').textContent = 'Search failed';
    showToast('Recipe search failed: ' + e.message, 'error');
  }
}

function findMatchingFridgeItems(ingredientDesc) {
  const desc = (ingredientDesc || '').toLowerCase();
  return items.filter(it => {
    const name = it.name.trim().toLowerCase();
    if (!name) return false;
    const words = name.split(/\s+/).filter(w => w.length >= 3);
    return desc.includes(name) || words.some(w => desc.includes(w));
  });
}

async function openRecipeDetail(recipeId) {
  const detailCard = $('recipeDetailCard');
  detailCard.classList.remove('hidden');
  detailCard.innerHTML = '<p class="sub">Loading recipe details...</p>';
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const r = await fetch(`${FORKIFY_API}/${encodeURIComponent(recipeId)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const rec = data?.data?.recipe;
    if (!rec) throw new Error('Recipe not found');

    const matchedFridgeNames = new Set();
    const ingHtml = (rec.ingredients || []).map(ing => {
      const label = [ing.quantity, ing.unit, ing.description].filter(Boolean).join(' ');
      const matches = findMatchingFridgeItems(ing.description);
      const hasIt = matches.length > 0;
      matches.forEach(m => matchedFridgeNames.add(m.name));
      return `
        <li class="recipe-ing-item ${hasIt ? 'have' : ''}">
          <span>${escapeHtml(label)}</span>
          <span class="ing-badge ${hasIt ? 'have' : 'miss'}">${hasIt ? '✓ In Fridge' : 'Need'}</span>
        </li>
      `;
    }).join('');

    const matchedCount = matchedFridgeNames.size;
    detailCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">🍽️ ${escapeHtml(rec.title)}</span>
        <button type="button" id="closeRecipeDetailBtn" class="btn-sm btn-ghost">✕ Close</button>
      </div>
      <div class="recipe-detail-header">
        <img class="recipe-detail-img" src="${escapeHtml(normalizeImageUrl(rec.image_url))}" alt="${escapeHtml(rec.title)}">
        <div>
          <div class="sub">By ${escapeHtml(rec.publisher)}</div>
          <div class="recipe-meta">
            <span>⏱️ ${rec.cooking_time || 30} min</span>
            <span>🍽️ ${rec.servings || 4} servings</span>
            <span>✅ ${matchedCount} fridge match${matchedCount === 1 ? '' : 'es'}</span>
          </div>
        </div>
      </div>
      <ul class="recipe-ing-list">${ingHtml}</ul>
      <div class="recipe-detail-actions">
        ${matchedCount > 0 ? `<button type="button" id="useMatchedBtn" class="btn-primary">🍳 Cooked! Remove ${matchedCount} Used Item${matchedCount === 1 ? '' : 's'}</button>` : '<span class="sub">No matching fridge items to deduct</span>'}
        <a href="${escapeHtml(rec.source_url)}" target="_blank" rel="noopener noreferrer" class="btn-outline" style="text-decoration:none;padding:8px 12px;font-size:0.82rem;">Full Directions ↗</a>
      </div>
    `;

    $('closeRecipeDetailBtn').onclick = () => detailCard.classList.add('hidden');
    const useBtn = $('useMatchedBtn');
    if (useBtn) {
      useBtn.onclick = async () => {
        if (isSavingOrLoading) return;
        isSavingOrLoading = true;
        items = items.filter(it => !matchedFridgeNames.has(it.name));
        render();
        try {
          await save(`Cooked ${rec.title} — removed ${matchedCount} used item(s)`);
          showToast(`Removed ${matchedCount} used ingredient(s) from ${getActiveProfile().name}!`, 'success');
          openRecipeDetail(recipeId);
        } catch (e) {
          showToast('Failed to update GitHub: ' + e.message, 'error');
          await load();
        } finally {
          isSavingOrLoading = false;
        }
      };
    }
  } catch (e) {
    detailCard.innerHTML = `<p class="sub">Could not load recipe: ${escapeHtml(e.message)}</p>`;
  }
}

// Event Listeners
$('saveSettings').onclick = saveSettings;
$('testConnection').onclick = testConnection;
$('addBtn').onclick = addItem;
$('syncBtn').onclick = load;
$('clearExpiredBtn').onclick = clearExpired;
$('accountSelect').onchange = e => switchAccount(e.target.value);
$('addAccountBtn').onclick = addAccountProfile;
$('deleteAccountBtn').onclick = deleteCurrentAccountProfile;
$('recipeSearchBtn').onclick = () => searchRecipes();
$('recipeQuery').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchRecipes();
});
$('cookExpiringBtn').onclick = () => {
  if (items.length === 0) return showToast('Your fridge is empty!', 'error');
  const soonest = [...items].sort((a, b) => getDaysRemaining(a.expiry) - getDaysRemaining(b.expiry))[0];
  selectedPantryQuery = soonest.name.trim();
  $('recipeQuery').value = selectedPantryQuery;
  renderPantryChips();
  searchRecipes(selectedPantryQuery);
};

document.querySelectorAll('.view-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    $('fridgeView').classList.toggle('hidden', view !== 'fridge');
    $('recipesView').classList.toggle('hidden', view !== 'recipes');
    if (view === 'recipes') {
      renderPantryChips();
    }
  };
});

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

// Poll GitHub every 5 seconds & when tab gains focus so Arduino deletions sync live
setInterval(silentSync, 5000);
window.addEventListener('focus', silentSync);
