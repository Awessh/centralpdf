const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // ---------- Fichiers / dossiers ----------
    openPath: (p) => ipcRenderer.invoke('shell:open-path', p),
    showInFolder: (p) => ipcRenderer.invoke('shell:show-in-folder', p),
    pdfOpenInApp: (p) => ipcRenderer.invoke('shell:open-path', p),
    printFile: (p) => ipcRenderer.invoke('app:print-file', p),
    saveTempImage: (dataUrl) => ipcRenderer.invoke('app:save-temp-image', { dataUrl }),
    getTempPath: (ext) => ipcRenderer.invoke('app:get-temp-path', ext),

    // ---------- Détection des outils externes ----------
    pdfCheckTools: (opts) => ipcRenderer.invoke('pdf:check-tools', opts),

    // ---------- Sélecteurs de fichiers ----------
    pdfChooseFiles: (opts) => ipcRenderer.invoke('pdf:choose-files', opts),
    pdfChooseSavePath: (opts) => ipcRenderer.invoke('pdf:choose-save-path', opts),
    pdfChooseFolder: () => ipcRenderer.invoke('pdf:choose-folder'),
    pdfGetInfo: (filePath, opts) => ipcRenderer.invoke('pdf:get-info', filePath, opts),
    pdfReadFileBase64: (filePath) => ipcRenderer.invoke('pdf:read-file-base64', filePath),

    // ---------- Organiser / Fusionner / Compresser / Scinder ----------
    pdfOrganize: (payload) => ipcRenderer.invoke('pdf:organize', payload),
    pdfMerge: (payload) => ipcRenderer.invoke('pdf:merge', payload),
    pdfSplit: (payload) => ipcRenderer.invoke('pdf:split', payload),
    pdfCompress: (payload) => ipcRenderer.invoke('pdf:compress', payload),

    // ---------- Modifier ----------
    pdfAddWatermark: (payload) => ipcRenderer.invoke('pdf:add-watermark', payload),
    pdfInsertBlankPages: (payload) => ipcRenderer.invoke('pdf:insert-blank-pages', payload),

    // ---------- Protéger ----------
    pdfProtect: (payload) => ipcRenderer.invoke('pdf:protect', payload),
    pdfUnlock: (payload) => ipcRenderer.invoke('pdf:unlock', payload),

    // ---------- Traduire ----------
    pdfExtractText: (payload) => ipcRenderer.invoke('pdf:extract-text', payload),
    pdfTranslate: (payload) => ipcRenderer.invoke('pdf:translate', payload),

    // ---------- Créateur PDF ----------
    pdfCreate: (payload) => ipcRenderer.invoke('pdf:create', payload),
    chooseImageFile: () => ipcRenderer.invoke('pdf:choose-image'),
    pdfListFonts: () => ipcRenderer.invoke('pdf:list-fonts'),

    // ---------- Convertir ----------
    pdfConvert: (payload) => ipcRenderer.invoke('pdf:convert', payload),

      // ---- Application / mise à jour ----
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),
    getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, d) => cb(d)),
});
