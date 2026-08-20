import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

const api = window.api;

// ============================================================
// Utilitaires génériques
// ============================================================
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
function baseName(filePath) {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
}
function stripExt(name) {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
}
function extOf(filePath) {
    const name = baseName(filePath);
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}
function normalizeRotation(deg) {
    let d = deg % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
}
function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} o`;
    const units = ['Ko', 'Mo', 'Go'];
    let val = bytes / 1024; let i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i += 1; }
    return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
}
function toFileUrl(p) {
    const clean = p.replace(/\\/g, '/');
    return clean.startsWith('/') ? `file://${clean}` : `file:///${clean}`;
}
function base64ToUint8Array(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function setStatus(elId, type, html) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `status-msg ${type}`;
    const icon = { info: 'fa-circle-info', success: 'fa-circle-check', warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark' }[type] || 'fa-circle-info';
    el.innerHTML = `<i class="fa-solid ${icon}"></i><div>${html}</div>`;
    el.classList.remove('hidden');
}
function clearStatus(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
}
function resultActionsHtml(outputPath) {
    return `
        <div class="status-actions">
            <button data-open-file="${encodeURIComponent(outputPath)}"><i class="fa-solid fa-file"></i> Ouvrir le fichier</button>
            <button data-open-folder="${encodeURIComponent(outputPath)}"><i class="fa-solid fa-folder-open"></i> Afficher dans le dossier</button>
        </div>
    `;
}

function showToast(type, html, durationMs = 6000) {
    const container = document.getElementById('toast-container');
    const icon = { info: 'fa-circle-info', success: 'fa-circle-check', warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark' }[type] || 'fa-circle-info';
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><div>${html}</div><button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`;
    const remove = () => {
        toast.style.animation = 'toast-out .15s ease-in forwards';
        setTimeout(() => toast.remove(), 150);
    };
    toast.querySelector('.toast-close').addEventListener('click', remove);
    container.appendChild(toast);
    if (durationMs > 0) setTimeout(remove, durationMs);
    return toast;
}

// Toast persistant avec ses propres boutons d'action (ex : mise à jour
// disponible). Ne disparaît pas tout seul — l'utilisateur choisit.
function showActionToast(id, type, html, buttons) {
    const container = document.getElementById('toast-container');
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const icon = { info: 'fa-circle-info', success: 'fa-circle-check', warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark' }[type] || 'fa-circle-info';
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `toast ${type} toast-action`;
    const btnsHtml = buttons.map((b, i) => `<button class="toast-action-btn ${b.primary ? 'primary' : ''}" data-idx="${i}">${b.label}</button>`).join('');
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><div>${html}<div class="toast-action-row">${btnsHtml}</div></div><button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`;
    const remove = () => { toast.style.animation = 'toast-out .15s ease-in forwards'; setTimeout(() => toast.remove(), 150); };
    toast.querySelector('.toast-close').addEventListener('click', remove);
    toast.querySelectorAll('.toast-action-btn').forEach((btnEl) => {
        btnEl.addEventListener('click', () => { buttons[Number(btnEl.dataset.idx)].onClick(); });
    });
    container.appendChild(toast);
    return toast;
}
function dismissActionToast(id) {
    const el = document.getElementById(id);
    if (el) { el.style.animation = 'toast-out .15s ease-in forwards'; setTimeout(() => el.remove(), 150); }
}

// ============================================================
// Thème (Système / Clair / Sombre) — paramètres
// ============================================================
const THEME_STORAGE_KEY = 'cpm-theme-preference';
function resolveSystemTheme() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}
function applyTheme(pref) {
    const resolved = pref === 'system' ? resolveSystemTheme() : pref;
    document.documentElement.setAttribute('data-theme', resolved);
    document.querySelectorAll('#theme-options .theme-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeChoice === pref);
    });
}
function initTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    applyTheme(stored);
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemChange = () => { if ((localStorage.getItem(THEME_STORAGE_KEY) || 'system') === 'system') applyTheme('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange); else mq.addListener(onSystemChange);
    document.querySelectorAll('#theme-options .theme-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const choice = btn.dataset.themeChoice;
            localStorage.setItem(THEME_STORAGE_KEY, choice);
            applyTheme(choice);
        });
    });
}
initTheme();

// ============================================================
// Barre latérale réductible (icônes seules)
// ============================================================
const SIDEBAR_STORAGE_KEY = 'cpm-sidebar-collapsed';
function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle-btn');
    if (localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1') sidebar.classList.add('collapsed');
    btn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
    });
}
initSidebarToggle();

// ============================================================
// Barre de progression globale (opérations en cours)
// ============================================================
let progressHideTimer = null;
function showGlobalProgress(percent, label) {
    clearTimeout(progressHideTimer);
    const bar = document.getElementById('global-progress-bar');
    const fill = document.getElementById('global-progress-fill');
    const chip = document.getElementById('global-progress-chip');
    const chipLabel = document.getElementById('global-progress-label');
    bar.classList.remove('hidden');
    chip.classList.remove('hidden');
    if (percent == null) {
        fill.classList.add('indeterminate');
        fill.style.width = '';
        chipLabel.textContent = label ? `${label}…` : 'Opération en cours…';
    } else {
        fill.classList.remove('indeterminate');
        fill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
        chipLabel.textContent = `${label ? `${label}… ` : ''}${Math.round(percent)}%`;
    }
}
function hideGlobalProgress() {
    const bar = document.getElementById('global-progress-bar');
    const chip = document.getElementById('global-progress-chip');
    const fill = document.getElementById('global-progress-fill');
    fill.classList.remove('indeterminate');
    fill.style.width = '100%';
    progressHideTimer = setTimeout(() => {
        bar.classList.add('hidden');
        chip.classList.add('hidden');
        fill.style.width = '0%';
    }, 350);
}
api.onProgress(({ percent, label }) => { showGlobalProgress(percent, label); });

// ============================================================
// Aperçu PDF en-app, avec impression (utilisé par tous les modules)
// ============================================================
const previewModal = { zoom: 1, filePath: null };
function initPreviewModal() {
    const overlay = document.getElementById('preview-modal');
    const closeBtn = document.getElementById('preview-close-btn');
    closeBtn.addEventListener('click', closePdfPreview);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePdfPreview(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closePdfPreview(); });
    document.getElementById('preview-zoom-in-btn').addEventListener('click', () => setPreviewZoom(previewModal.zoom + 0.2));
    document.getElementById('preview-zoom-out-btn').addEventListener('click', () => setPreviewZoom(previewModal.zoom - 0.2));
    document.getElementById('preview-print-btn').addEventListener('click', async () => {
        if (!previewModal.filePath) return;
        const btn = document.getElementById('preview-print-btn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Impression…';
        const res = await api.printFile(previewModal.filePath);
        btn.disabled = false;
        btn.innerHTML = original;
        if (!res.ok && res.error) showToast('error', `Impression impossible : ${escapeHtml(res.error)}`, 6000);
    });
}
function setPreviewZoom(z) {
    previewModal.zoom = Math.max(0.4, Math.min(3, z));
    document.getElementById('preview-zoom-val').textContent = `${Math.round(previewModal.zoom * 100)}%`;
    document.querySelectorAll('#preview-modal-body canvas').forEach((canvas) => {
        canvas.style.width = `${canvas.dataset.baseWidth * previewModal.zoom}px`;
    });
}
function closePdfPreview() {
    document.getElementById('preview-modal').classList.add('hidden');
    previewModal.filePath = null;
    document.getElementById('preview-modal-body').innerHTML = '';
}
async function openPdfPreview(filePath, opts = {}) {
    previewModal.filePath = filePath;
    previewModal.zoom = 1;
    const body = document.getElementById('preview-modal-body');
    document.getElementById('preview-modal-title').textContent = opts.title || baseName(filePath);
    document.getElementById('preview-zoom-val').textContent = '100%';
    body.innerHTML = '<div class="preview-modal-loading"><i class="fa-solid fa-spinner fa-spin"></i> Chargement de l\u2019aperçu…</div>';
    document.getElementById('preview-modal').classList.remove('hidden');
    try {
        const fileRes = await api.pdfReadFileBase64(filePath);
        if (!fileRes.ok) throw new Error(fileRes.error);
        const data = base64ToUint8Array(fileRes.base64);
        const pdfDoc = await pdfjsLib.getDocument({ data, password: opts.password || undefined }).promise;
        body.innerHTML = '';
        const targetWidth = 640;
        for (let i = 1; i <= pdfDoc.numPages; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const page = await pdfDoc.getPage(i);
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = targetWidth / baseViewport.width;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.className = 'preview-page-canvas';
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            canvas.dataset.baseWidth = viewport.width;
            canvas.style.width = `${viewport.width}px`;
            const ctx = canvas.getContext('2d');
            // eslint-disable-next-line no-await-in-loop
            await page.render({ canvasContext: ctx, viewport }).promise;
            body.appendChild(canvas);
        }
    } catch (err) {
        body.innerHTML = `<div class="preview-modal-loading"><i class="fa-solid fa-triangle-exclamation"></i> Aperçu indisponible : ${escapeHtml(err.message)}</div>`;
    }
}
initPreviewModal();

document.addEventListener('click', (e) => {
    const openFileBtn = e.target.closest('[data-open-file]');
    if (openFileBtn) { openPdfPreview(decodeURIComponent(openFileBtn.dataset.openFile)); return; }
    const openFolderBtn = e.target.closest('[data-open-folder]');
    if (openFolderBtn) { api.showInFolder(decodeURIComponent(openFolderBtn.dataset.openFolder)); }
});

// ============================================================
// Navigation entre outils (barre latérale)
// ============================================================
document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const activeBtn = document.querySelector('.tool-btn.active');
        const currentTool = activeBtn?.dataset.tool;
        if (activeBtn && currentTool && currentTool !== btn.dataset.tool) {
            const checker = panelBusyCheckers[currentTool];
            if (checker && checker()) {
                const proceed = await confirmDialog(
                    "Une opération est en cours dans cet onglet et n'a pas encore été enregistrée. "
                    + "Si tu changes d'onglet maintenant, ce travail sera perdu. Veux-tu continuer ?",
                );
                if (!proceed) return;
                // On confirme la perte du travail en cours : on réinitialise
                // immédiatement l'onglet quitté pour qu'il ne réapparaisse
                // pas si on y revient plus tard.
                panelResetters[currentTool]?.();
            }
        }
        document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`panel-${btn.dataset.tool}`).classList.add('active');
    });
});

