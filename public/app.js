// Discord Server Cloner - Professional Application Controller

// State Management
let currentUser = null;
let allGuilds = [];
let selectedSourceGuild = null;
let selectedTargetGuild = null;
let currentTargetMode = 'new'; // 'new' | 'existing' | 'template'
let logEntries = [];
let eventSource = null;

// DOM Element References
const authView = document.getElementById('authView');
const dashboardView = document.getElementById('dashboardView');
const progressView = document.getElementById('progressView');

const userHeader = document.getElementById('userHeader');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userGuildCount = document.getElementById('userGuildCount');
const logoutBtn = document.getElementById('logoutBtn');

// Login Elements
const loginForm = document.getElementById('loginForm');
const tokenInput = document.getElementById('tokenInput');
const rememberToken = document.getElementById('rememberToken');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const loginErrorText = document.getElementById('loginErrorText');
const toggleTokenVisibility = document.getElementById('toggleTokenVisibility');
const toggleHelp = document.getElementById('toggleHelp');
const helpContent = document.getElementById('helpContent');

// Source Server Selection Elements
const tabSourceList = document.getElementById('tabSourceList');
const tabSourceManual = document.getElementById('tabSourceManual');
const sourceBrowseContainer = document.getElementById('sourceBrowseContainer');
const sourceManualContainer = document.getElementById('sourceManualContainer');
const refreshGuildsBtn = document.getElementById('refreshGuildsBtn');
const sourceSearch = document.getElementById('sourceSearch');
const sourceServerGrid = document.getElementById('sourceServerGrid');

const manualSourceIdInput = document.getElementById('manualSourceIdInput');
const fetchManualSourceBtn = document.getElementById('fetchManualSourceBtn');
const manualSourceResult = document.getElementById('manualSourceResult');

const selectedSourceCard = document.getElementById('selectedSourceCard');
const selectedSourceIcon = document.getElementById('selectedSourceIcon');
const selectedSourceName = document.getElementById('selectedSourceName');
const selectedSourceDetails = document.getElementById('selectedSourceDetails');

// Destination Target Elements
const targetModeCards = document.querySelectorAll('.target-mode-card');
const targetNewServerConfig = document.getElementById('targetNewServerConfig');
const targetExistingConfig = document.getElementById('targetExistingConfig');
const targetTemplateConfig = document.getElementById('targetTemplateConfig');
const newServerNameInput = document.getElementById('newServerNameInput');
const clearTargetServer = document.getElementById('clearTargetServer');
const targetSearch = document.getElementById('targetSearch');
const targetServerGrid = document.getElementById('targetServerGrid');

// Options Elements
const optRoles = document.getElementById('optRoles');
const optChannels = document.getElementById('optChannels');
const optPermissions = document.getElementById('optPermissions');
const optEmojis = document.getElementById('optEmojis');
const optSaveJson = document.getElementById('optSaveJson');
const optMessages = document.getElementById('optMessages');

const summaryText = document.getElementById('summaryText');
const openConfirmModalBtn = document.getElementById('openConfirmModalBtn');

