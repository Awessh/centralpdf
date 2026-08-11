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
}

document.addEventListener('click', (e) => {
    const openFileBtn = e.target.closest('[data-open-file]');
    if (openFileBtn) { api.openPath(decodeURIComponent(openFileBtn.dataset.openFile)); return; }
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
    const res = await api.pdfOrganize({ filePath: organizeState.filePath, pages: pagesPayload, outputPath, password: organizeState.password });
    if (!res.ok) { setStatus('organize-status', 'error', res.error); return; }
    setStatus('organize-status', 'success', `PDF enregistré (${res.pageCount} page(s)).${resultActionsHtml(outputPath)}`);
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
    const res = await api.pdfMerge({ filePaths: mergeState.files.map((f) => f.path), outputPath });
    if (!res.ok) { setStatus('merge-status', 'error', res.error); return; }
    setStatus('merge-status', 'success', `${mergeState.files.length} fichiers fusionnés en un PDF de ${res.pageCount} page(s).${resultActionsHtml(outputPath)}`);
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
    const res = await api.pdfCompress({ filePath: compressState.filePath, level, outputPath });
    if (!res.ok) { setStatus('compress-status', 'error', res.error); return; }
    const ratio = res.before > 0 ? Math.round((1 - res.after / res.before) * 100) : 0;
    const sizeLine = `${formatBytes(res.before)} → ${formatBytes(res.after)} (${ratio > 0 ? `-${ratio}%` : 'aucun gain notable'})`;
    if (res.warning) setStatus('compress-status', 'warning', `${sizeLine}<br>${res.warning}${resultActionsHtml(outputPath)}`);
    else setStatus('compress-status', 'success', `${sizeLine}${resultActionsHtml(outputPath)}`);
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
    const res = await api.pdfSplit({ filePath: splitState.filePath, mode, ranges, everyN, outputDir });
    if (!res.ok) { setStatus('split-status', 'error', res.error); return; }
    setStatus('split-status', 'success', `${res.files.length} fichier(s) créé(s) dans le dossier choisi.`);
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
    if (!res.ok) { setStatus('edit-status', 'error', res.error); return; }
    setStatus('edit-status', 'success', `Filigrane appliqué à ${res.pageCount} page(s).${resultActionsHtml(outputPath)}`);
});
document.getElementById('blank-run-btn').addEventListener('click', async () => {
    const outputPath = await api.pdfChooseSavePath({ defaultName: `${stripExt(editState.fileName)}_pages.pdf`, extensions: ['pdf'] });
    if (!outputPath) return;
    setStatus('edit-status', 'info', 'Insertion des pages…');
    const res = await api.pdfInsertBlankPages({
        filePath: editState.filePath,
        afterPage: parseInt(document.getElementById('blank-after').value, 10) || 0,
        count: parseInt(document.getElementById('blank-count').value, 10) || 1,
        outputPath,
    });
    if (!res.ok) { setStatus('edit-status', 'error', res.error); return; }
    setStatus('edit-status', 'success', `Pages insérées. Le document compte maintenant ${res.pageCount} page(s).${resultActionsHtml(outputPath)}`);
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
    const res = await api.pdfProtect({
        filePath: protectAddState.filePath,
        userPassword,
        ownerPassword,
        permissions,
        currentPassword: protectAddState.currentPassword,
        outputPath,
    });
    if (!res.ok) { setStatus('protect-add-status', 'error', res.error); return; }
    setStatus('protect-add-status', 'success', `PDF protégé avec succès.${resultActionsHtml(outputPath)}`);
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
    const res = await api.pdfUnlock({ filePath: protectRemoveState.filePath, currentPassword, outputPath });
    if (!res.ok) { setStatus('protect-remove-status', 'error', res.error); return; }
    setStatus('protect-remove-status', 'success', `Protection retirée.${resultActionsHtml(outputPath)}`);
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
    const res = await api.pdfTranslate({
        filePath: translateState.filePath, password: translateState.password, sourceLang, targetLang, outputPath,
    });
    if (!res.ok) { setStatus('translate-status', 'error', res.error); return; }
    const failNote = res.failures > 0 ? ` (${res.failures} segment(s) non traduits, quota du service gratuit probablement atteint)` : '';
    setStatus('translate-status', 'success', `Document traduit (${res.pageCount} page(s))${failNote}.${resultActionsHtml(outputPath)}`);
});