// ============================================================
// Détection des outils externes
// ============================================================
async function refreshToolsStatus(forceRefresh = false) {
    const status = await api.pdfCheckTools({ forceRefresh });

    const pdfLibLine = document.getElementById('status-pdflib');
    if (status.pdfLib) {
        pdfLibLine.className = 'tool-status-line ok';
        pdfLibLine.innerHTML = '<i class="fa-solid fa-circle-check"></i> Moteur PDF prêt';
    } else {
        pdfLibLine.className = 'tool-status-line missing';
        pdfLibLine.innerHTML = "<i class=\"fa-solid fa-triangle-exclamation\"></i> Moteur PDF absent — lance <code>npm install</code>";
    }

    const sharpLine = document.getElementById('status-sharp');
    if (status.sharp) {
        sharpLine.className = 'tool-status-line ok';
        sharpLine.innerHTML = '<i class="fa-solid fa-circle-check"></i> Moteur de compression natif détecté';
    } else {
        sharpLine.className = 'tool-status-line missing';
        sharpLine.innerHTML = "<i class=\"fa-solid fa-triangle-exclamation\"></i> Moteur de compression natif absent";
    }

    const officeLine = document.getElementById('status-office');
    if (status.word || status.excel || status.powerpoint) {
        const parts = [status.word && 'Word', status.excel && 'Excel', status.powerpoint && 'PowerPoint'].filter(Boolean).join(' + ');
        officeLine.className = 'tool-status-line ok';
        officeLine.innerHTML = `<i class="fa-solid fa-circle-check"></i> Microsoft ${parts} détecté`;
    } else {
        officeLine.className = 'tool-status-line missing';
        officeLine.innerHTML = '<i class="fa-solid fa-circle-info"></i> Microsoft Office non détecté (COM)';
    }

    const loLine = document.getElementById('status-libreoffice');
    if (status.libreoffice) {
        loLine.className = 'tool-status-line ok';
        loLine.innerHTML = '<i class="fa-solid fa-circle-check"></i> LibreOffice détecté (repli)';
    } else {
        loLine.className = 'tool-status-line missing';
        loLine.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> LibreOffice absent (conversions Office limitées)';
    }
}
refreshToolsStatus();
document.getElementById('recheck-tools-btn').addEventListener('click', () => refreshToolsStatus(true));

// ============================================================
// Zones de dépôt génériques
// ============================================================
function wireDropzone(zoneId, { multiple = false, extensions = ['pdf'] } = {}, onFiles) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files || []).map((f) => f.path).filter(Boolean);
        const filtered = files.filter((p) => extensions.includes(extOf(p)));
        if (!filtered.length) return;
        onFiles(multiple ? filtered : [filtered[0]]);
    });
}

// ============================================================
// Modale mot de passe (PDF protégés)
// ============================================================
const pwdModal = document.getElementById('password-modal');
const pwdModalInput = document.getElementById('password-modal-input');
const pwdModalError = document.getElementById('password-modal-error');

function promptPassword(errorMsg) {
    return new Promise((resolve) => {
        pwdModalInput.value = '';
        pwdModalError.classList.toggle('hidden', !errorMsg);
        if (errorMsg) pwdModalError.textContent = errorMsg;
        pwdModal.classList.remove('hidden');
        pwdModalInput.focus();

        const cleanup = () => {
            pwdModal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            pwdModalInput.removeEventListener('keydown', onKeydown);
        };
        const okBtn = document.getElementById('password-modal-ok');
        const cancelBtn = document.getElementById('password-modal-cancel');
        const onOk = () => { const v = pwdModalInput.value; cleanup(); resolve(v || null); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKeydown = (e) => { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        pwdModalInput.addEventListener('keydown', onKeydown);
    });
}

// Charge les infos d'un PDF, en redemandant un mot de passe autant de fois
// que nécessaire. Renvoie { info, password } ou null si l'utilisateur annule.
async function getPdfInfoWithPassword(filePath) {
    let password = null;
    let error = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const info = await api.pdfGetInfo(filePath, { password });
        if (info.ok) return { info, password };
        if (!info.needsPassword) return { info, password: null };
        password = await promptPassword(error);
        if (password === null) return null;
        error = 'Mot de passe incorrect, réessaie.';
    }
}

// ============================================================
// ORGANISER (grille avec aperçu du contenu)
// ============================================================
const organizeState = { filePath: null, fileName: '', pages: [], password: null };

function rotClass(deg) {
    const d = normalizeRotation(deg);
    if (d === 90) return 'rot-90';
    if (d === -90 || d === 270) return 'rot--90';
    if (d === 180 || d === -180) return 'rot-180';
    return '';
}

function renderOrganizeGrid() {
    const grid = document.getElementById('organize-page-grid');
    grid.innerHTML = organizeState.pages.map((p, i) => `
        <div class="page-card${p.deleted ? ' deleted' : ''}" draggable="true" data-i="${i}">
            <div class="page-thumb-wrap">
                <img class="page-thumb ${rotClass(p.rotate)}" data-orig="${p.originalIndex}" src="${p.thumb || ''}">
                <div class="page-spinner ${p.thumb ? 'done' : ''}"><i class="fa-solid fa-spinner fa-spin"></i></div>
                <div class="page-deleted-badge"><i class="fa-solid fa-trash-can"></i></div>
            </div>
            <div class="page-card-footer">
                <span>Page ${p.originalIndex + 1}</span>
                <span class="page-rotation">${p.rotate ? `${p.rotate > 0 ? '+' : ''}${p.rotate}°` : ''}</span>
            </div>
            <div class="page-card-controls">
                <button data-act="rotate-left" title="Tourner à gauche"><i class="fa-solid fa-rotate-left"></i></button>
                <button data-act="rotate-right" title="Tourner à droite"><i class="fa-solid fa-rotate-right"></i></button>
                <button data-act="toggle-delete" class="danger" title="Supprimer / restaurer"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>
    `).join('');
}

async function renderThumbnailsProgressive(pdfDoc) {
    const targetWidth = 300;
    const queue = organizeState.pages.map((p, i) => ({ p, i }));
    const CONCURRENCY = 3;
    let cursor = 0;
    async function worker() {
        while (cursor < queue.length) {
            const { p, i } = queue[cursor]; cursor += 1;
            try {
                const page = await pdfDoc.getPage(p.originalIndex + 1);
                const baseViewport = page.getViewport({ scale: 1 });
                const scale = targetWidth / baseViewport.width;
                const viewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                p.thumb = canvas.toDataURL('image/jpeg', 0.72);
            } catch {
                p.thumb = null;
            }
            const img = document.querySelector(`#organize-page-grid .page-card[data-i="${i}"] .page-thumb`);
            const spinner = document.querySelector(`#organize-page-grid .page-card[data-i="${i}"] .page-spinner`);
            if (img && p.thumb) img.src = p.thumb;
            if (spinner) spinner.classList.add('done');
        }
    }
    await Promise.all(new Array(Math.min(CONCURRENCY, queue.length)).fill(0).map(worker));
}

async function loadOrganizeFile(filePath) {
    clearStatus('organize-status');
    const result = await getPdfInfoWithPassword(filePath);
    if (!result) return;
    const { info, password } = result;
    if (!info.ok) { setStatus('organize-status', 'error', info.error); return; }

    organizeState.filePath = filePath;
    organizeState.fileName = baseName(filePath);
    organizeState.password = password;
    organizeState.pages = info.pages.map((p) => ({ originalIndex: p.index, rotate: 0, deleted: false, thumb: null }));

    document.getElementById('organize-file-chip').innerHTML =
        `<i class="fa-solid fa-file-pdf"></i> ${organizeState.fileName} <span class="file-chip-meta">${info.pageCount} page(s) · ${formatBytes(info.fileSize)}</span>`;

    document.getElementById('organize-dropzone').classList.add('hidden');
    document.getElementById('organize-workspace').classList.remove('hidden');
    renderOrganizeGrid();

    try {
        const fileRes = await api.pdfReadFileBase64(filePath);
        if (!fileRes.ok) throw new Error(fileRes.error);
        const data = base64ToUint8Array(fileRes.base64);
        const loadingTask = pdfjsLib.getDocument({ data, password: password || undefined });
        const pdfDoc = await loadingTask.promise;
        await renderThumbnailsProgressive(pdfDoc);
    } catch (err) {
        setStatus('organize-status', 'warning', `Aperçus indisponibles (${err.message}), mais l'organisation reste fonctionnelle.`);
    }
}

document.getElementById('organize-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadOrganizeFile(paths[0]);
});
wireDropzone('organize-dropzone', { extensions: ['pdf'] }, (paths) => loadOrganizeFile(paths[0]));

// Parseur de plages de pages côté renderer (ex : "1-10,45-50"), en se
// basant sur la position actuelle des cartes dans la grille (1 = première
// carte affichée), pour rester cohérent même après un glisser-déposer.
function parsePageRangesClient(str, pageCount) {
    const parts = String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Indique au moins une page ou une plage de pages (ex : 1-10 ou 1-20,45-50).');
    const idx = new Set();
    parts.forEach((part) => {
        const m = part.match(/^(\d+)(?:-(\d+))?$/);
        if (!m) throw new Error(`Plage invalide : "${part}"`);
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : start;
        if (start < 1 || end > pageCount || start > end) {
            throw new Error(`Plage hors limites (le document a ${pageCount} page(s)) : "${part}"`);
        }
        for (let i = start; i <= end; i += 1) idx.add(i - 1);
    });
    return idx;
}

document.getElementById('organize-delete-range-btn').addEventListener('click', () => {
    const input = document.getElementById('organize-delete-range-input');
    const raw = input.value.trim();
    if (!raw) { setStatus('organize-status', 'error', 'Indique une plage de pages à supprimer (ex : 1-10 ou 1-20,45-50).'); return; }
    let indexes;
    try {
        indexes = parsePageRangesClient(raw, organizeState.pages.length);
    } catch (err) {
        setStatus('organize-status', 'error', err.message);
        return;
    }
    let count = 0;
    indexes.forEach((i) => {
        const page = organizeState.pages[i];
        if (page && !page.deleted) { page.deleted = true; count += 1; }
    });
    if (organizeState.pages.every((p) => p.deleted)) {
        indexes.forEach((i) => { const page = organizeState.pages[i]; if (page) page.deleted = false; });
        setStatus('organize-status', 'error', 'Impossible de supprimer toutes les pages : le document doit en garder au moins une.');
        return;
    }
    renderOrganizeGrid();
    input.value = '';
    setStatus('organize-status', 'success', `${count} page(s) marquée(s) pour suppression. Pense à "Enregistrer sous…" pour finaliser.`);
});

document.getElementById('organize-page-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.page-card');
    const i = parseInt(card.dataset.i, 10);
    const page = organizeState.pages[i];
    if (btn.dataset.act === 'rotate-left') page.rotate = normalizeRotation(page.rotate - 90);
    if (btn.dataset.act === 'rotate-right') page.rotate = normalizeRotation(page.rotate + 90);
    if (btn.dataset.act === 'toggle-delete') page.deleted = !page.deleted;
    renderOrganizeGrid();
});

let orgDragSrc = null;
document.getElementById('organize-page-grid').addEventListener('dragstart', (e) => {
    const card = e.target.closest('.page-card');
    if (!card) return;
    orgDragSrc = parseInt(card.dataset.i, 10);
    card.classList.add('dragging');
});
document.getElementById('organize-page-grid').addEventListener('dragend', (e) => {
    e.target.closest('.page-card')?.classList.remove('dragging');
});
document.getElementById('organize-page-grid').addEventListener('dragover', (e) => e.preventDefault());
document.getElementById('organize-page-grid').addEventListener('drop', (e) => {
    e.preventDefault();
    const card = e.target.closest('.page-card');
    if (!card || orgDragSrc === null) return;
    const targetIndex = parseInt(card.dataset.i, 10);
    if (targetIndex === orgDragSrc) return;
    const [moved] = organizeState.pages.splice(orgDragSrc, 1);
    organizeState.pages.splice(targetIndex, 0, moved);
    orgDragSrc = null;
    renderOrganizeGrid();
});

