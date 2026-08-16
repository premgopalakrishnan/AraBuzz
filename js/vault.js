/* ==========================================================================
   AraBuzz — vault.js
   Folder-based local storage (like CoScribe).

   Everything lives on the user's own disk:
     <PrimaryFolder>/
        arabuzz-data.json        the whole database
        decks/                   every Spell Buzz PDF ever uploaded (originals)
        backups/                 dated snapshots (last 40 kept)
        reports/                 saved parent Coach Reports

   A SECOND folder can be chosen as an independent backup vault, written after
   every finished quiz and every upload.

   Browser support: Chrome / Edge on Windows, Mac and ChromeOS (File System
   Access API). On Safari / iPad the API does not exist, so the app falls back
   to on-device storage + a manual "Download backup" button. Nothing breaks.
   ========================================================================== */
(function (w) {
  'use strict';

  const IDB_NAME = 'arabuzz-handles';
  const IDB_STORE = 'handles';

  const supported = typeof w.showDirectoryPicker === 'function';

  let primary = null;    // FileSystemDirectoryHandle
  let secondary = null;
  let lastBackupDay = localStorage.getItem('arabuzz.lastBackupDay') || '';
  let writeTimer = null;
  let listeners = [];

  /* ---------------------------------------------------- tiny IndexedDB kv */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(k, v) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction(IDB_STORE, 'readwrite');
      t.objectStore(IDB_STORE).put(v, k);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  }
  async function idbGet(k) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction(IDB_STORE, 'readonly');
      const q = t.objectStore(IDB_STORE).get(k);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  }
  async function idbDel(k) {
    const d = await idb();
    return new Promise((res) => {
      const t = d.transaction(IDB_STORE, 'readwrite');
      t.objectStore(IDB_STORE).delete(k); t.oncomplete = res;
    });
  }

  /* ------------------------------------------------------------ helpers */
  function notify() { listeners.forEach(fn => { try { fn(status()); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  async function perm(handle, mode) {
    if (!handle) return 'denied';
    const opts = { mode: mode || 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return 'granted';
    return handle.queryPermission(opts);
  }

  async function request(handle) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function subdir(root, name) {
    return root.getDirectoryHandle(name, { create: true });
  }

  async function writeFile(dir, name, contents) {
    const fh = await dir.getFileHandle(name, { create: true });
    const ws = await fh.createWritable();
    await ws.write(contents);
    await ws.close();
    return fh;
  }

  async function readFile(dir, name) {
    try {
      const fh = await dir.getFileHandle(name, { create: false });
      const f = await fh.getFile();
      return await f.text();
    } catch (e) { return null; }
  }

  const stamp = () => new Date().toISOString().slice(0, 10);
  const safeName = (s) => String(s || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80);

  /* ------------------------------------------------------------- connect */
  async function pickPrimary() {
    if (!supported) throw new Error('unsupported');
    const dir = await w.showDirectoryPicker({ id: 'arabuzz-primary', mode: 'readwrite', startIn: 'documents' });
    // If an existing AraBuzz data file is inside, offer to restore it.
    const existing = await readFile(dir, 'arabuzz-data.json');
    primary = dir;
    await idbSet('primary', dir);
    await scaffold(dir);
    notify();
    return { dir, existing };
  }

  async function pickSecondary() {
    if (!supported) throw new Error('unsupported');
    const dir = await w.showDirectoryPicker({ id: 'arabuzz-secondary', mode: 'readwrite', startIn: 'documents' });
    secondary = dir;
    await idbSet('secondary', dir);
    await scaffold(dir);
    notify();
    return dir;
  }

  async function scaffold(dir) {
    try {
      await subdir(dir, 'decks');
      await subdir(dir, 'backups');
      await subdir(dir, 'reports');
      await writeFile(dir, 'READ-ME.txt',
`AraBuzz — spelling practice data folder
=======================================

This folder holds everything AraBuzz knows. It never leaves your computer.

  arabuzz-data.json   The live database: words, scores, history, settings.
  decks/              Every Spell Buzz document you uploaded, kept as-is.
  backups/            A dated snapshot each day you use the app (last 40).
  reports/            Coach Reports you saved.

To move to a new computer: copy this whole folder across, open AraBuzz,
choose "Open existing AraBuzz folder" and point it here.

Keep a second copy somewhere safe. In AraBuzz go to
Parent Zone > Storage and set a Backup Folder.
`);
    } catch (e) { console.warn('scaffold', e); }
  }

  /** Reconnect handles saved from a previous visit. Returns a status object. */
  async function restore() {
    if (!supported) return status();
    try {
      primary = await idbGet('primary');
      secondary = await idbGet('secondary');
    } catch (e) { /* ignore */ }
    notify();
    return status();
  }

  /** Must be called from a user gesture (button click). */
  async function reconnect() {
    let ok = false;
    if (primary) ok = await request(primary);
    if (secondary) await request(secondary);
    notify();
    return ok;
  }

  async function forget(which) {
    if (which === 'secondary') { secondary = null; await idbDel('secondary'); }
    else { primary = null; await idbDel('primary'); }
    notify();
  }

  /* --------------------------------------------------------------- write */
  /** Debounced write of the whole DB to the primary folder. */
  function sync(dbObj, opts) {
    if (!supported) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => flush(dbObj, opts), (opts && opts.now) ? 0 : 1200);
  }

  async function flush(dbObj, opts) {
    const json = JSON.stringify(dbObj, null, 2);
    const both = opts && opts.both;

    if (primary && await perm(primary) === 'granted') {
      try {
        await writeFile(primary, 'arabuzz-data.json', json);
        await dailySnapshot(primary, json);
      } catch (e) { console.warn('primary write failed', e); }
    }
    if (both && secondary && await perm(secondary) === 'granted') {
      try {
        await writeFile(secondary, 'arabuzz-data.json', json);
        await dailySnapshot(secondary, json, true);
      } catch (e) { console.warn('secondary write failed', e); }
    }
  }

  /** Force-write to BOTH folders right now (after a quiz, an upload, a report). */
  async function checkpoint(dbObj) {
    clearTimeout(writeTimer);
    return flush(dbObj, { both: true });
  }

  async function dailySnapshot(dir, json, force) {
    const day = stamp();
    if (!force && lastBackupDay === day) return;
    try {
      const bk = await subdir(dir, 'backups');
      await writeFile(bk, `arabuzz-${day}.json`, json);
      lastBackupDay = day;
      localStorage.setItem('arabuzz.lastBackupDay', day);
      await prune(bk, 40);
    } catch (e) { console.warn('snapshot', e); }
  }

  async function prune(dir, keep) {
    try {
      const names = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file' && /^arabuzz-\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
      }
      names.sort();
      while (names.length > keep) { await dir.removeEntry(names.shift()); }
    } catch (e) { /* removeEntry may be unsupported */ }
  }

  /** Keep the original uploaded deck file alongside the data. */
  async function saveDeck(file, label) {
    if (!supported) return null;
    const nm = `${stamp()}_${safeName(label || file.name)}`;
    const buf = await file.arrayBuffer();
    for (const dir of [primary, secondary]) {
      if (dir && await perm(dir) === 'granted') {
        try { const d = await subdir(dir, 'decks'); await writeFile(d, nm, buf); }
        catch (e) { console.warn('deck save', e); }
      }
    }
    return nm;
  }

  async function saveReport(html, name) {
    if (!supported) return null;
    const nm = safeName(name || `coach-report-${stamp()}`) + '.html';
    for (const dir of [primary, secondary]) {
      if (dir && await perm(dir) === 'granted') {
        try { const d = await subdir(dir, 'reports'); await writeFile(d, nm, html); }
        catch (e) { console.warn('report save', e); }
      }
    }
    return nm;
  }

  /** Read arabuzz-data.json out of a chosen folder (for restore-on-new-machine). */
  async function readData(which) {
    const dir = which === 'secondary' ? secondary : primary;
    if (!dir) return null;
    return readFile(dir, 'arabuzz-data.json');
  }

  async function listBackups(which) {
    const dir = which === 'secondary' ? secondary : primary;
    if (!dir) return [];
    const out = [];
    try {
      const bk = await dir.getDirectoryHandle('backups', { create: false });
      for await (const [name, h] of bk.entries()) if (h.kind === 'file') out.push(name);
    } catch (e) {}
    return out.sort().reverse();
  }

  async function readBackup(name, which) {
    const dir = which === 'secondary' ? secondary : primary;
    if (!dir) return null;
    try {
      const bk = await dir.getDirectoryHandle('backups', { create: false });
      return readFile(bk, name);
    } catch (e) { return null; }
  }

  /** Forget the remembered folders. The files on disk are untouched. */
  async function wipeHandles() {
    primary = null; secondary = null;
    try { await idbDel('primary'); await idbDel('secondary'); } catch (e) {}
    try { localStorage.removeItem('arabuzz.lastBackupDay'); } catch (e) {}
    lastBackupDay = '';
    notify();
  }

  function status() {
    return {
      supported,
      primary: primary ? (primary.name || 'Primary folder') : null,
      secondary: secondary ? (secondary.name || 'Backup folder') : null,
      hasPrimary: !!primary,
      hasSecondary: !!secondary
    };
  }

  /** Always-available fallback: download a backup file. */
  function download(dbObj, name) {
    const blob = new Blob([JSON.stringify(dbObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || `arabuzz-backup-${stamp()}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  w.Vault = {
    supported, status, onChange,
    pickPrimary, pickSecondary, restore, reconnect, forget, wipeHandles,
    sync, checkpoint, flush, saveDeck, saveReport,
    readData, listBackups, readBackup, download, perm, request
  };
})(window);