// Confirmation Modal Elements
const confirmModal = document.getElementById('confirmModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const confirmCloneBtn = document.getElementById('confirmCloneBtn');
const modalSourceName = document.getElementById('modalSourceName');
const modalTargetName = document.getElementById('modalTargetName');
const modalComponents = document.getElementById('modalComponents');
const modalWipeWarning = document.getElementById('modalWipeWarning');

// Progress & Terminal Elements
const progressPhaseTag = document.getElementById('progressPhaseTag');
const progressPhaseTitle = document.getElementById('progressPhaseTitle');
const progressDetail = document.getElementById('progressDetail');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const terminalConsole = document.getElementById('terminalConsole');
const logCounter = document.getElementById('logCounter');
const copyLogsBtn = document.getElementById('copyLogsBtn');
const clearConsoleBtn = document.getElementById('clearConsoleBtn');
const abortBtn = document.getElementById('abortBtn');

// Completion Elements
const completionCard = document.getElementById('completionCard');
const completionSummaryText = document.getElementById('completionSummaryText');
const templateLinkContainer = document.getElementById('templateLinkContainer');
const templateLinkUrl = document.getElementById('templateLinkUrl');
const copyTemplateLinkBtn = document.getElementById('copyTemplateLinkBtn');
const resetDashboardBtn = document.getElementById('resetDashboardBtn');

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  setupEventListeners();
  initSSE();
  checkInitialStatus();
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Server-Sent Events listener
function initSSE() {
  if (eventSource) {
    try { eventSource.close(); } catch {}
  }

  eventSource = new EventSource('/api/events');

  eventSource.addEventListener('log', (e) => {
    try {
      const data = JSON.parse(e.data);
      appendTerminalLog(data.time, data.message, data.level);
    } catch {}
  });

  eventSource.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateProgress(data.percent, data.phase, data.detail);
    } catch {}
  });

  eventSource.addEventListener('complete', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleCloningComplete(data);
    } catch {}
  });

  eventSource.onerror = () => {
    // Reconnect handled automatically by browser
  };
}

