/*
 * GHCore — shared client-side services for Colton's Project Launcher.
 * No server account is required. Persistent state lives in localForage/IndexedDB.
 */
(function (global) {
  'use strict';

  const APP_VERSION = '1.0.0';
  const PROFILE_KEY = 'profile';
  const SETTINGS_KEY = 'settings';
  const STATS_KEY = 'stats';
  const ACHIEVEMENTS_KEY = 'achievements';
  const RECENT_KEY = 'recent';
  const FAVORITES_KEY = 'favorites';
  const NOTIFICATIONS_KEY = 'notifications';

  const DEFAULT_SETTINGS = {
    theme: 'classic',
    crt: true,
    reducedMotion: false,
    systemSounds: true,
    showTips: true,
    desktopIconLabels: true,
    clock24Hour: false,
    performanceMode: false
  };

  const ACHIEVEMENT_DEFS = {
    first_launch: { title: 'First Boot', description: 'Launch your first app or game.', icon: '▶' },
    explorer: { title: 'File Explorer', description: 'Open the File Explorer for the first time.', icon: '📁' },
    system: { title: 'Control Panel', description: 'Open System Center.', icon: '⚙' },
    arcade: { title: 'Quarter Up', description: 'Open the Arcade Hub.', icon: '🎮' },
    chat: { title: 'Hello, World', description: 'Open the universal chatroom.', icon: '💬' },
    five_apps: { title: 'Multitasker', description: 'Launch five different apps or games.', icon: '▦' },
    ten_apps: { title: 'Power User', description: 'Launch ten different apps or games.', icon: '⚡' },
    favorite: { title: 'This One', description: 'Favorite a project.', icon: '★' },
    file_import: { title: 'USB Drive', description: 'Import a file into the local file cabinet.', icon: '💾' },
    profile_set: { title: 'Identity', description: 'Set a custom launcher profile.', icon: '☺' },
    theme_change: { title: 'Dress It Up', description: 'Change the desktop theme.', icon: '🎨' },
    konami: { title: 'Up Up Down Down', description: 'Enter the secret code.', icon: '⌨' },
    developer: { title: 'Developer Mode', description: 'Open the diagnostic tools.', icon: '⌁' }
  };

  function ensureStore() {
    if (!global.localforage) {
      throw new Error('localForage is unavailable. Reload the launcher and make sure script loading is allowed.');
    }
  }

  const store = {
    core: null,
    files: null,
    async init() {
      ensureStore();
      this.core = global.localforage.createInstance({
        name: 'ColtonsProjectLauncher',
        storeName: 'core'
      });
      this.files = global.localforage.createInstance({
        name: 'ColtonsProjectLauncher',
        storeName: 'files'
      });
      return this;
    },
    async get(key, fallback = null) {
      ensureStore();
      if (!this.core) await this.init();
      const value = await this.core.getItem(key);
      return value == null ? fallback : value;
    },
    async set(key, value) {
      ensureStore();
      if (!this.core) await this.init();
      return this.core.setItem(key, value);
    },
    async remove(key) {
      ensureStore();
      if (!this.core) await this.init();
      return this.core.removeItem(key);
    },
    async keys() {
      ensureStore();
      if (!this.core) await this.init();
      return this.core.keys();
    },
    async clear() {
      ensureStore();
      if (!this.core) await this.init();
      return this.core.clear();
    },
    async getFile(key) {
      ensureStore();
      if (!this.files) await this.init();
      return this.files.getItem(key);
    },
    async setFile(key, value) {
      ensureStore();
      if (!this.files) await this.init();
      return this.files.setItem(key, value);
    },
    async removeFile(key) {
      ensureStore();
      if (!this.files) await this.init();
      return this.files.removeItem(key);
    },
    async fileKeys() {
      ensureStore();
      if (!this.files) await this.init();
      return this.files.keys();
    },
    async clearFiles() {
      ensureStore();
      if (!this.files) await this.init();
      return this.files.clear();
    }
  };

  const events = new EventTarget();
  let channel = null;

  function emit(type, detail = {}) {
    events.dispatchEvent(new CustomEvent(type, { detail }));
    if (channel) {
      try { channel.postMessage({ source: 'GHCore', type, detail }); } catch (_) {}
    }
  }

  if ('BroadcastChannel' in global) {
    try {
      channel = new BroadcastChannel('coltons-project-launcher');
      channel.addEventListener('message', (event) => {
        const msg = event.data || {};
        if (msg.source !== 'GHCore') return;
        events.dispatchEvent(new CustomEvent(msg.type, { detail: { ...(msg.detail || {}), remote: true } }));
      });
    } catch (_) {}
  }

  async function getProfile() {
    let profile = await store.get(PROFILE_KEY);
    if (!profile) {
      profile = {
        id: crypto.randomUUID ? crypto.randomUUID() : ('guest-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
        username: 'Guest',
        title: 'New User',
        status: 'Online',
        createdAt: Date.now()
      };
      await store.set(PROFILE_KEY, profile);
    }
    return profile;
  }

  async function setProfile(patch) {
    const current = await getProfile();
    const next = { ...current, ...(patch || {}), updatedAt: Date.now() };
    await store.set(PROFILE_KEY, next);
    if (next.username && next.username !== 'Guest') await unlock('profile_set');
    emit('profile:changed', { profile: next });
    return next;
  }

  async function getSettings() {
    return { ...DEFAULT_SETTINGS, ...(await store.get(SETTINGS_KEY, {})) };
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...(patch || {}) };
    await store.set(SETTINGS_KEY, next);
    emit('settings:changed', { settings: next });
    return next;
  }

  async function getStats() {
    return {
      launches: 0,
      uniqueLaunches: [],
      totalMinutes: 0,
      visits: 0,
      filesImported: 0,
      notesCreated: 0,
      messagesSent: 0,
      lastLaunchAt: null,
      ...((await store.get(STATS_KEY, {})) || {})
    };
  }

  async function recordLaunch(item = {}) {
    const stats = await getStats();
    const id = String(item.id || item.url || item.title || 'unknown');
    stats.launches += 1;
    stats.uniqueLaunches = Array.from(new Set([id, ...(stats.uniqueLaunches || [])])).slice(0, 500);
    stats.lastLaunchAt = Date.now();
    await store.set(STATS_KEY, stats);

    const recent = await store.get(RECENT_KEY, []);
    const next = [
      { id, title: item.title || id, url: item.url || '', type: item.type || 'app', at: Date.now() },
      ...recent.filter(x => x.id !== id)
    ].slice(0, 40);
    await store.set(RECENT_KEY, next);

    if (stats.launches === 1) await unlock('first_launch');
    if ((stats.uniqueLaunches || []).length >= 5) await unlock('five_apps');
    if ((stats.uniqueLaunches || []).length >= 10) await unlock('ten_apps');
    emit('launch:recorded', { item, stats, recent: next });
    return stats;
  }

  async function getRecent() { return store.get(RECENT_KEY, []); }

  async function getFavorites() { return store.get(FAVORITES_KEY, []); }

  async function isFavorite(id) {
    const favs = await getFavorites();
    return favs.includes(String(id));
  }

  async function toggleFavorite(item) {
    const id = String(item.id || item.url || item.title);
    const favs = await getFavorites();
    const exists = favs.includes(id);
    const next = exists ? favs.filter(x => x !== id) : [id, ...favs];
    await store.set(FAVORITES_KEY, next);
    if (!exists) await unlock('favorite');
    emit('favorite:changed', { id, favorite: !exists, favorites: next, item });
    return !exists;
  }

  async function getAchievements() {
    return store.get(ACHIEVEMENTS_KEY, {});
  }

  async function unlock(id) {
    const defs = ACHIEVEMENT_DEFS;
    if (!defs[id]) return false;
    const current = await getAchievements();
    if (current[id]) return false;
    current[id] = { unlockedAt: Date.now() };
    await store.set(ACHIEVEMENTS_KEY, current);
    await pushNotification({
      title: 'Achievement Unlocked',
      body: `${defs[id].icon} ${defs[id].title}`,
      kind: 'achievement'
    });
    emit('achievement:unlocked', { id, definition: defs[id] });
    return true;
  }

  async function getNotifications() { return store.get(NOTIFICATIONS_KEY, []); }

  async function pushNotification(notification) {
    const list = await getNotifications();
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
      title: notification.title || 'Notification',
      body: notification.body || '',
      kind: notification.kind || 'info',
      read: false,
      at: Date.now()
    };
    await store.set(NOTIFICATIONS_KEY, [item, ...list].slice(0, 100));
    emit('notification:new', { notification: item });
    return item;
  }

  async function markNotificationsRead() {
    const list = await getNotifications();
    await store.set(NOTIFICATIONS_KEY, list.map(n => ({ ...n, read: true })));
    emit('notifications:read');
  }

  async function removeNotification(id) {
    const list = await getNotifications();
    await store.set(NOTIFICATIONS_KEY, list.filter(n => n.id !== id));
  }

  async function fileList() {
    const keys = await store.fileKeys();
    const out = [];
    for (const key of keys) {
      const meta = await store.get(`filemeta:${key}`);
      if (meta) out.push(meta);
    }
    return out.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
  }

  async function saveFile(fileOrBlob, meta = {}) {
    const id = meta.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
    const key = `file:${id}`;
    const blob = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob], { type: meta.mime || 'application/octet-stream' });
    const record = {
      id,
      name: meta.name || 'Untitled File',
      mime: meta.mime || blob.type || 'application/octet-stream',
      size: blob.size,
      createdAt: meta.createdAt || Date.now(),
      modifiedAt: Date.now(),
      kind: meta.kind || 'file'
    };
    await store.setFile(key, blob);
    await store.set(`filemeta:${key}`, record);
    emit('file:changed', { action: 'save', file: record });
    return record;
  }

  async function readFile(metaOrId) {
    const id = typeof metaOrId === 'object' ? metaOrId.id : String(metaOrId);
    return store.getFile(`file:${id}`);
  }

  async function deleteFile(id) {
    const key = `file:${id}`;
    const meta = await store.get(`filemeta:${key}`);
    await store.removeFile(key);
    await store.remove(`filemeta:${key}`);
    emit('file:changed', { action: 'delete', file: meta || { id } });
  }

  async function exportBackup() {
    const profile = await getProfile();
    const settings = await getSettings();
    const stats = await getStats();
    const achievements = await getAchievements();
    const recent = await getRecent();
    const favorites = await getFavorites();
    const notifications = await getNotifications();
    const files = await fileList();
    const payload = {
      format: 'GHCore Backup',
      version: APP_VERSION,
      exportedAt: Date.now(),
      profile, settings, stats, achievements, recent, favorites, notifications,
      files: []
    };
    for (const meta of files) {
      const blob = await readFile(meta);
      if (!blob) continue;
      const buffer = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      payload.files.push({ meta, base64: btoa(binary) });
    }
    return new Blob([JSON.stringify(payload)], { type: 'application/json' });
  }

  async function importBackup(file) {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (payload.format !== 'GHCore Backup') throw new Error('Not a Project Launcher backup.');
    if (payload.profile) await store.set(PROFILE_KEY, payload.profile);
    if (payload.settings) await store.set(SETTINGS_KEY, payload.settings);
    if (payload.stats) await store.set(STATS_KEY, payload.stats);
    if (payload.achievements) await store.set(ACHIEVEMENTS_KEY, payload.achievements);
    if (payload.recent) await store.set(RECENT_KEY, payload.recent);
    if (payload.favorites) await store.set(FAVORITES_KEY, payload.favorites);
    if (payload.notifications) await store.set(NOTIFICATIONS_KEY, payload.notifications);
    for (const entry of payload.files || []) {
      const binary = atob(entry.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await store.setFile(`file:${entry.meta.id}`, new Blob([bytes], { type: entry.meta.mime || 'application/octet-stream' }));
      await store.set(`filemeta:file:${entry.meta.id}`, entry.meta);
    }
    emit('backup:imported', { payload });
    return payload;
  }

  async function estimateStorage() {
    if (navigator.storage && navigator.storage.estimate) {
      try { return await navigator.storage.estimate(); } catch (_) {}
    }
    return { usage: 0, quota: 0 };
  }

  async function resetAll() {
    await store.clear();
    await store.clearFiles();
    emit('reset:complete');
  }

  async function boot() {
    await store.init();
    await getProfile();
    await getSettings();
    await getStats();
    return api;
  }

  const api = {
    version: APP_VERSION,
    store,
    events,
    emit,
    achievementDefs: ACHIEVEMENT_DEFS,
    boot,
    getProfile,
    setProfile,
    getSettings,
    setSettings,
    getStats,
    recordLaunch,
    getRecent,
    getFavorites,
    isFavorite,
    toggleFavorite,
    getAchievements,
    unlock,
    getNotifications,
    pushNotification,
    markNotificationsRead,
    removeNotification,
    fileList,
    saveFile,
    readFile,
    deleteFile,
    exportBackup,
    importBackup,
    estimateStorage,
    resetAll
  };

  global.GHCore = api;
})(window);