document.getElementById('organize-reset-btn').addEventListener('click', () => {
    organizeState.filePath = null;
    organizeState.pages = [];
    organizeState.password = null;
    document.getElementById('organize-workspace').classList.add('hidden');
    document.getElementById('organize-dropzone').classList.remove('hidden');
    clearStatus('organize-status');
});

document.getElementById('organize-save-btn').addEventListener('click', async () => {
    if (organizeState.pages.every((p) => p.deleted)) {
        setStatus('organize-status', 'error', 'Toutes les pages sont marquées comme supprimées : il ne resterait aucune page.');
        return;
    }
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(organizeState.fileName)}_organise.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;

    setStatus('organize-status', 'info', 'Traitement en cours…');
    const pagesPayload = organizeState.pages.map((p) => ({ index: p.originalIndex, rotate: p.rotate, deleted: p.deleted }));
    showGlobalProgress(null, 'Organisation du PDF');
    const res = await api.pdfOrganize({ filePath: organizeState.filePath, pages: pagesPayload, outputPath, password: organizeState.password }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('organize-status'); showToast('error', res.error, 9000); return; }
    clearStatus('organize-status');
    showToast('success', `PDF enregistré (${res.pageCount} page(s)).${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// FUSIONNER
// ============================================================
const mergeState = { files: [] };

function renderMergeList() {
    const list = document.getElementById('merge-file-list');
    list.innerHTML = mergeState.files.map((f, i) => `
        <li class="file-list-item" draggable="true" data-i="${i}">
            <i class="fa-solid fa-grip-vertical drag-handle"></i>
            <i class="fa-solid fa-file-pdf"></i>
            <span class="file-name">${f.name}</span>
            <button data-remove="${i}" title="Retirer"><i class="fa-solid fa-xmark"></i></button>
        </li>
    `).join('');
    document.getElementById('merge-actions').classList.toggle('hidden', mergeState.files.length < 2);
}
function addMergeFiles(paths) {
    paths.forEach((p) => { if (!mergeState.files.some((f) => f.path === p)) mergeState.files.push({ path: p, name: baseName(p) }); });
    clearStatus('merge-status');
    renderMergeList();
}
document.getElementById('merge-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: true, extensions: ['pdf'] });
    if (paths && paths.length) addMergeFiles(paths);
});
wireDropzone('merge-dropzone', { multiple: true, extensions: ['pdf'] }, addMergeFiles);
document.getElementById('merge-file-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    mergeState.files.splice(parseInt(btn.dataset.remove, 10), 1);
    renderMergeList();
});
let mergeDragSrc = null;
document.getElementById('merge-file-list').addEventListener('dragstart', (e) => {
    const li = e.target.closest('.file-list-item'); if (!li) return;
    mergeDragSrc = parseInt(li.dataset.i, 10); li.classList.add('dragging');
});
document.getElementById('merge-file-list').addEventListener('dragend', (e) => { e.target.closest('.file-list-item')?.classList.remove('dragging'); });
document.getElementById('merge-file-list').addEventListener('dragover', (e) => e.preventDefault());
document.getElementById('merge-file-list').addEventListener('drop', (e) => {
    e.preventDefault();
    const li = e.target.closest('.file-list-item');
    if (!li || mergeDragSrc === null) return;
    const targetIndex = parseInt(li.dataset.i, 10);
    if (targetIndex === mergeDragSrc) return;
    const [moved] = mergeState.files.splice(mergeDragSrc, 1);
    mergeState.files.splice(targetIndex, 0, moved);
    mergeDragSrc = null;
    renderMergeList();
});
document.getElementById('merge-clear-btn').addEventListener('click', () => { mergeState.files = []; renderMergeList(); clearStatus('merge-status'); });
document.getElementById('merge-run-btn').addEventListener('click', async () => {
    const outputPath = await api.pdfChooseSavePath({ defaultName: 'fusion.pdf', extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('merge-status', 'info', 'Fusion en cours…');
    showGlobalProgress(null, 'Fusion des PDF');
    const res = await api.pdfMerge({ filePaths: mergeState.files.map((f) => f.path), outputPath }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('merge-status'); showToast('error', res.error, 9000); return; }
    clearStatus('merge-status');
    showToast('success', `${mergeState.files.length} fichiers fusionnés en un PDF de ${res.pageCount} page(s).${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// COMPRESSER
// ============================================================
const compressState = { filePath: null, fileName: '' };
async function loadCompressFile(filePath) {
    clearStatus('compress-status');
    const info = await api.pdfGetInfo(filePath);
    if (!info.ok) { setStatus('compress-status', 'error', info.error); return; }
    compressState.filePath = filePath;
    compressState.fileName = baseName(filePath);
    document.getElementById('compress-file-chip').innerHTML =
        `<i class="fa-solid fa-file-pdf"></i> ${compressState.fileName} <span class="file-chip-meta">${formatBytes(info.fileSize)}</span>`;
    document.getElementById('compress-dropzone').classList.add('hidden');
    document.getElementById('compress-workspace').classList.remove('hidden');
}
document.getElementById('compress-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadCompressFile(paths[0]);
});
wireDropzone('compress-dropzone', { extensions: ['pdf'] }, (paths) => loadCompressFile(paths[0]));
document.getElementById('compress-reset-btn').addEventListener('click', () => {
    compressState.filePath = null;
    document.getElementById('compress-workspace').classList.add('hidden');
    document.getElementById('compress-dropzone').classList.remove('hidden');
    clearStatus('compress-status');
});
document.getElementById('compress-run-btn').addEventListener('click', async () => {
    const level = document.querySelector('input[name="compress-level"]:checked')?.value || 'medium';
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(compressState.fileName)}_compresse.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('compress-status', 'info', 'Compression en cours…');
    showGlobalProgress(null, 'Compression du PDF');
    const res = await api.pdfCompress({ filePath: compressState.filePath, level, outputPath }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('compress-status'); showToast('error', res.error, 9000); return; }
    clearStatus('compress-status');
    const ratio = res.before > 0 ? Math.round((1 - res.after / res.before) * 100) : 0;
    const sizeLine = `${formatBytes(res.before)} → ${formatBytes(res.after)} (${ratio > 0 ? `-${ratio}%` : 'aucun gain notable'})`;
    if (res.warning) showToast('warning', `${sizeLine}<br>${res.warning}${resultActionsHtml(outputPath)}`, 9000);
    else showToast('success', `${sizeLine}${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// SCINDER
// ============================================================
const splitState = { filePath: null, fileName: '' };
async function loadSplitFile(filePath) {
    clearStatus('split-status');
    document.getElementById('split-results').innerHTML = '';
    const info = await api.pdfGetInfo(filePath);
    if (!info.ok) { setStatus('split-status', 'error', info.error); return; }
    splitState.filePath = filePath;
    splitState.fileName = baseName(filePath);
    document.getElementById('split-file-chip').innerHTML =
        `<i class="fa-solid fa-file-pdf"></i> ${splitState.fileName} <span class="file-chip-meta">${info.pageCount} page(s)</span>`;
    document.getElementById('split-dropzone').classList.add('hidden');
    document.getElementById('split-workspace').classList.remove('hidden');
}
document.getElementById('split-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadSplitFile(paths[0]);
});
wireDropzone('split-dropzone', { extensions: ['pdf'] }, (paths) => loadSplitFile(paths[0]));
document.getElementById('split-mode').addEventListener('change', (e) => {
    document.getElementById('split-ranges-field').classList.toggle('hidden', e.target.value !== 'ranges');
    document.getElementById('split-every-field').classList.toggle('hidden', e.target.value !== 'every');
});
document.getElementById('split-reset-btn').addEventListener('click', () => {
    splitState.filePath = null;
    document.getElementById('split-workspace').classList.add('hidden');
    document.getElementById('split-dropzone').classList.remove('hidden');
    document.getElementById('split-results').innerHTML = '';
    clearStatus('split-status');
});
document.getElementById('split-run-btn').addEventListener('click', async () => {
    const mode = document.getElementById('split-mode').value;
    const ranges = document.getElementById('split-ranges-input').value;
    const everyN = document.getElementById('split-every-input').value;
    const outputDir = await api.pdfChooseFolder();
    if (!outputDir) return;
    setStatus('split-status', 'info', 'Scission en cours…');
    showGlobalProgress(null, 'Scission du PDF');
    const res = await api.pdfSplit({ filePath: splitState.filePath, mode, ranges, everyN, outputDir }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('split-status'); showToast('error', res.error, 9000); return; }
    clearStatus('split-status');
    showToast('success', `${res.files.length} fichier(s) créé(s) dans le dossier choisi.`, 9000);
    document.getElementById('split-results').innerHTML = res.files.map((f) => `
        <li class="file-list-item">
            <i class="fa-solid fa-file-pdf"></i>
            <span class="file-name">${baseName(f)}</span>
            <button data-open-folder="${encodeURIComponent(f)}" title="Afficher dans le dossier"><i class="fa-solid fa-folder-open"></i></button>
        </li>
    `).join('');
});

// ============================================================
// MODIFIER
// ============================================================
const editState = { filePath: null, fileName: '' };
async function loadEditFile(filePath) {
    clearStatus('edit-status');
    const info = await api.pdfGetInfo(filePath);
    if (!info.ok) { setStatus('edit-status', 'error', info.error); return; }
    editState.filePath = filePath;
    editState.fileName = baseName(filePath);
    document.getElementById('edit-file-chip').innerHTML =
        `<i class="fa-solid fa-file-pdf"></i> ${editState.fileName} <span class="file-chip-meta">${info.pageCount} page(s)</span>`;
    document.getElementById('edit-dropzone').classList.add('hidden');
    document.getElementById('edit-workspace').classList.remove('hidden');
}
document.getElementById('edit-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadEditFile(paths[0]);
});
wireDropzone('edit-dropzone', { extensions: ['pdf'] }, (paths) => loadEditFile(paths[0]));
document.querySelectorAll('.edit-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.edit-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.edit-tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`edit-tab-${btn.dataset.editTab}`).classList.add('active');
    });
});
document.getElementById('wm-opacity').addEventListener('input', (e) => { document.getElementById('wm-opacity-val').textContent = e.target.value; });
document.getElementById('wm-image-width').addEventListener('input', (e) => { document.getElementById('wm-image-width-val').textContent = e.target.value; });

const wmState = { type: 'text', imagePath: null };
document.querySelectorAll('.wm-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.wm-type-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        wmState.type = btn.dataset.wmType;
        document.getElementById('wm-text-fields').classList.toggle('hidden', wmState.type !== 'text');
        document.getElementById('wm-image-fields').classList.toggle('hidden', wmState.type !== 'image');
    });
});
document.getElementById('wm-choose-image-btn').addEventListener('click', async () => {
    const imgPath = await api.chooseImageFile();
    if (!imgPath) return;
    wmState.imagePath = imgPath;
    document.getElementById('wm-image-name').textContent = baseName(imgPath);
});

document.getElementById('edit-reset-btn').addEventListener('click', () => {
    editState.filePath = null;
    document.getElementById('edit-workspace').classList.add('hidden');
    document.getElementById('edit-dropzone').classList.remove('hidden');
    clearStatus('edit-status');
});
document.getElementById('wm-run-btn').addEventListener('click', async () => {
    const text = document.getElementById('wm-text').value.trim();
    if (wmState.type === 'text' && !text) { setStatus('edit-status', 'error', 'Indique le texte du filigrane.'); return; }
    if (wmState.type === 'image' && !wmState.imagePath) { setStatus('edit-status', 'error', 'Choisis une image à utiliser comme filigrane.'); return; }
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(editState.fileName)}_filigrane.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('edit-status', 'info', 'Application du filigrane…');
    showGlobalProgress(null, 'Application du filigrane');
    const res = await api.pdfAddWatermark({
        filePath: editState.filePath,
        type: wmState.type,
        text,
        imagePath: wmState.imagePath,
        imageWidthPct: parseInt(document.getElementById('wm-image-width').value, 10) || 30,
        fontSize: parseInt(document.getElementById('wm-size').value, 10) || 40,
        color: document.getElementById('wm-color').value,
        opacity: (parseInt(document.getElementById('wm-opacity').value, 10) || 35) / 100,
        rotationDeg: parseInt(document.getElementById('wm-rotation').value, 10) || 0,
        position: document.getElementById('wm-position').value,
        pagesSpec: document.getElementById('wm-pages').value.trim(),
        outputPath,
    });
    if (!res.ok) { clearStatus('edit-status'); showToast('error', res.error, 9000); return; }
    clearStatus('edit-status');
    showToast('success', `Filigrane appliqué à ${res.pageCount} page(s).${resultActionsHtml(outputPath)}`, 9000);
});
document.getElementById('blank-run-btn').addEventListener('click', async () => {
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(editState.fileName)}_pages.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('edit-status', 'info', 'Insertion des pages…');
    showGlobalProgress(null, 'Insertion des pages');
    const res = await api.pdfInsertBlankPages({
        filePath: editState.filePath,
        afterPage: parseInt(document.getElementById('blank-after').value, 10) || 0,
        count: parseInt(document.getElementById('blank-count').value, 10) || 1,
        outputPath,
    }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('edit-status'); showToast('error', res.error, 9000); return; }
    clearStatus('edit-status');
    showToast('success', `Pages insérées. Le document compte maintenant ${res.pageCount} page(s).${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// PROTÉGER
// ============================================================
document.querySelectorAll('.protect-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.protect-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.protect-tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`protect-tab-${btn.dataset.protectTab}`).classList.add('active');
    });
});

// ---- Ajouter une protection ----
const protectAddState = { filePath: null, fileName: '', currentPassword: null };
async function loadProtectAddFile(filePath) {
    clearStatus('protect-add-status');
    const result = await getPdfInfoWithPassword(filePath);
    if (!result) return;
    const { info, password } = result;
    if (!info.ok) { setStatus('protect-add-status', 'error', info.error); return; }
    protectAddState.filePath = filePath;
    protectAddState.fileName = baseName(filePath);
    protectAddState.currentPassword = password;
    document.getElementById('protect-add-file-chip').innerHTML =
        `<i class="fa-solid fa-file-pdf"></i> ${protectAddState.fileName} <span class="file-chip-meta">${info.pageCount} page(s)</span>`;
    document.getElementById('protect-add-dropzone').classList.add('hidden');
    document.getElementById('protect-add-workspace').classList.remove('hidden');
}
document.getElementById('protect-add-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadProtectAddFile(paths[0]);
});
wireDropzone('protect-add-dropzone', { extensions: ['pdf'] }, (paths) => loadProtectAddFile(paths[0]));
document.getElementById('protect-add-reset-btn').addEventListener('click', () => {
    protectAddState.filePath = null;
    document.getElementById('protect-add-workspace').classList.add('hidden');
    document.getElementById('protect-add-dropzone').classList.remove('hidden');
    clearStatus('protect-add-status');
});
document.getElementById('protect-add-run-btn').addEventListener('click', async () => {
    const userPassword = document.getElementById('protect-user-pwd').value;
    const ownerPassword = document.getElementById('protect-owner-pwd').value;
    if (!userPassword && !ownerPassword) {
        setStatus('protect-add-status', 'error', "Indique au moins un mot de passe (d'ouverture et/ou propriétaire).");
        return;
    }
    const permissions = {
        printing: document.getElementById('perm-printing').checked ? 'highResolution' : false,
        modifying: document.getElementById('perm-modifying').checked,
        copying: document.getElementById('perm-copying').checked,
        annotating: document.getElementById('perm-annotating').checked,
        fillingForms: document.getElementById('perm-fillingForms').checked,
        documentAssembly: document.getElementById('perm-documentAssembly').checked,
        contentAccessibility: true,
    };
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(protectAddState.fileName)}_protege.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('protect-add-status', 'info', 'Chiffrement en cours…');
    showGlobalProgress(null, 'Protection du PDF');
    const res = await api.pdfProtect({
        filePath: protectAddState.filePath,
        userPassword,
        ownerPassword,
        permissions,
        currentPassword: protectAddState.currentPassword,
        outputPath,
    }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('protect-add-status'); showToast('error', res.error, 9000); return; }
    clearStatus('protect-add-status');
    showToast('success', `PDF protégé avec succès.${resultActionsHtml(outputPath)}`, 9000);
});