// ============================================================
// CRÉER UN PDF
// ============================================================
const PAGE_FORMATS = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    a5: [420.94, 595.28],
};
const creatorState = { pages: [], activeIndex: 0, selectedBlockId: null, nextId: 1 };
const STAGE_TARGET_WIDTH = 440;
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
function currentScale() { return STAGE_TARGET_WIDTH / currentPage().width; }
const SHAPE_TYPES = ['rect', 'ellipse', 'triangle'];

function renderPagesList() {
    const list = document.getElementById('create-pages-list');
    list.innerHTML = creatorState.pages.map((pg, i) => {
        const scale = 90 / pg.width;
        const miniBlocks = pg.blocks.map((b) => {
            const color = b.type === 'image' ? '#8fb3ff' : (b.color || '#cccccc');
            const shapeStyle = b.type === 'ellipse' ? 'border-radius:50%;' : b.type === 'triangle' ? 'clip-path:polygon(50% 0%,100% 100%,0% 100%);' : '';
            return `<div style="position:absolute; left:${b.x * scale}px; top:${b.y * scale}px; width:${Math.max(2, b.w * scale)}px; height:${Math.max(2, b.h * scale)}px; background:${color}; ${shapeStyle}"></div>`;
        }).join('');
        return `
            <div class="creator-page-thumb ${i === creatorState.activeIndex ? 'active' : ''}" data-i="${i}" style="background:${pg.background};">
                ${miniBlocks}
                <span class="page-num-badge">${i + 1}</span>
            </div>
        `;
    }).join('');
}