// Check initial status from server
async function checkInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.loggedIn && data.user) {
      handleLoginSuccess(data.user);
    }
  } catch (err) {
    console.error('Status check error:', err);
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // Toggle Token Visibility
  toggleTokenVisibility.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    toggleTokenVisibility.innerHTML = isPassword
      ? '<i data-lucide="eye-off" class="w-4 h-4"></i>'
      : '<i data-lucide="eye" class="w-4 h-4"></i>';
    initIcons();
  });

  // Toggle Help Accordion
  toggleHelp.addEventListener('click', () => {
    helpContent.classList.toggle('hidden');
  });

  // Login Form Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    setLoading(loginBtn, true, 'Connecting to Discord...');

    const token = tokenInput.value.trim();
    const remember = rememberToken.checked;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, remember }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Authentication failed with status ${res.status}. Discord rejected this token.`);
      }

      handleLoginSuccess(data.user);
    } catch (err) {
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        loginErrorText.innerHTML = '<strong>Server Offline:</strong> The backend server is not running or connection was lost. Please keep <code>start.bat</code> open in your command prompt, or run <code>npm start</code> in terminal.';
      } else {
        loginErrorText.textContent = err.message;
      }
      loginError.classList.remove('hidden');
    } finally {
      setLoading(loginBtn, false, 'Connect & Load Servers');
    }
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {}
    currentUser = null;
    allGuilds = [];
    selectedSourceGuild = null;
    selectedTargetGuild = null;
    userHeader.classList.add('hidden');
    dashboardView.classList.add('hidden');
    progressView.classList.add('hidden');
    authView.classList.remove('hidden');
  });

  // Source Server Sub-Tabs (Browse vs Manual)
  tabSourceList.addEventListener('click', () => {
    tabSourceList.classList.add('active');
    tabSourceManual.classList.remove('active');
    sourceBrowseContainer.classList.remove('hidden');
    sourceManualContainer.classList.add('hidden');
  });

  tabSourceManual.addEventListener('click', () => {
    tabSourceManual.classList.add('active');
    tabSourceList.classList.remove('active');
    sourceBrowseContainer.classList.add('hidden');
    sourceManualContainer.classList.remove('hidden');
  });

  // Refresh Guilds Button
  refreshGuildsBtn.addEventListener('click', () => {
    loadGuilds();
  });

  // Search Filters
  sourceSearch.addEventListener('input', () => {
    renderSourceServers(sourceSearch.value);
  });

  targetSearch.addEventListener('input', () => {
    renderTargetServers(targetSearch.value);
  });

  // Manual Server Lookup
  fetchManualSourceBtn.addEventListener('click', async () => {
    const id = manualSourceIdInput.value.trim();
    if (!id) return;

    fetchManualSourceBtn.disabled = true;
    fetchManualSourceBtn.innerHTML = '<span>Looking up...</span>';
    manualSourceResult.classList.add('hidden');

    try {
      const res = await fetch(`/api/guilds/lookup/${encodeURIComponent(id)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Server not found');

      const guild = data.guild;
      selectSourceServer(guild);

      manualSourceResult.innerHTML = `
        <div class="flex items-center space-x-3 text-xs text-discord-green font-medium">
          <i data-lucide="check-circle" class="w-4 h-4"></i>
          <span>Found & Selected: <strong>${escapeHtml(guild.name)}</strong> (${guild.memberCount} members)</span>
        </div>
      `;
      manualSourceResult.classList.remove('hidden');
      initIcons();
    } catch (err) {
      manualSourceResult.innerHTML = `
        <div class="text-xs text-discord-red flex items-center space-x-2">
          <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
          <span>${escapeHtml(err.message)}</span>
        </div>
      `;
      manualSourceResult.classList.remove('hidden');
      initIcons();
    } finally {
      fetchManualSourceBtn.disabled = false;
      fetchManualSourceBtn.innerHTML = '<i data-lucide="search" class="w-3.5 h-3.5"></i><span>Lookup Server</span>';
      initIcons();
    }
  });

  // Target Mode Cards Selection
  targetModeCards.forEach((card) => {
    card.addEventListener('click', () => {
      targetModeCards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');

      currentTargetMode = card.dataset.mode;
      targetNewServerConfig.classList.toggle('hidden', currentTargetMode !== 'new');
      targetExistingConfig.classList.toggle('hidden', currentTargetMode !== 'existing');
      targetTemplateConfig.classList.toggle('hidden', currentTargetMode !== 'template');

      updateSummary();
    });
  });

  // Open Confirmation Modal
  openConfirmModalBtn.addEventListener('click', () => {
    openConfirmModal();
  });

  // Close Confirmation Modal
  closeModalBtn.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  // Confirm Clone Start
  confirmCloneBtn.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
    startCloning();
  });

  // Abort Clone Button
  abortBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to stop the cloning process?')) {
      try {
        await fetch('/api/clone/abort', { method: 'POST' });
      } catch {}
    }
  });

  // Copy Logs Button
  copyLogsBtn.addEventListener('click', () => {
    const text = logEntries.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      copyLogsBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-discord-green"></i> Copied!';
      initIcons();
      setTimeout(() => {
        copyLogsBtn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy Logs';
        initIcons();
      }, 2000);
    });
  });

  // Clear Console Button
  clearConsoleBtn.addEventListener('click', () => {
    terminalConsole.innerHTML = '';
    logEntries = [];
    logCounter.textContent = '0 logs';
  });

  // Copy Template Link Button
  copyTemplateLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(templateLinkUrl.href).then(() => {
      copyTemplateLinkBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-discord-green"></i><span>Copied!</span>';
      initIcons();
      setTimeout(() => {
        copyTemplateLinkBtn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i><span>Copy Template Link</span>';
        initIcons();
      }, 2000);
    });
  });

  // Reset / Clone Another Server
  resetDashboardBtn.addEventListener('click', () => {
    progressView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    completionCard.classList.add('hidden');
    terminalConsole.innerHTML = '<div class="text-discord-muted italic">[Ready] Connected to live pipeline stream.</div>';
    logEntries = [];
    logCounter.textContent = '0 logs';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
  });
}

// Handle Login Success
async function handleLoginSuccess(user) {
  currentUser = user;
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');

  userAvatar.src = user.avatar;
  userName.textContent = user.globalName || user.username;
  userGuildCount.textContent = `${user.guildCount} servers`;
  userHeader.classList.remove('hidden');

  await loadGuilds();
}