// ---- Retirer la protection ----
const protectRemoveState = { filePath: null, fileName: '' };
function loadProtectRemoveFile(filePath) {
    clearStatus('protect-remove-status');
    protectRemoveState.filePath = filePath;
    protectRemoveState.fileName = baseName(filePath);
    document.getElementById('protect-remove-file-chip').innerHTML = `<i class="fa-solid fa-file-pdf"></i> ${protectRemoveState.fileName}`;
    document.getElementById('protect-remove-dropzone').classList.add('hidden');
    document.getElementById('protect-remove-workspace').classList.remove('hidden');
}
document.getElementById('protect-remove-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadProtectRemoveFile(paths[0]);
});
wireDropzone('protect-remove-dropzone', { extensions: ['pdf'] }, (paths) => loadProtectRemoveFile(paths[0]));
document.getElementById('protect-remove-reset-btn').addEventListener('click', () => {
    protectRemoveState.filePath = null;
    document.getElementById('protect-remove-workspace').classList.add('hidden');
    document.getElementById('protect-remove-dropzone').classList.remove('hidden');
    clearStatus('protect-remove-status');
});
document.getElementById('protect-remove-run-btn').addEventListener('click', async () => {
    const currentPassword = document.getElementById('protect-remove-pwd').value;
    if (!currentPassword) { setStatus('protect-remove-status', 'error', 'Indique le mot de passe actuel du document.'); return; }
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(protectRemoveState.fileName)}_sans_protection.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('protect-remove-status', 'info', 'Retrait de la protection…');
    showGlobalProgress(null, 'Retrait de la protection');
    const res = await api.pdfUnlock({ filePath: protectRemoveState.filePath, currentPassword, outputPath }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('protect-remove-status'); showToast('error', res.error, 9000); return; }
    clearStatus('protect-remove-status');
    showToast('success', `Protection retirée.${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// TRADUIRE
// ============================================================
const translateState = { filePath: null, fileName: '', password: null };
async function loadTranslateFile(filePath) {
    clearStatus('translate-status');
    const result = await getPdfInfoWithPassword(filePath);
    if (!result) return;
    const { info, password } = result;
    if (!info.ok) { setStatus('translate-status', 'error', info.error); return; }
    translateState.filePath = filePath;
    translateState.fileName = baseName(filePath);
    translateState.password = password;
    document.getElementById('translate-file-chip').innerHTML =
        `<i class="fa-solid fa-file-pdf"></i> ${translateState.fileName} <span class="file-chip-meta">${info.pageCount} page(s)</span>`;
    document.getElementById('translate-dropzone').classList.add('hidden');
    document.getElementById('translate-workspace').classList.remove('hidden');
}
document.getElementById('translate-choose-btn').addEventListener('click', async () => {
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: ['pdf'] });
    if (paths && paths.length) loadTranslateFile(paths[0]);
});
wireDropzone('translate-dropzone', { extensions: ['pdf'] }, (paths) => loadTranslateFile(paths[0]));
document.getElementById('translate-reset-btn').addEventListener('click', () => {
    translateState.filePath = null;
    document.getElementById('translate-workspace').classList.add('hidden');
    document.getElementById('translate-dropzone').classList.remove('hidden');
    clearStatus('translate-status');
});
document.getElementById('translate-run-btn').addEventListener('click', async () => {
    const sourceLang = document.getElementById('translate-source').value;
    const targetLang = document.getElementById('translate-target').value;
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(translateState.fileName)}_${targetLang}.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('translate-status', 'info', 'Extraction et traduction du texte en cours… cela peut prendre un moment selon la taille du document.');
    showGlobalProgress(null, 'Traduction du document');
    const res = await api.pdfTranslate({
        filePath: translateState.filePath, password: translateState.password, sourceLang, targetLang, outputPath,
    }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('translate-status'); showToast('error', res.error, 9000); return; }
    clearStatus('translate-status');
    const failNote = res.failures > 0 ? ` (${res.failures} segment(s) non traduits, quota du service gratuit probablement atteint)` : '';
    showToast('success', `Document traduit (${res.pageCount} page(s))${failNote}.${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// CRÉER UN PDF
// ============================================================
const PAGE_FORMATS = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    a5: [420.94, 595.28],
};
const creatorState = {
    pages: [], activeIndex: 0, selectedBlockIds: new Set(), nextId: 1, zoom: 1,
};
const STAGE_TARGET_WIDTH = 440;
const CREATOR_ZOOM_MIN = 0.3;
const CREATOR_ZOOM_MAX = 3;
const fontsState = { standard: [], system: [], loaded: false, loading: false };

async function ensureFontsLoaded() {
    if (fontsState.loaded || fontsState.loading) return;
    fontsState.loading = true;
    try {
        const res = await api.pdfListFonts();
        fontsState.standard = res.standard || [];
        fontsState.system = res.system || [];
        fontsState.loaded = true;
    } catch { /* la liste de polices système restera vide ; les polices standards suffisent */ }
    fontsState.loading = false;
}

function newPage(width, height) {
    return { id: creatorState.nextId++, width, height, background: '#ffffff', blocks: [] };
}
function currentPage() { return creatorState.pages[creatorState.activeIndex]; }
function currentScale() { return (STAGE_TARGET_WIDTH / currentPage().width) * creatorState.zoom; }
function getSelectedBlocks() {
    const page = currentPage();
    return page.blocks.filter((b) => creatorState.selectedBlockIds.has(b.id));
}
const SHAPE_TYPES = ['rect', 'ellipse', 'triangle'];

function renderPagesList() {
    const list = document.getElementById('create-pages-list');
    list.innerHTML = creatorState.pages.map((pg, i) => {
        const scale = 90 / pg.width;
        const miniBlocks = pg.blocks.map((b) => {
            const isShape = SHAPE_TYPES.includes(b.type);
            const color = b.type === 'image' ? '#8fb3ff' : (b.color || '#cccccc');
            const background = isShape && b.fill === false ? 'transparent' : color;
            const border = isShape && b.borderEnabled ? `1px solid ${b.borderColor || '#111111'};` : (isShape && b.fill === false ? `1px dashed ${color};` : '');
            let shapeStyle = '';
            if (b.type === 'ellipse') shapeStyle = 'border-radius:50%;';
            else if (b.type === 'triangle') shapeStyle = 'clip-path:polygon(50% 0%,100% 100%,0% 100%);';
            else if (b.type === 'rect' && b.radius) shapeStyle = `border-radius:${Math.min(b.radius, Math.min(b.w, b.h) / 2) * scale}px;`;
            return `<div style="position:absolute; left:${b.x * scale}px; top:${b.y * scale}px; width:${Math.max(2, b.w * scale)}px; height:${Math.max(2, b.h * scale)}px; background:${background}; ${border} ${shapeStyle}"></div>`;
        }).join('');
        return `
            <div class="creator-page-thumb ${i === creatorState.activeIndex ? 'active' : ''}" data-i="${i}" style="background:${pg.background};">
                ${miniBlocks}
                <span class="page-num-badge">${i + 1}</span>
            </div>
        `;
    }).join('');
}

function selectBlock(id, additive = false) {
    if (!additive) creatorState.selectedBlockIds.clear();
    if (id != null) {
        if (additive && creatorState.selectedBlockIds.has(id)) creatorState.selectedBlockIds.delete(id);
        else creatorState.selectedBlockIds.add(id);
    }
    renderStage();
    renderInspector();
}

const RESIZE_HANDLES = [
    { cls: 'rh-nw', dx: -1, dy: -1 }, { cls: 'rh-n', dx: 0, dy: -1 }, { cls: 'rh-ne', dx: 1, dy: -1 },
    { cls: 'rh-e', dx: 1, dy: 0 }, { cls: 'rh-se', dx: 1, dy: 1 }, { cls: 'rh-s', dx: 0, dy: 1 },
    { cls: 'rh-sw', dx: -1, dy: 1 }, { cls: 'rh-w', dx: -1, dy: 0 },
];

function wireResizeHandle(handleEl, block, dir) {
    handleEl.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        selectBlock(block.id);
        const startX = e.clientX; const startY = e.clientY;
        const orig = { x: block.x, y: block.y, w: block.w, h: block.h };
        const s = currentScale();
        function onMove(ev) {
            const ddx = (ev.clientX - startX) / s;
            const ddy = (ev.clientY - startY) / s;
            if (dir.dx === -1) { block.x = Math.min(orig.x + orig.w - 10, orig.x + ddx); block.w = Math.max(10, orig.w - ddx); }
            else if (dir.dx === 1) { block.w = Math.max(10, orig.w + ddx); }
            if (dir.dy === -1) { block.y = Math.min(orig.y + orig.h - 10, orig.y + ddy); block.h = Math.max(10, orig.h - ddy); }
            else if (dir.dy === 1) { block.h = Math.max(10, orig.h + ddy); }
            renderStage();
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            renderPagesList();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function renderStage() {
    const page = currentPage();
    const scale = currentScale();
    const stage = document.getElementById('create-stage');
    stage.style.width = `${page.width * scale}px`;
    stage.style.height = `${page.height * scale}px`;
    stage.style.background = page.background;
    document.getElementById('create-bg-color').value = page.background;

    stage.innerHTML = '';
    page.blocks.forEach((b) => {
        const div = document.createElement('div');
        div.className = `creator-block${creatorState.selectedBlockIds.has(b.id) ? ' selected' : ''}`;
        div.style.left = `${b.x * scale}px`;
        div.style.top = `${b.y * scale}px`;
        div.style.width = `${b.w * scale}px`;
        div.style.height = `${b.h * scale}px`;
        div.dataset.id = b.id;

        if (b.type === 'text') {
            const inner = document.createElement('div');
            inner.className = 'block-text';
            inner.style.fontSize = `${b.fontSize * scale}px`;
            inner.style.color = b.color;
            inner.style.fontWeight = b.bold ? '700' : '400';
            inner.style.textAlign = b.align || 'left';
            if (b.font && b.font.familyCss) inner.style.fontFamily = b.font.familyCss;
            inner.textContent = b.text;
            div.appendChild(inner);
        } else if (b.type === 'image') {
            const img = document.createElement('img');
            img.src = b.imagePath ? toFileUrl(b.imagePath) : '';
            div.appendChild(img);
        } else if (b.type === 'rect') {
            const rect = document.createElement('div');
            rect.className = 'block-rect';
            rect.style.borderRadius = `${Math.max(0, Math.min(b.radius || 0, Math.min(b.w, b.h) / 2)) * scale}px`;
            rect.style.border = b.borderEnabled ? `${Math.max(1, (b.borderWidth || 2) * scale)}px solid ${b.borderColor || '#111111'}` : 'none';
            if (b.imageFill) {
                rect.style.overflow = 'hidden';
                const img = document.createElement('img');
                img.className = 'block-shape-image';
                img.src = toFileUrl(b.imageFill);
                rect.appendChild(img);
            } else {
                rect.style.background = b.fill !== false ? b.color : 'transparent';
            }
            div.appendChild(rect);
        } else if (b.type === 'ellipse') {
            const el = document.createElement('div');
            el.className = 'block-circle';
            el.style.border = b.borderEnabled ? `${Math.max(1, (b.borderWidth || 2) * scale)}px solid ${b.borderColor || '#111111'}` : 'none';
            if (b.imageFill) {
                el.style.overflow = 'hidden';
                const img = document.createElement('img');
                img.className = 'block-shape-image';
                img.src = toFileUrl(b.imageFill);
                el.appendChild(img);
            } else {
            el.style.background = b.fill !== false ? b.color : 'transparent';
            }
            div.appendChild(el);
        } else if (b.type === 'triangle') {
            if (b.imageFill) {
                const clipWrap = document.createElement('div');
                clipWrap.className = 'block-triangle-clip';
                const img = document.createElement('img');
                img.className = 'block-shape-image';
                img.src = toFileUrl(b.imageFill);
                clipWrap.appendChild(img);
                div.appendChild(clipWrap);
            }
            const svgNs = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNs, 'svg');
            svg.setAttribute('viewBox', '0 0 100 100');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.classList.add('block-triangle-svg');
            const poly = document.createElementNS(svgNs, 'polygon');
            poly.setAttribute('points', '50,2 98,98 2,98');
            poly.setAttribute('fill', b.imageFill ? 'none' : (b.fill !== false ? b.color : 'none'));
            if (b.borderEnabled) {
                poly.setAttribute('stroke', b.borderColor || '#111111');
                poly.setAttribute('stroke-width', Math.max(1, b.borderWidth || 2));
            }
            svg.appendChild(poly);
            div.appendChild(svg);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'block-delete';
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            page.blocks = page.blocks.filter((bl) => bl.id !== b.id);
            creatorState.selectedBlockIds.delete(b.id);
            renderStage(); renderInspector(); renderPagesList();
        });
        div.appendChild(delBtn);

        RESIZE_HANDLES.forEach((dir) => {
        const handle = document.createElement('div');
            handle.className = `resize-handle ${dir.cls}`;
            wireResizeHandle(handle, b, dir);
        div.appendChild(handle);
        });

        div.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle') || e.target.classList.contains('block-delete')) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) { selectBlock(b.id, true); return; }
            if (!creatorState.selectedBlockIds.has(b.id)) selectBlock(b.id);
            const dragBlocks = getSelectedBlocks();
            const startX = e.clientX; const startY = e.clientY;
            const origins = dragBlocks.map((db) => ({ block: db, x: db.x, y: db.y }));
            const s = currentScale();
            let moved = false;
            function onMove(ev) {
                moved = true;
                const ddx = (ev.clientX - startX) / s;
                const ddy = (ev.clientY - startY) / s;
                origins.forEach((o) => { o.block.x = o.x + ddx; o.block.y = o.y + ddy; });
                renderStage();
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (moved) renderPagesList();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        stage.appendChild(div);
    });
}

function fontOptionsHtml(selectedKind, selectedKey) {
    const isSel = (kind, key) => (kind === selectedKind && key === selectedKey) ? 'selected' : '';
    let html = '<optgroup label="Polices standards">';
    fontsState.standard.forEach((f) => { html += `<option value="standard::${f.standardKey}" ${isSel('standard', f.standardKey)}>${f.label}</option>`; });
    html += '</optgroup>';
    if (fontsState.system.length) {
        html += '<optgroup label="Polices système (installées sur ce PC)">';
        fontsState.system.forEach((f) => { html += `<option value="system::${f.filePath}" ${isSel('system', f.filePath)}>${f.label}</option>`; });
        html += '</optgroup>';
    }
    return html;
}

function dimensionFieldsHtml(block) {
    return `
        <div class="inspector-section-title"><i class="fa-solid fa-arrows-up-down-left-right"></i> Position &amp; taille</div>
        <div class="inspector-dim-grid">
            <div class="field-group"><label>X (pt)</label><input type="number" id="insp-dim-x" value="${Math.round(block.x)}"></div>
            <div class="field-group"><label>Y (pt)</label><input type="number" id="insp-dim-y" value="${Math.round(block.y)}"></div>
            <div class="field-group"><label>Largeur (pt)</label><input type="number" id="insp-dim-w" min="2" value="${Math.round(block.w)}"></div>
            <div class="field-group"><label>Hauteur (pt)</label><input type="number" id="insp-dim-h" min="2" value="${Math.round(block.h)}"></div>
        </div>
    `;
}
function wireDimensionInputs(block) {
    const xEl = document.getElementById('insp-dim-x');
    const yEl = document.getElementById('insp-dim-y');
    const wEl = document.getElementById('insp-dim-w');
    const hEl = document.getElementById('insp-dim-h');
    xEl.addEventListener('change', () => { block.x = parseFloat(xEl.value) || 0; renderStage(); renderPagesList(); });
    yEl.addEventListener('change', () => { block.y = parseFloat(yEl.value) || 0; renderStage(); renderPagesList(); });
    wEl.addEventListener('change', () => { block.w = Math.max(2, parseFloat(wEl.value) || 2); renderStage(); renderPagesList(); renderInspector(); });
    hEl.addEventListener('change', () => { block.h = Math.max(2, parseFloat(hEl.value) || 2); renderStage(); renderPagesList(); renderInspector(); });
}

function renderInspector() {
    const box = document.getElementById('create-inspector');
    const selectedBlocks = getSelectedBlocks();

    if (!selectedBlocks.length) {
        box.innerHTML = '<p class="inspector-empty"><i class="fa-solid fa-arrow-pointer"></i> Sélectionne un élément — ou fais un cliquer-glisser sur la zone vide pour en sélectionner plusieurs — pour modifier ses propriétés. <br/> Raccourcis : <br/> <kbd>Ctrl</kbd>+<kbd>C</kbd>: copier <br/>· <kbd>Ctrl</kbd>+<kbd>V</kbd> : coller <br/>· <kbd>Ctrl</kbd>+<kbd>D</kbd> : dupliquer <br/>· <kbd>Ctrl</kbd>+<kbd>A</kbd> : tout sélectionner <br/>· <kbd>Suppr</kbd> : supprimer <br/>· flèches déplacer (<kbd>Maj</kbd>+flèche = 10px) <br/>· <kbd>Échap</kbd> : désélectionner <br/>· <kbd>Ctrl</kbd>+molette : zoomer <br/>· cliquer-glisser : sélection multiple</p>';
        return;
    }

    if (selectedBlocks.length > 1) {
        box.innerHTML = `
            <p class="inspector-multi-title"><i class="fa-solid fa-object-group"></i> ${selectedBlocks.length} éléments sélectionnés</p>
            <p class="inspector-hint">Glisse l'un des éléments sélectionnés pour tous les déplacer ensemble, ou utilise les flèches du clavier (<kbd>Maj</kbd>+flèche = pas de 10pt).</p>
            <button class="btn ghost small danger" id="insp-multi-delete"><i class="fa-solid fa-trash-can"></i> Supprimer la sélection</button>
        `;
        document.getElementById('insp-multi-delete').addEventListener('click', () => {
    const page = currentPage();
            const ids = new Set(selectedBlocks.map((b) => b.id));
            page.blocks = page.blocks.filter((b) => !ids.has(b.id));
            creatorState.selectedBlockIds.clear();
            renderStage(); renderInspector(); renderPagesList();
        });
        return;
    }

    const block = selectedBlocks[0];

    if (block.type === 'text') {
        const fontSpec = block.font || { kind: 'standard', key: 'Helvetica' };
        box.innerHTML = `
            <div class="inspector-row"><label>Texte</label><textarea id="insp-text" rows="4">${block.text}</textarea></div>
            <div class="inspector-row"><label>Police</label><select id="insp-font">${fontOptionsHtml(fontSpec.kind, fontSpec.key)}</select></div>
            <div class="inspector-row"><label>Taille de police</label><input type="number" id="insp-size" min="6" max="200" value="${block.fontSize}"></div>
            <div class="inspector-row"><label>Couleur</label><input type="color" id="insp-color" value="${block.color}"></div>
            <div class="inspector-row inspector-toggle"><input type="checkbox" id="insp-bold" ${block.bold ? 'checked' : ''}><label for="insp-bold">Gras (polices standards uniquement)</label></div>
            <div class="inspector-row"><label>Alignement</label>
                <div class="inspector-align">
                    <button data-align="left" class="${block.align === 'left' ? 'active' : ''}"><i class="fa-solid fa-align-left"></i></button>
                    <button data-align="center" class="${block.align === 'center' ? 'active' : ''}"><i class="fa-solid fa-align-center"></i></button>
                    <button data-align="right" class="${block.align === 'right' ? 'active' : ''}"><i class="fa-solid fa-align-right"></i></button>
                </div>
            </div>
            ${dimensionFieldsHtml(block)}
        `;
        document.getElementById('insp-text').addEventListener('input', (e) => { block.text = e.target.value; renderStage(); });
        document.getElementById('insp-size').addEventListener('input', (e) => { block.fontSize = parseInt(e.target.value, 10) || 14; renderStage(); });
        document.getElementById('insp-color').addEventListener('input', (e) => { block.color = e.target.value; renderStage(); });
        document.getElementById('insp-bold').addEventListener('change', (e) => {
            block.bold = e.target.checked;
            if (block.font && block.font.kind === 'standard') block.font.key = block.bold ? 'HelveticaBold' : 'Helvetica';
            renderStage();
        });
        document.getElementById('insp-font').addEventListener('change', (e) => {
            const [kind, key] = e.target.value.split('::');
            const match = kind === 'standard'
                ? fontsState.standard.find((f) => f.standardKey === key)
                : fontsState.system.find((f) => f.filePath === key);
            block.font = { kind, key, familyCss: kind === 'system' ? `"${(match?.label || '').replace(/["\\]/g, '')}", sans-serif` : undefined };
            renderStage();
        });
        box.querySelectorAll('[data-align]').forEach((btn) => btn.addEventListener('click', () => { block.align = btn.dataset.align; renderStage(); renderInspector(); }));
        wireDimensionInputs(block);
    } else if (block.type === 'image') {
        box.innerHTML = `
            <p class="inspector-empty">Image — fais glisser pour déplacer, poignées pour redimensionner.</p>
            <button class="btn ghost small" id="insp-replace-img"><i class="fa-solid fa-image"></i> Remplacer l'image</button>
            ${dimensionFieldsHtml(block)}
        `;
        document.getElementById('insp-replace-img').addEventListener('click', async () => {
            const imgPath = await api.chooseImageFile();
            if (imgPath) { block.imagePath = imgPath; renderStage(); }
        });
        wireDimensionInputs(block);
    } else if (SHAPE_TYPES.includes(block.type)) {
        const shapeLabel = { rect: 'Rectangle', ellipse: 'Cercle / ellipse', triangle: 'Triangle' }[block.type];
        const fillOn = block.fill !== false;
        const borderOn = !!block.borderEnabled;
        const maxRadius = Math.max(1, Math.floor(Math.min(block.w, block.h) / 2));
        box.innerHTML = `
            <p class="inspector-empty">${shapeLabel} — fais glisser pour déplacer, poignées pour redimensionner.</p>
            <div class="inspector-row">
                <label>Image incrustée (masque d'écrêtage)</label>
                <div class="inspector-clip-actions">
                    <button class="btn ghost small" id="insp-shape-image-btn"><i class="fa-solid fa-image"></i> ${block.imageFill ? "Changer l'image" : 'Incruster une image'}</button>
                    ${block.imageFill ? '<button class="btn ghost small danger" id="insp-shape-image-clear"><i class="fa-solid fa-xmark"></i> Retirer</button>' : ''}
                </div>
                <span class="inspector-hint-small">L'image sera automatiquement découpée pour épouser exactement le contour de la forme.</span>
            </div>
            <div class="inspector-row inspector-toggle"><input type="checkbox" id="insp-shape-fill" ${fillOn ? 'checked' : ''} ${block.imageFill ? 'disabled' : ''}><label for="insp-shape-fill">Remplir la forme (couleur unie)</label></div>
            <div class="inspector-row"><label>Couleur de remplissage</label><input type="color" id="insp-shape-color" value="${block.color}" ${fillOn && !block.imageFill ? '' : 'disabled'}></div>
            <div class="inspector-row inspector-toggle"><input type="checkbox" id="insp-shape-border" ${borderOn ? 'checked' : ''}><label for="insp-shape-border">Ajouter une bordure</label></div>
            <div class="inspector-row"><label>Couleur de bordure</label><input type="color" id="insp-shape-border-color" value="${block.borderColor || '#111111'}" ${borderOn ? '' : 'disabled'}></div>
            <div class="inspector-row"><label>Épaisseur de bordure (pt)</label><input type="number" id="insp-shape-border-width" min="1" max="40" value="${block.borderWidth || 2}" ${borderOn ? '' : 'disabled'}></div>
            ${block.type === 'rect' ? `<div class="inspector-row"><label>Rayon des coins (${Math.min(block.radius || 0, maxRadius)}pt)</label><input type="range" id="insp-shape-radius" min="0" max="${maxRadius}" value="${Math.min(block.radius || 0, maxRadius)}"></div>` : ''}
            ${dimensionFieldsHtml(block)}
        `;
        document.getElementById('insp-shape-image-btn').addEventListener('click', async () => {
            const imgPath = await api.chooseImageFile();
            if (imgPath) { block.imageFill = imgPath; renderStage(); renderPagesList(); renderInspector(); }
        });
        const clearImgBtn = document.getElementById('insp-shape-image-clear');
        if (clearImgBtn) clearImgBtn.addEventListener('click', () => { block.imageFill = null; renderStage(); renderPagesList(); renderInspector(); });
        document.getElementById('insp-shape-color').addEventListener('input', (e) => { block.color = e.target.value; renderStage(); renderPagesList(); });
        document.getElementById('insp-shape-fill').addEventListener('change', (e) => {
            block.fill = e.target.checked;
            if (!block.fill && !block.borderEnabled) block.borderEnabled = true;
            renderStage(); renderPagesList(); renderInspector();
        });
        document.getElementById('insp-shape-border').addEventListener('change', (e) => {
            block.borderEnabled = e.target.checked;
            if (!block.borderEnabled && block.fill === false) block.fill = true;
            renderStage(); renderPagesList(); renderInspector();
        });
        document.getElementById('insp-shape-border-color').addEventListener('input', (e) => { block.borderColor = e.target.value; renderStage(); renderPagesList(); });
        document.getElementById('insp-shape-border-width').addEventListener('input', (e) => { block.borderWidth = Math.max(1, parseInt(e.target.value, 10) || 1); renderStage(); renderPagesList(); });
        const radiusInput = document.getElementById('insp-shape-radius');
        if (radiusInput) radiusInput.addEventListener('input', (e) => { block.radius = parseInt(e.target.value, 10) || 0; renderStage(); renderPagesList(); });
        wireDimensionInputs(block);
    }
}

document.getElementById('create-start-btn').addEventListener('click', async () => {
    const format = document.getElementById('create-format').value;
    const orientation = document.getElementById('create-orientation').value;
    const count = Math.max(1, Math.min(50, parseInt(document.getElementById('create-page-count').value, 10) || 1));
    let [w, h] = PAGE_FORMATS[format];
    if (orientation === 'landscape') [w, h] = [h, w];

    creatorState.pages = Array.from({ length: count }, () => newPage(w, h));
    creatorState.activeIndex = 0;
    creatorState.selectedBlockIds.clear();

    document.getElementById('create-setup').classList.add('hidden');
    document.getElementById('create-editor').classList.remove('hidden');
    renderPagesList(); renderStage(); renderInspector();
    ensureFontsLoaded();
});

document.getElementById('create-pages-list').addEventListener('click', (e) => {
    const thumb = e.target.closest('.creator-page-thumb');
    if (!thumb) return;
    creatorState.activeIndex = parseInt(thumb.dataset.i, 10);
    creatorState.selectedBlockIds.clear();
    renderPagesList(); renderStage(); renderInspector();
});

document.getElementById('create-add-page-btn').addEventListener('click', () => {
    const ref = currentPage();
    creatorState.pages.push(newPage(ref.width, ref.height));
    creatorState.activeIndex = creatorState.pages.length - 1;
    creatorState.selectedBlockIds.clear();
    renderPagesList(); renderStage(); renderInspector();
});

document.getElementById('create-delete-page-btn').addEventListener('click', () => {
    if (creatorState.pages.length <= 1) { showToast('error', 'Le document doit contenir au moins une page.'); return; }
    creatorState.pages.splice(creatorState.activeIndex, 1);
    creatorState.activeIndex = Math.max(0, creatorState.activeIndex - 1);
    creatorState.selectedBlockIds.clear();
    renderPagesList(); renderStage(); renderInspector();
});

document.getElementById('create-bg-color').addEventListener('input', (e) => {
    currentPage().background = e.target.value;
    renderStage(); renderPagesList();
});

document.getElementById('create-add-text-btn').addEventListener('click', () => {
    const block = {
        id: creatorState.nextId++, type: 'text', x: 40, y: 40, w: 220, h: 50,
        text: 'Nouveau texte', fontSize: 18, color: '#111111', bold: false, align: 'left',
        font: { kind: 'standard', key: 'Helvetica' },
    };
    currentPage().blocks.push(block);
    selectBlock(block.id);
    renderPagesList();
});

document.getElementById('create-add-image-btn').addEventListener('click', async () => {
    const imgPath = await api.chooseImageFile();
    if (!imgPath) return;
    const block = {
        id: creatorState.nextId++, type: 'image', x: 40, y: 40, w: 180, h: 180, imagePath: imgPath,
    };
    currentPage().blocks.push(block);
    selectBlock(block.id);
    renderPagesList();
});

function addShapeBlock(type, defaults) {
    const block = {
        id: creatorState.nextId++,
        type,
        x: 40,
        y: 40,
        color: '#3b6fe0',
        fill: true,
        borderEnabled: false,
        borderColor: '#111111',
        borderWidth: 2,
        radius: type === 'rect' ? 0 : undefined,
        ...defaults,
    };
    currentPage().blocks.push(block);
    selectBlock(block.id);
    renderPagesList();
}
document.getElementById('create-add-rect-btn').addEventListener('click', () => addShapeBlock('rect', { w: 160, h: 90 }));
document.getElementById('create-add-circle-btn').addEventListener('click', () => addShapeBlock('ellipse', { w: 130, h: 130 }));
document.getElementById('create-add-triangle-btn').addEventListener('click', () => addShapeBlock('triangle', { w: 140, h: 120 }));

// Sélection multiple par cliquer-glisser : un rectangle translucide bleu
// apparaît pendant le glisser et sélectionne tous les éléments qu'il
// recouvre au relâchement (Maj = ajouter à la sélection existante).
document.getElementById('create-stage').addEventListener('mousedown', (e) => {
    if (e.target.id !== 'create-stage') return;
    const stage = e.currentTarget;
    const stageRect = stage.getBoundingClientRect();
    const startX = e.clientX - stageRect.left;
    const startY = e.clientY - stageRect.top;
    let rectEl = null;
    let dragged = false;
    function onMove(ev) {
        const curX = ev.clientX - stageRect.left;
        const curY = ev.clientY - stageRect.top;
        if (!dragged && Math.hypot(curX - startX, curY - startY) < 4) return;
        dragged = true;
        if (!rectEl) {
            rectEl = document.createElement('div');
            rectEl.className = 'creator-selection-rect';
            stage.appendChild(rectEl);
        }
        const left = Math.min(startX, curX); const top = Math.min(startY, curY);
        rectEl.style.left = `${left}px`; rectEl.style.top = `${top}px`;
        rectEl.style.width = `${Math.abs(curX - startX)}px`; rectEl.style.height = `${Math.abs(curY - startY)}px`;
    }
    function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragged && rectEl) {
            const curX = ev.clientX - stageRect.left;
            const curY = ev.clientY - stageRect.top;
            const selLeft = Math.min(startX, curX); const selTop = Math.min(startY, curY);
            const selRight = Math.max(startX, curX); const selBottom = Math.max(startY, curY);
            const scale = currentScale();
            const page = currentPage();
            if (!ev.shiftKey) creatorState.selectedBlockIds.clear();
            page.blocks.forEach((b) => {
                const bLeft = b.x * scale; const bTop = b.y * scale;
                const bRight = bLeft + b.w * scale; const bBottom = bTop + b.h * scale;
                if (bLeft < selRight && bRight > selLeft && bTop < selBottom && bBottom > selTop) creatorState.selectedBlockIds.add(b.id);
            });
            rectEl.remove();
            renderStage(); renderInspector();
        } else {
            creatorState.selectedBlockIds.clear();
            renderStage(); renderInspector();
        }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

// Zoom Ctrl+molette sur la zone de travail (+ boutons +/- de la barre d'outils)
function setCreatorZoom(z) {
    creatorState.zoom = Math.max(CREATOR_ZOOM_MIN, Math.min(CREATOR_ZOOM_MAX, Math.round(z * 100) / 100));
    renderStage();
    const zoomLabel = document.getElementById('create-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(creatorState.zoom * 100)}%`;
}
document.querySelector('.creator-stage-wrap').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setCreatorZoom(creatorState.zoom + (e.deltaY > 0 ? -0.1 : 0.1));
}, { passive: false });
document.getElementById('create-zoom-in-btn').addEventListener('click', () => setCreatorZoom(creatorState.zoom + 0.1));
document.getElementById('create-zoom-out-btn').addEventListener('click', () => setCreatorZoom(creatorState.zoom - 0.1));

// ------------------------------------------------------------
// Raccourcis clavier de l'éditeur (Créer un PDF)
// Ctrl/Cmd+C copier · Ctrl/Cmd+V coller · Ctrl/Cmd+D dupliquer ·
// Suppr/Retour arrière supprimer · flèches déplacer (+Maj = pas de 10px) ·
// Échap désélectionner.
// ------------------------------------------------------------
let creatorClipboard = null;

function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function cloneBlockWithOffset(source, offset = 20) {
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = creatorState.nextId++;
    clone.x = (clone.x || 0) + offset;
    clone.y = (clone.y || 0) + offset;
    return clone;
}

document.addEventListener('keydown', (e) => {
    const panel = document.getElementById('panel-create');
    if (!panel || !panel.classList.contains('active')) return;
    if (!creatorState.pages.length || !document.getElementById('create-editor') || document.getElementById('create-editor').classList.contains('hidden')) return;
    if (isTypingTarget(e.target)) return;

    const page = currentPage();
    const selectedBlocks = getSelectedBlocks();
    const block = selectedBlocks.length === 1 ? selectedBlocks[0] : null;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'c') {
        if (block) { creatorClipboard = JSON.parse(JSON.stringify(block)); showToast('info', 'Élément copié.', 1500); }
        e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'v') {
        if (creatorClipboard) {
            const clone = cloneBlockWithOffset(creatorClipboard);
            page.blocks.push(clone);
            selectBlock(clone.id);
            renderPagesList();
        }
        e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'd') {
        if (block) {
            const clone = cloneBlockWithOffset(block);
            page.blocks.push(clone);
            selectBlock(clone.id);
            renderPagesList();
        }
        e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'a') {
        page.blocks.forEach((b) => creatorState.selectedBlockIds.add(b.id));
        renderStage(); renderInspector();
        e.preventDefault();
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && e.target === document.body)) {
        if (selectedBlocks.length) {
            const ids = new Set(selectedBlocks.map((b) => b.id));
            page.blocks = page.blocks.filter((b) => !ids.has(b.id));
            creatorState.selectedBlockIds.clear();
            renderStage(); renderInspector(); renderPagesList();
        }
        e.preventDefault();
    } else if (e.key === 'Escape') {
        if (creatorState.selectedBlockIds.size) {
            creatorState.selectedBlockIds.clear();
            renderStage(); renderInspector();
        }
    } else if (selectedBlocks.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const step = e.shiftKey ? 10 : 1;
        selectedBlocks.forEach((blk) => {
            if (e.key === 'ArrowUp') blk.y -= step;
            if (e.key === 'ArrowDown') blk.y += step;
            if (e.key === 'ArrowLeft') blk.x -= step;
            if (e.key === 'ArrowRight') blk.x += step;
        });
        renderStage(); renderPagesList();
        e.preventDefault();
    }
});

document.getElementById('create-reset-btn').addEventListener('click', () => {
    creatorState.pages = [];
    creatorState.selectedBlockIds.clear();
    document.getElementById('create-editor').classList.add('hidden');
    document.getElementById('create-setup').classList.remove('hidden');
});

function loadImageEl(filePath) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image introuvable ou illisible"));
        img.src = toFileUrl(filePath);
    });
}