function selectBlock(id) {
    creatorState.selectedBlockId = id;
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
        div.className = `creator-block${b.id === creatorState.selectedBlockId ? ' selected' : ''}`;
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
            rect.style.background = b.color;
            div.appendChild(rect);
        } else if (b.type === 'ellipse') {
            const el = document.createElement('div');
            el.className = 'block-circle';
            el.style.background = b.color;
            div.appendChild(el);
        } else if (b.type === 'triangle') {
            const el = document.createElement('div');
            el.className = 'block-triangle';
            el.style.background = b.color;
            div.appendChild(el);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'block-delete';
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            page.blocks = page.blocks.filter((bl) => bl.id !== b.id);
            if (creatorState.selectedBlockId === b.id) creatorState.selectedBlockId = null;
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
            selectBlock(b.id);
            const startX = e.clientX; const startY = e.clientY;
            const origX = b.x; const origY = b.y;
            const s = currentScale();
            function onMove(ev) {
                b.x = origX + (ev.clientX - startX) / s;
                b.y = origY + (ev.clientY - startY) / s;
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

function renderInspector() {
    const box = document.getElementById('create-inspector');
    const page = currentPage();
    const block = page.blocks.find((b) => b.id === creatorState.selectedBlockId);
    if (!block) { box.innerHTML = '<p class="inspector-empty">Sélectionne un élément pour modifier ses propriétés.</p>'; return; }

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
    } else if (block.type === 'image') {
        box.innerHTML = `
            <p class="inspector-empty">Image — fais glisser pour déplacer, poignées pour redimensionner.</p>
            <button class="btn ghost small" id="insp-replace-img"><i class="fa-solid fa-image"></i> Remplacer l'image</button>
        `;
        document.getElementById('insp-replace-img').addEventListener('click', async () => {
            const imgPath = await api.chooseImageFile();
            if (imgPath) { block.imagePath = imgPath; renderStage(); }
        });
    } else if (SHAPE_TYPES.includes(block.type)) {
        const shapeLabel = { rect: 'Rectangle', ellipse: 'Cercle / ellipse', triangle: 'Triangle' }[block.type];
        box.innerHTML = `
            <p class="inspector-empty">${shapeLabel} — fais glisser pour déplacer, poignées pour redimensionner.</p>
            <div class="inspector-row"><label>Couleur</label><input type="color" id="insp-shape-color" value="${block.color}"></div>
        `;
        document.getElementById('insp-shape-color').addEventListener('input', (e) => { block.color = e.target.value; renderStage(); renderPagesList(); });
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
    creatorState.selectedBlockId = null;

    document.getElementById('create-setup').classList.add('hidden');
    document.getElementById('create-editor').classList.remove('hidden');
    renderPagesList(); renderStage(); renderInspector();
    ensureFontsLoaded();
});

document.getElementById('create-pages-list').addEventListener('click', (e) => {
    const thumb = e.target.closest('.creator-page-thumb');
    if (!thumb) return;
    creatorState.activeIndex = parseInt(thumb.dataset.i, 10);
    creatorState.selectedBlockId = null;
    renderPagesList(); renderStage(); renderInspector();
});

document.getElementById('create-add-page-btn').addEventListener('click', () => {
    const ref = currentPage();
    creatorState.pages.push(newPage(ref.width, ref.height));
    creatorState.activeIndex = creatorState.pages.length - 1;
    creatorState.selectedBlockId = null;
    renderPagesList(); renderStage(); renderInspector();
});

document.getElementById('create-delete-page-btn').addEventListener('click', () => {
    if (creatorState.pages.length <= 1) { showToast('error', 'Le document doit contenir au moins une page.'); return; }
    creatorState.pages.splice(creatorState.activeIndex, 1);
    creatorState.activeIndex = Math.max(0, creatorState.activeIndex - 1);
    creatorState.selectedBlockId = null;
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
    const block = { id: creatorState.nextId++, type, x: 40, y: 40, color: '#3b6fe0', ...defaults };
    currentPage().blocks.push(block);
    selectBlock(block.id);
    renderPagesList();
}
document.getElementById('create-add-rect-btn').addEventListener('click', () => addShapeBlock('rect', { w: 160, h: 90 }));
document.getElementById('create-add-circle-btn').addEventListener('click', () => addShapeBlock('ellipse', { w: 130, h: 130 }));
document.getElementById('create-add-triangle-btn').addEventListener('click', () => addShapeBlock('triangle', { w: 140, h: 120 }));

document.getElementById('create-stage').addEventListener('mousedown', (e) => {
    if (e.target.id === 'create-stage') { creatorState.selectedBlockId = null; renderStage(); renderInspector(); }
});

document.getElementById('create-reset-btn').addEventListener('click', () => {
    creatorState.pages = [];
    creatorState.selectedBlockId = null;
    document.getElementById('create-editor').classList.add('hidden');
    document.getElementById('create-setup').classList.remove('hidden');
});

document.getElementById('create-save-btn').addEventListener('click', async () => {
    const outputPath = await api.pdfChooseSavePath({ defaultName: 'document.pdf', extensions: ['pdf'] });
    if (!outputPath) return;
    showToast('info', 'Génération du PDF en cours…', 3000);
    const payloadPages = creatorState.pages.map((pg) => ({
        width: pg.width,
        height: pg.height,
        background: pg.background,
        blocks: pg.blocks.map((b) => {
            if (b.type === 'text') return { type: 'text', x: b.x, y: b.y, w: b.w, h: b.h, text: b.text, fontSize: b.fontSize, color: b.color, bold: b.bold, align: b.align, font: b.font };
            if (b.type === 'image') return { type: 'image', x: b.x, y: b.y, w: b.w, h: b.h, imagePath: b.imagePath };
            return { type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, color: b.color };
        }),
    }));
    const res = await api.pdfCreate({ pages: payloadPages, outputPath });
    if (!res.ok) { showToast('error', res.error, 9000); return; }
    showToast('success', `PDF créé (${res.pageCount} page(s)).${resultActionsHtml(outputPath)}`, 9000);
});

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
    const res = await api.pdfConvert({ filePath: convertState.filePath, targetFormat: convertState.target, outputPath });
    if (!res.ok) { setStatus('convert-status', 'error', res.error); return; }
    const engineLabel = { word: 'Microsoft Word', excel: 'Microsoft Excel', powerpoint: 'Microsoft PowerPoint', libreoffice: 'LibreOffice', electron: 'moteur intégré' }[res.engine] || '';
    setStatus('convert-status', 'success', `Conversion terminée${engineLabel ? ` (via ${engineLabel})` : ''}.${resultActionsHtml(outputPath)}`);
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
api.onUpdateStatus((status) => renderUpdateStatus(status));

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

