// ============================================================
// Mises à jour automatiques (electron-updater)
// ============================================================
// Le dépôt de Releases ("centralpdf") est PRIVÉ : l'API GitHub exige une
// authentification pour lister/télécharger ses Releases. Ce jeton est donc
// embarqué dans l'app distribuée — c'est la seule solution pour un dépôt
// privé consulté par des utilisateurs externes, en sachant qu'un jeton
// livré dans une appli peut toujours être extrait (le .asar n'est pas un
// vrai coffre-fort).
// SÉCURITÉ : utilise IMPÉRATIVEMENT un jeton "fine-grained" GitHub
// (Settings -> Developer settings -> Fine-grained tokens) limité à :
//   - CE dépôt uniquement ("centralpdf", pas "tous les dépôts")
//   - Permission "Contents" en LECTURE SEULE, rien d'autre
// Ne jamais réutiliser ici un jeton ayant des droits plus larges (écriture,
// autres dépôts...) — celui utilisé pour PUBLIER les Releases (GH_TOKEN au
// moment du build) doit rester un jeton différent, jamais mis dans ce fichier.

let autoUpdater = null;
let loadError = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
  loadError = err;
}

function initUpdater({ app, ipcMain, dialog, BrowserWindow }) {
  let status = { state: 'idle', version: null, info: null };

  function broadcast() {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('update:status', status);
    });
  }

  function setStatus(state, extra = {}) {
    status = { state, version: null, info: null, ...extra };
    broadcast();
  }

  function checkForUpdates() {
    if (!app.isPackaged) {
      setStatus('unsupported', { info: { reason: 'not-packaged' } });
      return status;
    }
    if (!autoUpdater) {
      setStatus('unsupported', { info: { reason: 'module-missing', message: String(loadError?.message || loadError || '') } });
      return status;
    }
    setStatus('checking');
    autoUpdater.checkForUpdates().catch((err) => {
      setStatus('error', { info: { message: String(err?.message || err) } });
    });
    return status;
  }

  function setup() {
    if (!app.isPackaged || !autoUpdater) {
      checkForUpdates();
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => setStatus('checking'));
    autoUpdater.on('update-available', (info) => setStatus('downloading', { version: info?.version || null }));
    autoUpdater.on('update-not-available', (info) => setStatus('not-available', { version: info?.version || app.getVersion() }));
    autoUpdater.on('download-progress', (progress) => {
      setStatus('downloading', { version: status.version, info: { percent: Math.round(progress?.percent || 0) } });
    });
    autoUpdater.on('update-downloaded', (info) => {
      setStatus('downloaded', { version: info?.version || null });
      dialog.showMessageBox({
        type: 'info',
        title: 'Mise à jour disponible',
        message: `Central PDF Manager ${info.version} a été téléchargée.`,
        detail: "Elle sera installée automatiquement à la prochaine fermeture, ou tu peux redémarrer maintenant.",
        buttons: ['Redémarrer maintenant', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
    });
    autoUpdater.on('error', (err) => setStatus('error', { info: { message: String(err?.message || err) } }));

    setTimeout(checkForUpdates, 2500);
  }

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-update-status', () => status);
  ipcMain.handle('app:check-for-updates', () => checkForUpdates());
  ipcMain.handle('app:install-update', () => {
    if (!autoUpdater || status.state !== 'downloaded') return false;
    autoUpdater.quitAndInstall();
    return true;
  });

  return { setup };
}

module.exports = { initUpdater };