// Rasterise une forme + son image incrustée (masque d'écrêtage) en un seul
// PNG découpé exactement au contour de la forme, pour l'inclure dans le PDF
// comme une simple image (pdf-lib ne gère pas nativement le clipping).
async function rasterizeShapeImageFill(block) {
    const scaleFactor = 3;
    const w = Math.max(1, Math.round(block.w * scaleFactor));
    const h = Math.max(1, Math.round(block.h * scaleFactor));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    const tracePath = () => {
        ctx.beginPath();
        if (block.type === 'ellipse') {
            ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else if (block.type === 'triangle') {
            ctx.moveTo(w * 0.5, h * 0.02);
            ctx.lineTo(w * 0.98, h * 0.98);
            ctx.lineTo(w * 0.02, h * 0.98);
            ctx.closePath();
        } else {
            const r = Math.min(block.radius || 0, Math.min(block.w, block.h) / 2) * scaleFactor;
            if (r > 0) {
                ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
                ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath();
            } else {
                ctx.rect(0, 0, w, h);
            }
        }
    };

    ctx.save();
    tracePath();
    ctx.clip();
    const img = await loadImageEl(block.imageFill);
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let dw; let dh; let dx; let dy;
    if (imgRatio > boxRatio) { dh = h; dw = h * imgRatio; dx = (w - dw) / 2; dy = 0; }
    else { dw = w; dh = w / imgRatio; dx = 0; dy = (h - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();

    if (block.borderEnabled) {
        ctx.save();
        tracePath();
        ctx.lineWidth = Math.max(1, (block.borderWidth || 2) * scaleFactor);
        ctx.strokeStyle = block.borderColor || '#111111';
        ctx.stroke();
        ctx.restore();
    }

    const dataUrl = canvas.toDataURL('image/png');
    const saveRes = await api.saveTempImage(dataUrl);
    if (!saveRes.ok) throw new Error(saveRes.error);
    return saveRes.filePath;
}

async function buildCreatorPayloadPages() {
    const pages = [];
    for (const pg of creatorState.pages) {
        const blocks = [];
        for (const b of pg.blocks) {
            if (b.type === 'text') {
                blocks.push({ type: 'text', x: b.x, y: b.y, w: b.w, h: b.h, text: b.text, fontSize: b.fontSize, color: b.color, bold: b.bold, align: b.align, font: b.font });
            } else if (b.type === 'image') {
                blocks.push({ type: 'image', x: b.x, y: b.y, w: b.w, h: b.h, imagePath: b.imagePath });
            } else if (SHAPE_TYPES.includes(b.type) && b.imageFill) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const rasterPath = await rasterizeShapeImageFill(b);
                    blocks.push({ type: 'image', x: b.x, y: b.y, w: b.w, h: b.h, imagePath: rasterPath });
                } catch (err) {
                    showToast('warning', `Masque d'image ignoré sur un élément (${err.message}).`, 6000);
                    blocks.push({ type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, color: b.color, fill: b.fill, borderEnabled: b.borderEnabled, borderColor: b.borderColor, borderWidth: b.borderWidth, radius: b.radius });
                }
            } else {
                blocks.push({ type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, color: b.color, fill: b.fill, borderEnabled: b.borderEnabled, borderColor: b.borderColor, borderWidth: b.borderWidth, radius: b.radius });
            }
        }
        pages.push({ width: pg.width, height: pg.height, background: pg.background, blocks });
    }
    return pages;
}

document.getElementById('create-save-btn').addEventListener('click', async () => {
    const outputPath = await api.pdfChooseSavePath({ defaultName: 'document.pdf', extensions: ['pdf'] });
    if (!outputPath) return;
    showToast('info', 'Génération du PDF en cours…', 3000);
    const payloadPages = await buildCreatorPayloadPages();
    showGlobalProgress(null, 'Création du PDF');
    const res = await api.pdfCreate({ pages: payloadPages, outputPath }).finally(() => hideGlobalProgress());
    if (!res.ok) { showToast('error', res.error, 9000); return; }
    showToast('success', `PDF créé (${res.pageCount} page(s)).${resultActionsHtml(outputPath)}`, 9000);
});

async function generateCreatorPreviewFile() {
    const tempPath = await api.getTempPath('pdf');
    const payloadPages = await buildCreatorPayloadPages();
    showGlobalProgress(null, "Génération de l'aperçu");
    const res = await api.pdfCreate({ pages: payloadPages, outputPath: tempPath }).finally(() => hideGlobalProgress());
    if (!res.ok) { showToast('error', res.error, 9000); return null; }
    return tempPath;
}

// ============================================================
// CONVERTIR
// ============================================================
const convertState = { src: null, target: null, exts: [], filePath: null };
document.querySelectorAll('.convert-card').forEach((card) => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.convert-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        convertState.src = card.dataset.src;
        convertState.target = card.dataset.target;
        convertState.exts = card.dataset.exts.split(',');
        convertState.filePath = null;
        document.getElementById('convert-workspace').classList.remove('hidden');
        document.getElementById('convert-file-chip').classList.add('hidden');
        document.getElementById('convert-run-btn').disabled = true;
        clearStatus('convert-status');
        const labels = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', html: 'HTML' };
        if (convertState.target === 'pdf' && labels[convertState.src]) {
            setStatus('convert-status', 'info', `Sélectionne un fichier ${labels[convertState.src]} à convertir en PDF.`);
        } else if (labels[convertState.target]) {
            setStatus('convert-status', 'info', `Sélectionne un PDF à convertir en ${labels[convertState.target]}.`);
        }
    });
});
function loadConvertFile(filePath) {
    convertState.filePath = filePath;
    const chip = document.getElementById('convert-file-chip');
    chip.classList.remove('hidden');
    chip.innerHTML = `<i class="fa-solid fa-file"></i> ${baseName(filePath)}`;
    document.getElementById('convert-run-btn').disabled = false;
    clearStatus('convert-status');
}
document.getElementById('convert-choose-btn').addEventListener('click', async () => {
    if (!convertState.target) return;
    const paths = await api.pdfChooseFiles({ multiple: false, extensions: convertState.exts });
    if (paths && paths.length) loadConvertFile(paths[0]);
});
document.getElementById('convert-reset-btn').addEventListener('click', () => {
    convertState.src = null; convertState.target = null; convertState.filePath = null;
    document.querySelectorAll('.convert-card').forEach((c) => c.classList.remove('active'));
    document.getElementById('convert-workspace').classList.add('hidden');
    clearStatus('convert-status');
});
document.getElementById('convert-run-btn').addEventListener('click', async () => {
    if (!convertState.filePath || !convertState.target) return;
    const defaultName = `${stripExt(baseName(convertState.filePath))}.${convertState.target}`;
    const outputPath = await api.pdfChooseSavePath({ defaultName, extensions: [convertState.target] });
    if (!outputPath) return;
    setStatus('convert-status', 'info', 'Conversion en cours… cela peut prendre quelques instants.');
    showGlobalProgress(null, 'Conversion en cours');
    const res = await api.pdfConvert({ filePath: convertState.filePath, targetFormat: convertState.target, outputPath }).finally(() => hideGlobalProgress());
    if (!res.ok) { clearStatus('convert-status'); showToast('error', res.error, 9000); return; }
    clearStatus('convert-status');
    const engineLabel = { word: 'Microsoft Word', excel: 'Microsoft Excel', powerpoint: 'Microsoft PowerPoint', libreoffice: 'LibreOffice', electron: 'moteur intégré' }[res.engine] || '';
    showToast('success', `Conversion terminée${engineLabel ? ` (via ${engineLabel})` : ''}.${resultActionsHtml(outputPath)}`, 9000);
});