// Load Guilds from API
async function loadGuilds() {
  sourceServerGrid.innerHTML = '<div class="col-span-full text-center py-10 text-xs text-discord-muted">Loading your Discord servers...</div>';

  try {
    const res = await fetch('/api/guilds');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    allGuilds = data.guilds || [];
    renderSourceServers();
    renderTargetServers();
  } catch (err) {
    sourceServerGrid.innerHTML = `<div class="col-span-full p-4 text-xs text-discord-red bg-discord-red/10 rounded-xl">Error loading servers: ${escapeHtml(err.message)}</div>`;
  }
}

// Render Source Servers Grid
function renderSourceServers(query = '') {
  const q = query.toLowerCase().trim();
  const filtered = allGuilds.filter((g) => g.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    sourceServerGrid.innerHTML = '<div class="col-span-full text-center py-10 text-xs text-discord-muted">No servers match your search.</div>';
    return;
  }

  sourceServerGrid.innerHTML = filtered.map((guild) => {
    const isSelected = selectedSourceGuild && selectedSourceGuild.id === guild.id;
    const iconHtml = guild.icon
      ? `<img src="${guild.icon}" class="w-9 h-9 rounded-xl flex-shrink-0 object-cover bg-discord-dark">`
      : `<div class="w-9 h-9 rounded-xl flex-shrink-0 bg-discord-dark flex items-center justify-center font-bold text-xs text-discord-muted border border-discord-border">${escapeHtml(guild.name.charAt(0))}</div>`;

    return `
      <div data-id="${guild.id}" class="source-server-item interactive-card ${isSelected ? 'selected' : ''} p-3 rounded-xl cursor-pointer flex items-center justify-between">
        <div class="flex items-center space-x-3 min-w-0 pr-2">
          ${iconHtml}
          <div class="truncate">
            <h4 class="text-xs font-bold text-white truncate" title="${escapeHtml(guild.name)}">${escapeHtml(guild.name)}</h4>
            <span class="text-[10px] text-discord-muted">👥 ${guild.memberCount.toLocaleString()} members</span>
          </div>
        </div>
        ${isSelected ? '<span class="w-5 h-5 rounded-full bg-discord-brand text-white flex items-center justify-center flex-shrink-0 text-[10px]"><i data-lucide="check" class="w-3 h-3"></i></span>' : ''}
      </div>
    `;
  }).join('');

  initIcons();

  sourceServerGrid.querySelectorAll('.source-server-item').forEach((item) => {
    item.addEventListener('click', () => {
      const guild = allGuilds.find((g) => g.id === item.dataset.id);
      if (guild) selectSourceServer(guild);
    });
  });
}

// Select a Source Server
function selectSourceServer(guild) {
  selectedSourceGuild = guild;

  // Update selected card banner
  selectedSourceIcon.src = guild.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%235865F2"><circle cx="12" cy="12" r="10"/></svg>';
  selectedSourceName.textContent = guild.name;
  selectedSourceDetails.textContent = `ID: ${guild.id} • ${guild.memberCount.toLocaleString()} members`;
  selectedSourceCard.classList.remove('hidden');

  // Suggest default name for new server
  if (!newServerNameInput.value) {
    newServerNameInput.placeholder = `${guild.name} (Clone)`;
  }

  renderSourceServers(sourceSearch.value);
  renderTargetServers(targetSearch.value);
  updateSummary();
}