// ============================================================
// ============================================================
// Confirmation avant de changer d'onglet si une opération est en cours
// ============================================================
const panelBusyCheckers = {
    organize: () => !!organizeState.filePath,
    merge: () => mergeState.files.length > 0,
    compress: () => !!compressState.filePath,
    split: () => !!splitState.filePath,
    edit: () => !!editState.filePath,
    protect: () => !!protectAddState.filePath || !!protectRemoveState.filePath,
    translate: () => !!translateState.filePath,
    create: () => creatorState.pages.length > 0,
    convert: () => !!convertState.filePath,
};

// Réinitialise l'état (et l'interface) d'un onglet après confirmation de
// changement d'onglet, en réutilisant les boutons "Recommencer" déjà
// câblés pour chaque module — garantit que le travail en cours disparaît
// bel et bien si on revient sur l'onglet plus tard.
const panelResetters = {
    organize: () => document.getElementById('organize-reset-btn').click(),
    merge: () => document.getElementById('merge-clear-btn').click(),
    compress: () => document.getElementById('compress-reset-btn').click(),
    split: () => document.getElementById('split-reset-btn').click(),
    edit: () => document.getElementById('edit-reset-btn').click(),
    protect: () => {
        document.getElementById('protect-add-reset-btn').click();
        document.getElementById('protect-remove-reset-btn').click();
    },
    translate: () => document.getElementById('translate-reset-btn').click(),
    create: () => document.getElementById('create-reset-btn').click(),
    convert: () => document.getElementById('convert-reset-btn').click(),
};

function confirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-modal');
        document.getElementById('confirm-modal-message').textContent = message;
        overlay.classList.remove('hidden');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        const cleanup = () => {
            overlay.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// ============================================================
// À propos / mises à jour
// ============================================================
async function refreshAbout() {
    document.getElementById('about-version').textContent = (await api.getAppVersion()) || '—';
    renderUpdateStatus(await api.getUpdateStatus());
}
function renderUpdateStatus(status) {
    const statusEl = document.getElementById('about-update-status');
    const installBtn = document.getElementById('about-install-btn');
    const checkBtn = document.getElementById('about-check-btn');
    if (!status) return;
    installBtn.classList.add('hidden');
    checkBtn.disabled = false;
    switch (status.state) {
        case 'checking':
            checkBtn.disabled = true;
            statusEl.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Recherche d\u2019une mise à jour…';
            break;
        case 'available':
            statusEl.innerHTML = `<i class="fa-solid fa-circle-up"></i> Mise à jour ${escapeHtml(status.version || '')} disponible.`;
            break;
        case 'downloading':
            checkBtn.disabled = true;
            statusEl.innerHTML = status.info?.percent
                ? `<i class="fa-solid fa-arrows-rotate fa-spin"></i> Téléchargement de la version ${escapeHtml(status.version || '')}… (${status.info.percent}%)`
                : `<i class="fa-solid fa-arrows-rotate fa-spin"></i> Mise à jour ${escapeHtml(status.version || '')} disponible, téléchargement…`;
            break;
        case 'downloaded':
            statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Mise à jour ${escapeHtml(status.version || '')} prête à être installée.`;
            installBtn.classList.remove('hidden');
            break;
        case 'not-available':
            statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Tu utilises la dernière version.';
            break;
        case 'error':
            statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Échec de la vérification${status.info?.message ? ` : ${escapeHtml(status.info.message)}` : ''}.`;
            break;
        case 'unsupported':
            statusEl.textContent = 'Les mises à jour automatiques ne sont pas disponibles ici (mode développement).';
            checkBtn.disabled = true;
            break;
        default:
            statusEl.textContent = 'Statut inconnu.';
    }
}
document.getElementById('about-check-btn').addEventListener('click', async () => renderUpdateStatus(await api.checkForUpdates()));
document.getElementById('about-install-btn').addEventListener('click', () => api.installUpdate());

// ============================================================
// Toast de mise à jour automatique (dès le lancement, si une mise à
// jour est détectée) — "Mettre à jour" lance le téléchargement,
// "Le faire plus tard" ferme la carte sans rien installer.
// ============================================================
function formatUpdateDate(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return ''; }
}
function handleUpdateToast(status) {
    if (!status) return;
    if (status.state === 'available') {
        const dateStr = formatUpdateDate(status.info?.releaseDate);
        showActionToast('update-toast', 'info',
            `<strong>Mise à jour disponible${dateStr ? ` faite le ${dateStr}` : ''}</strong> pour ajouter de nouvelles fonctionnalités.`,
            [
                { label: "Le faire plus tard", onClick: () => dismissActionToast('update-toast') },
                {
                    label: 'Mettre à jour',
                    primary: true,
                    onClick: async () => {
                        dismissActionToast('update-toast');
                        await api.downloadUpdate();
                    },
                },
            ]);
    } else if (status.state === 'downloaded') {
        showActionToast('update-toast', 'success',
            `<strong>Mise à jour ${escapeHtml(status.version || '')} prête</strong> — redémarre l'application pour l'installer.`,
            [
                { label: 'Le faire plus tard', onClick: () => dismissActionToast('update-toast') },
                { label: 'Redémarrer maintenant', primary: true, onClick: () => { dismissActionToast('update-toast'); api.installUpdate(); } },
            ]);
    } else if (status.state === 'checking' || status.state === 'downloading') {
        dismissActionToast('update-toast');
    }
}
api.onUpdateStatus((status) => { renderUpdateStatus(status); handleUpdateToast(status); });