// Render Destination Servers (Filtered to Admin permissions)
function renderTargetServers(query = '') {
  const q = query.toLowerCase().trim();
  const adminGuilds = allGuilds.filter((g) => g.hasAdmin && (!selectedSourceGuild || g.id !== selectedSourceGuild.id));
  const filtered = adminGuilds.filter((g) => g.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    targetServerGrid.innerHTML = `
      <div class="col-span-full text-center py-6 text-xs text-discord-muted bg-discord-card rounded-xl p-4 border border-discord-border">
        No eligible servers found. You must have Administrator or Manage Server permissions on the destination server.
      </div>
    `;
    return;
  }

  targetServerGrid.innerHTML = filtered.map((guild) => {
    const isSelected = selectedTargetGuild && selectedTargetGuild.id === guild.id;
    const iconHtml = guild.icon
      ? `<img src="${guild.icon}" class="w-8 h-8 rounded-lg flex-shrink-0 object-cover bg-discord-dark">`
      : `<div class="w-8 h-8 rounded-lg flex-shrink-0 bg-discord-dark flex items-center justify-center font-bold text-xs text-discord-muted border border-discord-border">${escapeHtml(guild.name.charAt(0))}</div>`;

    return `
      <div data-id="${guild.id}" class="target-server-item interactive-card ${isSelected ? 'selected' : ''} p-2.5 rounded-xl cursor-pointer flex items-center justify-between">
        <div class="flex items-center space-x-2.5 min-w-0 pr-2">
          ${iconHtml}
          <div class="truncate">
            <h4 class="text-xs font-semibold text-white truncate" title="${escapeHtml(guild.name)}">${escapeHtml(guild.name)}</h4>
            <span class="text-[10px] text-discord-green font-medium">Administrator</span>
          </div>
        </div>
        ${isSelected ? '<span class="w-4 h-4 rounded-full bg-discord-brand text-white flex items-center justify-center flex-shrink-0 text-[9px]"><i data-lucide="check" class="w-2.5 h-2.5"></i></span>' : ''}
      </div>
    `;
  }).join('');

  initIcons();

  targetServerGrid.querySelectorAll('.target-server-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectedTargetGuild = allGuilds.find((g) => g.id === item.dataset.id) || null;
      renderTargetServers(targetSearch.value);
      updateSummary();
    });
  });
}

// Update Action Summary & Button State
function updateSummary() {
  if (!selectedSourceGuild) {
    summaryText.textContent = 'Please choose a source server above';
    openConfirmModalBtn.disabled = true;
    return;
  }

  let targetDesc = '';
  if (currentTargetMode === 'new') {
    const name = newServerNameInput.value.trim() || `${selectedSourceGuild.name} (Clone)`;
    targetDesc = `New Server: "${name}"`;
    openConfirmModalBtn.disabled = false;
  } else if (currentTargetMode === 'existing') {
    if (!selectedTargetGuild) {
      summaryText.textContent = 'Choose an existing target server in Step 2';
      openConfirmModalBtn.disabled = true;
      return;
    }
    targetDesc = `Existing Server: "${selectedTargetGuild.name}"`;
    openConfirmModalBtn.disabled = false;
  } else if (currentTargetMode === 'template') {
    targetDesc = 'New Server + Discord Template Link';
    openConfirmModalBtn.disabled = false;
  }

  summaryText.innerHTML = `<span class="text-discord-brand font-bold">${escapeHtml(selectedSourceGuild.name)}</span> ➔ <span class="text-white font-bold">${escapeHtml(targetDesc)}</span>`;
}

// Open Confirmation Modal
function openConfirmModal() {
  if (!selectedSourceGuild) return;

  modalSourceName.textContent = `${selectedSourceGuild.name} (${selectedSourceGuild.id})`;

  if (currentTargetMode === 'new') {
    const name = newServerNameInput.value.trim() || `${selectedSourceGuild.name} (Clone)`;
    modalTargetName.textContent = `New Server: "${name}"`;
    modalWipeWarning.classList.add('hidden');
  } else if (currentTargetMode === 'existing') {
    modalTargetName.textContent = `${selectedTargetGuild.name} (${selectedTargetGuild.id})`;
    modalWipeWarning.classList.toggle('hidden', !clearTargetServer.checked);
  } else if (currentTargetMode === 'template') {
    modalTargetName.textContent = `New Server & Discord Template`;
    modalWipeWarning.classList.add('hidden');
  }

  const comps = [];
  if (optRoles.checked) comps.push('Roles');
  if (optChannels.checked) comps.push('Channels');
  if (optPermissions.checked) comps.push('Permissions');
  if (optEmojis.checked) comps.push('Emojis');
  if (optSaveJson.checked) comps.push('Save JSON');
  if (Number(optMessages.value) > 0) comps.push(`${optMessages.value} msgs/channel`);
  modalComponents.textContent = comps.join(', ') || 'Settings only';

  confirmModal.classList.remove('hidden');
  initIcons();
}