// ============================================================
// Boutons "Aperçu" en haut à droite de chaque module (avec impression)
// ============================================================
const previewSourceGetters = {
    organize: () => (organizeState.filePath ? { path: organizeState.filePath, password: organizeState.password } : null),
    merge: () => (mergeState.files[0] ? { path: mergeState.files[0].path } : null),
    compress: () => (compressState.filePath ? { path: compressState.filePath } : null),
    split: () => (splitState.filePath ? { path: splitState.filePath } : null),
    edit: () => (editState.filePath ? { path: editState.filePath } : null),
    protect: () => {
        if (protectAddState.filePath) return { path: protectAddState.filePath, password: protectAddState.currentPassword };
        if (protectRemoveState.filePath) return { path: protectRemoveState.filePath };
        return null;
    },
    translate: () => (translateState.filePath ? { path: translateState.filePath, password: translateState.password } : null),
    convert: () => (convertState.src === 'pdf' && convertState.filePath ? { path: convertState.filePath } : null),
};
document.querySelectorAll('.panel-preview-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const tool = btn.dataset.previewTool;
        if (tool === 'create') {
            if (!creatorState.pages.length || !creatorState.pages.some((p) => p.blocks.length)) {
                showToast('warning', 'Ajoute au moins un élément avant de prévisualiser le résultat.', 4000);
                return;
            }
            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération…';
            try {
                const tmpPath = await generateCreatorPreviewFile();
                if (tmpPath) await openPdfPreview(tmpPath, { title: 'Aperçu du document créé' });
            } finally {
                btn.disabled = false;
                btn.innerHTML = original;
            }
            return;
        }
        const getter = previewSourceGetters[tool];
        const source = getter ? getter() : null;
        if (!source) { showToast('warning', "Choisis d'abord un fichier PDF dans ce module pour en voir l'aperçu.", 4000); return; }
        openPdfPreview(source.path, { password: source.password });
    });
});

// ============================================================
// Préchargeur — reste affiché le temps de l'animation du logo,
// et jusqu'à ce que l'appli soit effectivement prête (le plus long
// des deux gagne, pour ne jamais couper l'animation ni faire
// attendre inutilement si tout est déjà chargé).
// ============================================================
const PRELOADER_MIN_MS = 4200;
const preloaderStartedAt = Date.now();
function hidePreloader() {
    const elapsed = Date.now() - preloaderStartedAt;
    const remaining = Math.max(0, PRELOADER_MIN_MS - elapsed);
    setTimeout(() => {
        const node = document.getElementById('preloader');
        if (!node) return;
        node.classList.add('hide');
        setTimeout(() => node.remove(), 550);
    }, remaining);
}

// ============================================================
// Initialisation
// ============================================================
(async function init() {
    try {
    await refreshAbout();
    } catch (err) {
        console.error('Erreur d\u2019initialisation :', err);
    } finally {
        hidePreloader();
    }
})();