// Execute Cloning Pipeline
async function startCloning() {
  if (!selectedSourceGuild) return;

  const payload = {
    sourceGuildId: selectedSourceGuild.id,
    targetMode: currentTargetMode,
    targetGuildId: selectedTargetGuild ? selectedTargetGuild.id : undefined,
    newServerName: newServerNameInput.value.trim() || undefined,
    clearTargetServer: clearTargetServer.checked,
    cloneRoles: optRoles.checked,
    cloneChannels: optChannels.checked,
    clonePermissions: optPermissions.checked,
    cloneEmojis: optEmojis.checked,
    maxMessages: Number(optMessages.value) || 0,
    saveJson: optSaveJson.checked,
  };

  try {
    openConfirmModalBtn.disabled = true;
    const res = await fetch('/api/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    // Switch to progress view
    dashboardView.classList.add('hidden');
    progressView.classList.remove('hidden');
    completionCard.classList.add('hidden');

    progressPhaseTag.textContent = 'Cloning in progress...';
    progressPhaseTitle.textContent = 'Analyzing source server...';
    progressDetail.textContent = 'Fetching configuration and channels';
    progressBar.style.width = '5%';
    progressPercent.textContent = '5%';
  } catch (err) {
    alert(`Clone failed to start: ${err.message}`);
    openConfirmModalBtn.disabled = false;
  }
}

// Update Progress Display
function updateProgress(percent, phase, detail) {
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressPhaseTitle.textContent = phase;
  if (detail) {
    progressDetail.textContent = detail;
  }
}

// Append Log to Terminal
function appendTerminalLog(time, message, level = 'info') {
  const line = `[${time}] [${level.toUpperCase()}] ${message}`;
  logEntries.push(line);
  logCounter.textContent = `${logEntries.length} logs`;

  const row = document.createElement('div');
  row.className = `log-row log-${level}`;
  row.textContent = `[${time}] ${message}`;

  terminalConsole.appendChild(row);
  terminalConsole.scrollTop = terminalConsole.scrollHeight;
}

// Handle Completion
function handleCloningComplete(data) {
  if (data.cancelled) {
    progressPhaseTag.textContent = 'Cancelled';
    progressPhaseTitle.textContent = 'Cloning Cancelled';
    progressDetail.textContent = 'The operation was safely terminated by user request.';
    progressBar.style.width = '100%';
    progressPercent.textContent = 'Stopped';
    return;
  }

  progressPhaseTag.textContent = 'Complete';
  progressPhaseTitle.textContent = data.success ? 'Server Successfully Cloned!' : 'Cloning Failed';
  progressDetail.textContent = data.success ? `Execution time: ${data.duration}` : (data.error || 'An error occurred');
  progressBar.style.width = '100%';
  progressPercent.textContent = '100%';

  if (data.success) {
    completionCard.classList.remove('hidden');
    completionSummaryText.textContent = `Successfully cloned ${data.rolesCount} roles, ${data.channelsCount} channels and categories, and ${data.emojisCount} emojis in ${data.duration} with ${data.errorsCount} non-fatal warnings.`;

    if (data.templateUrl) {
      templateLinkUrl.href = data.templateUrl;
      templateLinkUrl.textContent = data.templateUrl;
      templateLinkContainer.classList.remove('hidden');
    } else {
      templateLinkContainer.classList.add('hidden');
    }
  }

  initIcons();
}

// Helper: Button Loading
function setLoading(btn, isLoading, text) {
  btn.disabled = isLoading;
  if (isLoading) {
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>${text}</span>
    `;
  } else {
    btn.innerHTML = `<span>${text}</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
    initIcons();
  }
}

// Helper: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
