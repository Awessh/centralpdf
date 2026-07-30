const {
    app, BrowserWindow, ipcMain, dialog, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { initUpdater } = require('./src/updater');

// ------------------------------------------------------------
// Dépendances optionnelles / chargées dynamiquement
// ------------------------------------------------------------

// @cantoo/pdf-lib : fork de pdf-lib avec, en plus, le support natif du
// chiffrement (mot de passe / permissions) — utilisé pour TOUTES les
// opérations PDF de l'application (organiser, fusionner, protéger, créer…).
let pdfLib = null;
try {
    pdfLib = require('@cantoo/pdf-lib');
} catch {
    pdfLib = null; // Le Gestionnaire PDF affichera un message d'installation
}
function ensurePdfLib() {
    if (!pdfLib) {
        throw new Error(
            "Le module '@cantoo/pdf-lib' est introuvable. À la racine du projet, lance `npm install` "
            + "(il fait partie des dépendances de package.json) puis relance l'application.",
        );
    }
    return pdfLib;
}

// sharp : ré-encodage d'images natif utilisé pour la compression des PDF.
let sharpLib = null;
try {
    sharpLib = require('sharp');
} catch {
    sharpLib = null;
}

// pdfjs-dist (build "legacy", sans dépendance canvas) : utilisé uniquement
// pour EXTRAIRE le texte des pages (fonction Traduire). Le rendu visuel des
// vignettes, lui, est fait côté renderer (Chromium a un vrai <canvas>).
let pdfjsExtract = null;
function getPdfjsExtract() {
    if (pdfjsExtract) return pdfjsExtract;
    try {
        // eslint-disable-next-line global-require
        pdfjsExtract = require('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
        try {
            // Certaines versions n'exposent que le require CJS classique.
            // eslint-disable-next-line global-require
            pdfjsExtract = require('pdfjs-dist/legacy/build/pdf.js');
        } catch {
            pdfjsExtract = null;
        }
    }
    return pdfjsExtract;
}

// ------------------------------------------------------------
// Fenêtre principale
// ------------------------------------------------------------
let mainWindow = null;


const updater = initUpdater({ app, ipcMain, dialog, BrowserWindow });

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#1b1c22',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    mainWindow.loadFile('index.html');
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
   createMainWindow();
   updater.setup(); 
} );
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// ------------------------------------------------------------
// Lancement de processus externes (LibreOffice, Ghostscript, PowerShell/COM)
// ------------------------------------------------------------
function needsWindowsShell(bin) {
    return process.platform === 'win32' && !bin.includes('\\') && !bin.includes('/');
}

function spawnAttempt(bin, args, opts, viaCmdWrapper) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            if (viaCmdWrapper) {
                const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
                const fullCmd = `"${quote(bin)} ${args.map(quote).join(' ')}"`;
                proc = spawn('cmd.exe', ['/d', '/s', '/c', fullCmd], opts);
            } else {
                proc = spawn(bin, args, { shell: needsWindowsShell(bin), ...opts });
            }
        } catch (err) { reject(err); return; }
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve(); else reject(new Error(stderr.slice(-1000) || `Code de sortie ${code}`));
        });
    });
}

function describeSpawnError(err, bin) {
    if (err && err.code === 'ENOENT') {
        return `Impossible de lancer "${bin}" : programme introuvable. Vérifie qu'il est bien installé, puis clique sur "Revérifier".`;
    }
    return `Impossible de lancer "${bin}" (${err?.code || err?.message || 'erreur inconnue'}). Vérifie l'installation du programme, puis clique sur "Revérifier".`;
}

async function runProcess(bin, args, opts = {}) {
    const fullOpts = { timeout: 180000, ...opts };
    try {
        await spawnAttempt(bin, args, fullOpts, false);
    } catch (firstErr) {
        if (process.platform !== 'win32') throw new Error(describeSpawnError(firstErr, bin));
        try {
            await spawnAttempt(bin, args, fullOpts, true);
        } catch (secondErr) {
            throw new Error(describeSpawnError(secondErr, bin));
        }
    }
}

function trySpawnSyncVersion(bin, args) {
    try {
        const res = spawnSync(bin, args, { timeout: 8000, windowsHide: true, shell: needsWindowsShell(bin) });
        return !!(res && !res.error && res.status === 0);
    } catch { return false; }
}

// ---- Détection des outils externes optionnels (mise en cache) ----
let cachedSofficePath;
let cachedGsPath;
let cachedWordAvailable;
let cachedExcelAvailable;
let cachedPowerPointAvailable;

function locateSoffice() {
    if (cachedSofficePath !== undefined) return cachedSofficePath;
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push('soffice.exe', 'soffice');
        for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean)) {
            candidates.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'));
        }
    } else if (process.platform === 'darwin') {
        candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice');
    } else {
        candidates.push('soffice', 'libreoffice', '/usr/bin/soffice', '/usr/bin/libreoffice');
    }
    for (const c of candidates) {
        const isPath = c.includes(path.sep);
        if (isPath && !fs.existsSync(c)) continue;
        if (trySpawnSyncVersion(c, ['--version'])) { cachedSofficePath = c; return c; }
    }
    cachedSofficePath = null;
    return null;
}

function locateGhostscript() {
    if (cachedGsPath !== undefined) return cachedGsPath;
    const candidates = process.platform === 'win32' ? ['gswin64c', 'gswin32c'] : ['gs'];
    for (const c of candidates) {
        if (trySpawnSyncVersion(c, ['-v'])) { cachedGsPath = c; return c; }
    }
    if (process.platform === 'win32') {
        for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean)) {
            const gsDir = path.join(base, 'gs');
            if (!fs.existsSync(gsDir)) continue;
            try {
                for (const version of fs.readdirSync(gsDir)) {
                    for (const exeName of ['gswin64c.exe', 'gswin32c.exe']) {
                        const exe = path.join(gsDir, version, 'bin', exeName);
                        if (fs.existsSync(exe)) { cachedGsPath = exe; return exe; }
                    }
                }
            } catch { /* ignore */ }
        }
    }
    cachedGsPath = null;
    return null;
}

function isComProgIdRegistered(progId) {
    if (process.platform !== 'win32') return false;
    try {
        const res = spawnSync('reg.exe', ['query', `HKCR\\${progId}`], { timeout: 5000 });
        return !!(res && !res.error && res.status === 0);
    } catch { return false; }
}
function isWordAvailable() {
    if (cachedWordAvailable === undefined) cachedWordAvailable = isComProgIdRegistered('Word.Application');
    return cachedWordAvailable;
}
function isExcelAvailable() {
    if (cachedExcelAvailable === undefined) cachedExcelAvailable = isComProgIdRegistered('Excel.Application');
    return cachedExcelAvailable;
}
function isPowerPointAvailable() {
    if (cachedPowerPointAvailable === undefined) cachedPowerPointAvailable = isComProgIdRegistered('PowerPoint.Application');
    return cachedPowerPointAvailable;
}

// Lance un script PowerShell temporaire pilotant Word/Excel/PowerPoint par COM Automation.
async function runOfficeComScript(scriptBody, args) {
    const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'office-com-'));
    const scriptPath = path.join(tmpDir, 'convert.ps1');
    fs.writeFileSync(scriptPath, scriptBody, 'utf8');
    try {
        await runProcess('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath, ...args,
        ]);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

async function wordToPdfCom(inputPath, outputPath) {
    const script = `
param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    $doc = $word.Documents.Open($InputPath)
    $doc.SaveAs([ref]$OutputPath, [ref]17) # wdFormatPDF
    $doc.Close()
} finally {
    $word.Quit()
}
`;
    await runOfficeComScript(script, [inputPath, outputPath]);
}

async function pdfToWordCom(inputPath, outputPath) {
    const script = `
param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    $doc = $word.Documents.Open($InputPath)
    $doc.SaveAs([ref]$OutputPath, [ref]16) # wdFormatDocumentDefault (.docx)
    $doc.Close()
} finally {
    $word.Quit()
}
`;
    await runOfficeComScript(script, [inputPath, outputPath]);
}

async function excelToPdfCom(inputPath, outputPath) {
    const script = `
param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = "Stop"
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    $wb = $excel.Workbooks.Open($InputPath)
    $wb.ExportAsFixedFormat(0, $OutputPath) # xlTypePDF
    $wb.Close($false)
} finally {
    $excel.Quit()
}
`;
    await runOfficeComScript(script, [inputPath, outputPath]);
}

// PowerPoint -> PDF (via Microsoft PowerPoint, COM Automation)
async function powerPointToPdfCom(inputPath, outputPath) {
    const script = `
param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = "Stop"
$ppt = New-Object -ComObject PowerPoint.Application
try {
    $pres = $ppt.Presentations.Open($InputPath, $true, $true, $false)
    $pres.SaveAs($OutputPath, 32) # ppSaveAsPDF
    $pres.Close()
} finally {
    $ppt.Quit()
}
`;
    await runOfficeComScript(script, [inputPath, outputPath]);
}

function locateSofficeOrThrow() {
    const bin = locateSoffice();
    if (!bin) {
        throw new Error(
            "LibreOffice est introuvable sur ce PC. Installe-le gratuitement depuis "
            + 'https://www.libreoffice.org/download puis réessaie (nécessaire pour les '
            + 'conversions Word/Excel/PowerPoint/HTML).',
        );
    }
    return bin;
}

async function sofficeConvert(inputPath, targetExt) {
    const bin = locateSofficeOrThrow();
    const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'pdf-manager-'));
    try {
        await runProcess(bin, ['--headless', '--norestore', '--convert-to', targetExt, '--outdir', tmpDir, inputPath]);
        const base = path.basename(inputPath, path.extname(inputPath));
        let produced = path.join(tmpDir, `${base}.${targetExt}`);
        if (!fs.existsSync(produced)) {
            const match = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(`.${targetExt}`));
            if (!match) throw new Error("La conversion LibreOffice n'a produit aucun fichier de sortie.");
            produced = path.join(tmpDir, match);
        }
        return { producedPath: produced, tmpDir };
    } catch (err) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        throw err;
    }
}

async function convertHtmlToPdfNative(inputPath, outputPath) {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    try {
        await win.loadFile(inputPath);
        const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
        fs.writeFileSync(outputPath, data);
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

async function copyProducedFile(producedPath, tmpDir, outputPath) {
    try {
        fs.copyFileSync(producedPath, outputPath);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

// ------------------------------------------------------------
// Utilitaires PDF génériques
// ------------------------------------------------------------
function parsePageRanges(str, pageCount) {
    const parts = String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Indique au moins une page ou une plage de pages (ex : 1-3,5).');
    return parts.map((part) => {
        const m = part.match(/^(\d+)(?:-(\d+))?$/);
        if (!m) throw new Error(`Plage invalide : "${part}"`);
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : start;
        if (start < 1 || end > pageCount || start > end) {
            throw new Error(`Plage hors limites (le document a ${pageCount} page(s)) : "${part}"`);
        }
        const idx = [];
        for (let i = start; i <= end; i += 1) idx.push(i - 1);
        return idx;
    });
}

function hexToRgb01(hex) {
    const clean = (hex || '#FF0000').replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r || 0, g || 0, b || 0];
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function loadPdf(filePath, password) {
    const { PDFDocument } = ensurePdfLib();
    const opts = { ignoreEncryption: true, updateMetadata: false };
    if (password) opts.password = password;
    return PDFDocument.load(fs.readFileSync(filePath), opts);
}

// ---- Organiser : réordonner / tourner / supprimer les pages ----
async function pdfOrganize({ filePath, pages, outputPath, password }) {
    const { PDFDocument, degrees } = ensurePdfLib();
    const srcDoc = await loadPdf(filePath, password);
    const outDoc = await PDFDocument.create();

    const kept = (pages || []).filter((p) => !p.deleted);
    if (!kept.length) throw new Error('Impossible de produire un PDF sans aucune page.');

    const copiedPages = await outDoc.copyPages(srcDoc, kept.map((p) => p.index));
    copiedPages.forEach((page, i) => {
        const rotateBy = kept[i].rotate || 0;
        if (rotateBy) {
            const current = page.getRotation().angle || 0;
            page.setRotation(degrees(((current + rotateBy) % 360 + 360) % 360));
        }
        outDoc.addPage(page);
    });

    fs.writeFileSync(outputPath, await outDoc.save());
    return { pageCount: outDoc.getPageCount() };
}

// ---- Fusionner plusieurs PDF (dans l'ordre fourni) ----
async function pdfMerge({ filePaths, outputPath }) {
    const { PDFDocument } = ensurePdfLib();
    if (!filePaths || filePaths.length < 2) throw new Error('Sélectionne au moins deux fichiers PDF à fusionner.');
    const outDoc = await PDFDocument.create();
    for (const fp of filePaths) {
        const doc = await loadPdf(fp);
        const copied = await outDoc.copyPages(doc, doc.getPageIndices());
        copied.forEach((p) => outDoc.addPage(p));
    }
    fs.writeFileSync(outputPath, await outDoc.save());
    return { pageCount: outDoc.getPageCount() };
}

// ---- Scinder un PDF ----
async function pdfSplit({ filePath, mode, ranges, everyN, outputDir }) {
    const { PDFDocument } = ensurePdfLib();
    const srcDoc = await loadPdf(filePath);
    const pageCount = srcDoc.getPageCount();
    const base = path.basename(filePath, path.extname(filePath));
    ensureDir(outputDir);

    let groups;
    if (mode === 'ranges') {
        groups = parsePageRanges(ranges, pageCount);
    } else if (mode === 'every') {
        const n = Math.max(1, parseInt(everyN, 10) || 1);
        groups = [];
        for (let i = 0; i < pageCount; i += n) {
            const g = [];
            for (let j = i; j < Math.min(i + n, pageCount); j += 1) g.push(j);
            groups.push(g);
        }
    } else {
        groups = Array.from({ length: pageCount }, (_, i) => [i]);
    }

    const outFiles = [];
    for (let gi = 0; gi < groups.length; gi += 1) {
        const outDoc = await PDFDocument.create();
        const copied = await outDoc.copyPages(srcDoc, groups[gi]);
        copied.forEach((p) => outDoc.addPage(p));
        const outPath = path.join(outputDir, `${base}_partie${gi + 1}.pdf`);
        fs.writeFileSync(outPath, await outDoc.save());
        outFiles.push(outPath);
    }
    return { files: outFiles };
}

// ---- Compresser ----
async function pdfCompressNative({ filePath, level, outputPath }) {
    if (!sharpLib) return null;
    const { PDFName, PDFRawStream } = ensurePdfLib();
    const doc = await loadPdf(filePath);

    const qualityMap = { low: 40, medium: 65, high: 80 };
    const maxDimMap = { low: 1000, medium: 1500, high: 2200 };
    const quality = qualityMap[level] || 65;
    const maxDim = maxDimMap[level] || 1500;

    let touched = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        const dict = obj.dict;
        const subtype = dict.get(PDFName.of('Subtype'));
        if (!subtype || subtype.toString() !== '/Image') continue;
        const filter = dict.get(PDFName.of('Filter'));
        const filterStr = filter ? filter.toString() : '';
        if (!filterStr.includes('DCTDecode')) continue;
        try {
            const raw = Buffer.from(obj.contents);
            const meta = await sharpLib(raw).metadata();
            let pipeline = sharpLib(raw).jpeg({ quality, mozjpeg: true });
            if (meta.width > maxDim || meta.height > maxDim) {
                pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
            }
            const newBuf = await pipeline.toBuffer();
            if (newBuf.length >= raw.length) continue;
            obj.contents = newBuf;
            dict.set(PDFName.of('Length'), doc.context.obj(newBuf.length));
            if (meta.width > maxDim || meta.height > maxDim) {
                const newMeta = await sharpLib(newBuf).metadata();
                dict.set(PDFName.of('Width'), doc.context.obj(newMeta.width));
                dict.set(PDFName.of('Height'), doc.context.obj(newMeta.height));
            }
            touched += 1;
        } catch { /* image illisible, on la laisse inchangée */ }
    }

    if (touched === 0) return null;
    const before = fs.statSync(filePath).size;
    fs.writeFileSync(outputPath, await doc.save({ useObjectStreams: true }));
    const after = fs.statSync(outputPath).size;
    return { engine: 'sharp', before, after };
}

async function pdfCompress({ filePath, level, outputPath }) {
    const before = fs.statSync(filePath).size;
    const native = await pdfCompressNative({ filePath, level, outputPath });
    if (native) return native;

    const gsBin = locateGhostscript();
    if (gsBin) {
        const settingMap = { low: '/screen', medium: '/ebook', high: '/printer' };
        await runProcess(gsBin, [
            '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4',
            `-dPDFSETTINGS=${settingMap[level] || '/ebook'}`,
            '-dNOPAUSE', '-dQUIET', '-dBATCH',
            `-sOutputFile=${outputPath}`, filePath,
        ]);
        const after = fs.statSync(outputPath).size;
        return { engine: 'ghostscript', before, after };
    }

    const doc = await loadPdf(filePath);
    fs.writeFileSync(outputPath, await doc.save({ useObjectStreams: true }));
    const after = fs.statSync(outputPath).size;
    return {
        engine: 'pdf-lib',
        before,
        after,
        warning: !sharpLib
            ? "Le module 'sharp' est introuvable : compression d'images limitée. Lance "
              + "`npm install` à la racine du projet puis relance l'application."
            : 'Aucune image JPEG compressible détectée dans ce PDF : seule la structure a été optimisée.',
    };
}

// ---- Modifier : filigrane / texte libre ----
async function pdfAddWatermark({ filePath, text, opacity, fontSize, color, rotationDeg, position, pagesSpec, outputPath }) {
    const { rgb, degrees, StandardFonts } = ensurePdfLib();
    if (!text || !text.trim()) throw new Error('Indique le texte du filigrane.');

    const doc = await loadPdf(filePath);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const pageCount = doc.getPageCount();
    const targetIndices = pagesSpec && pagesSpec.trim()
        ? parsePageRanges(pagesSpec, pageCount).flat()
        : doc.getPageIndices();
    const [r, g, b] = hexToRgb01(color);
    const size = fontSize || 40;

    targetIndices.forEach((idx) => {
        const page = doc.getPage(idx);
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(text, size);
        let x; let y;
        switch (position) {
            case 'top-left': x = 24; y = height - size - 16; break;
            case 'top-right': x = width - textWidth - 24; y = height - size - 16; break;
            case 'bottom-left': x = 24; y = 24; break;
            case 'bottom-right': x = width - textWidth - 24; y = 24; break;
            default: x = (width - textWidth) / 2; y = height / 2;
        }
        page.drawText(text, {
            x, y, size, font, color: rgb(r, g, b),
            opacity: typeof opacity === 'number' ? opacity : 0.35,
            rotate: degrees(rotationDeg || 0),
        });
    });

    fs.writeFileSync(outputPath, await doc.save());
    return { pageCount };
}

// ---- Modifier : insertion de pages blanches ----
async function pdfInsertBlankPages({ filePath, afterPage, count, outputPath }) {
    const doc = await loadPdf(filePath);
    const pageCount = doc.getPageCount();
    const insertAt = Math.min(Math.max(0, afterPage || 0), pageCount);
    const n = Math.max(1, parseInt(count, 10) || 1);

    const refPage = pageCount ? doc.getPage(Math.max(0, insertAt - 1)) : null;
    const size = refPage ? refPage.getSize() : { width: 595.28, height: 841.89 };

    for (let i = 0; i < n; i += 1) doc.insertPage(insertAt + i, [size.width, size.height]);

    fs.writeFileSync(outputPath, await doc.save());
    return { pageCount: doc.getPageCount() };
}

// ---- Protéger : chiffrement par mot de passe + permissions ----
async function pdfProtect({
    filePath, userPassword, ownerPassword, permissions, currentPassword, outputPath,
}) {
    if (!userPassword && !ownerPassword) {
        throw new Error("Indique au moins un mot de passe (d'ouverture et/ou propriétaire).");
    }
    const doc = await loadPdf(filePath, currentPassword);
    doc.encrypt({
        userPassword: userPassword || undefined,
        ownerPassword: ownerPassword || userPassword || undefined,
        permissions: permissions || undefined,
    });
    fs.writeFileSync(outputPath, await doc.save());
    return { pageCount: doc.getPageCount() };
}

// ---- Retirer la protection (nécessite le mot de passe actuel) ----
async function pdfUnlock({ filePath, currentPassword, outputPath }) {
    if (!currentPassword) throw new Error('Indique le mot de passe actuel du document.');
    let doc;
    try {
        doc = await loadPdf(filePath, currentPassword);
    } catch {
        throw new Error("Mot de passe incorrect ou fichier corrompu : impossible d'ouvrir le PDF.");
    }
    fs.writeFileSync(outputPath, await doc.save());
    return { pageCount: doc.getPageCount() };
}

// ---- Extraction de texte (pour Traduire) ----
async function pdfExtractText({ filePath, password }) {
    const pdfjs = getPdfjsExtract();
    if (!pdfjs) {
        throw new Error(
            "Le module 'pdfjs-dist' est introuvable. Lance `npm install` à la racine du projet "
            + 'puis relance l\'application.',
        );
    }
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjs.getDocument({
        data, password: password || undefined, isEvalSupported: false, useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
        pages.push(text);
    }
    return { pageCount: doc.numPages, pages };
}

// ---- Traduction (MyMemory, gratuit, sans clé) ----
async function translateChunk(text, source, target, email) {
    const params = new URLSearchParams({ q: text.slice(0, 490), langpair: `${source}|${target}` });
    if (email) params.set('de', email);
    const res = await fetch(`https://api.mymemory.translated.net/get?${params}`);
    const data = await res.json();
    if (data.responseStatus !== 200 && data.responseStatus !== '200') {
        throw new Error(data.responseDetails || 'Échec de la traduction');
    }
    return data.responseData.translatedText;
}

function splitIntoChunks(text, maxLen) {
    const chunks = [];
    let remaining = text.trim();
    while (remaining.length > maxLen) {
        let cut = remaining.lastIndexOf('. ', maxLen);
        if (cut < maxLen * 0.4) cut = remaining.lastIndexOf(' ', maxLen);
        if (cut <= 0) cut = maxLen;
        chunks.push(remaining.slice(0, cut + 1).trim());
        remaining = remaining.slice(cut + 1).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function next() {
        while (cursor < items.length) {
            const i = cursor;
            cursor += 1;
            results[i] = await worker(items[i], i);
        }
    }
    await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(next));
    return results;
}

// Traduit le texte extrait et reconstruit un nouveau PDF (texte reflowé,
// sans conserver la mise en page d'origine — clairement indiqué dans l'UI).
async function pdfTranslate({
    filePath, password, sourceLang, targetLang, email, outputPath,
}) {
    const { PDFDocument, StandardFonts, rgb } = ensurePdfLib();
    const { pages: sourcePages } = await pdfExtractText({ filePath, password });
    if (!sourcePages.some((t) => t.trim())) {
        throw new Error('Aucun texte détecté dans ce PDF (peut-être un PDF scanné/image).');
    }

    const outDoc = await PDFDocument.create();
    const font = await outDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 595.28; const pageHeight = 841.89; // A4
    const margin = 50; const fontSize = 11; const lineHeight = 15;
    let failures = 0;

    for (let pi = 0; pi < sourcePages.length; pi += 1) {
        const original = sourcePages[pi];
        let translatedText = '';
        if (original.trim()) {
            const chunks = splitIntoChunks(original, 480);
            const translatedChunks = await runWithConcurrency(chunks, 4, async (chunk) => {
                try {
                    return await translateChunk(chunk, sourceLang || 'auto', targetLang, email);
                } catch {
                    failures += 1;
                    return chunk;
                }
            });
            translatedText = translatedChunks.join(' ');
        }

        let page = outDoc.addPage([pageWidth, pageHeight]);
        page.drawText(`Page ${pi + 1}`, {
            x: margin, y: pageHeight - margin + 10, size: 9, font: fontBold, color: rgb(0.6, 0.6, 0.6),
        });

        const maxWidth = pageWidth - margin * 2;
        const words = translatedText.split(/\s+/).filter(Boolean);
        let line = '';
        let y = pageHeight - margin;
        const words2 = words.length ? words : ['(page sans texte)'];

        const flushLine = () => {
            if (y < margin) {
                page = outDoc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
            }
            page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.08, 0.08, 0.1) });
            y -= lineHeight;
            line = '';
        };

        words2.forEach((word) => {
            const test = line ? `${line} ${word}` : word;
            if (font.widthOfTextAtSize(test, fontSize) > maxWidth && line) {
                flushLine();
                line = word;
            } else {
                line = test;
            }
        });
        if (line) flushLine();
    }

    fs.writeFileSync(outputPath, await outDoc.save());
    return { pageCount: outDoc.getPageCount(), failures };
}

// ---- Créateur de PDF (depuis zéro) ----
function pdfPositionToPoints(block, pageHeightPt) {
    // Convertit une position "haut-gauche, y vers le bas" (comme le HTML)
    // vers le repère PDF ("bas-gauche, y vers le haut").
    return pageHeightPt - block.y - block.h;
}

async function embedImageAuto(doc, filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const bytes = fs.readFileSync(filePath);
    if (ext === 'png') return doc.embedPng(bytes);
    return doc.embedJpg(bytes); // jpg/jpeg par défaut, la plupart des autres formats sont convertis côté renderer via <canvas> en amont si besoin
}

function wrapTextLines(text, font, size, maxWidth) {
    const lines = [];
    (text || '').split('\n').forEach((paragraph) => {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) { lines.push(''); return; }
        let line = '';
        words.forEach((word) => {
            const test = line ? `${line} ${word}` : word;
            if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
    });
    return lines;
}

async function pdfCreate({ pages, outputPath }) {
    const { PDFDocument, StandardFonts, rgb } = ensurePdfLib();
    const outDoc = await PDFDocument.create();
    const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const imageCache = new Map();

    for (const pageDef of pages) {
        const { width, height } = pageDef;
        const page = outDoc.addPage([width, height]);

        if (pageDef.background && pageDef.background !== '#ffffff') {
            const [r, g, b] = hexToRgb01(pageDef.background);
            page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(r, g, b) });
        }

        for (const block of (pageDef.blocks || [])) {
            if (block.type === 'text') {
                const font = block.bold ? fontBold : fontRegular;
                const size = block.fontSize || 14;
                const [r, g, b] = hexToRgb01(block.color || '#111111');
                const lineHeight = size * 1.28;
                const lines = wrapTextLines(block.text || '', font, size, block.w);
                let y = pdfPositionToPoints(block, height) + block.h - size;
                for (const line of lines) {
                    if (y < pdfPositionToPoints(block, height) - 2) break; // dépasse la zone : on tronque proprement
                    let x = block.x;
                    if (block.align === 'center') x = block.x + (block.w - font.widthOfTextAtSize(line, size)) / 2;
                    else if (block.align === 'right') x = block.x + block.w - font.widthOfTextAtSize(line, size);
                    page.drawText(line, { x, y, size, font, color: rgb(r, g, b) });
                    y -= lineHeight;
                }
            } else if (block.type === 'image' && block.imagePath) {
                let embedded = imageCache.get(block.imagePath);
                if (!embedded) {
                    embedded = await embedImageAuto(outDoc, block.imagePath);
                    imageCache.set(block.imagePath, embedded);
                }
                page.drawImage(embedded, {
                    x: block.x, y: pdfPositionToPoints(block, height), width: block.w, height: block.h,
                });
            } else if (block.type === 'rect') {
                const [r, g, b] = hexToRgb01(block.color || '#111111');
                page.drawRectangle({
                    x: block.x, y: pdfPositionToPoints(block, height), width: block.w, height: block.h, color: rgb(r, g, b),
                });
            }
        }
    }

    fs.writeFileSync(outputPath, await outDoc.save());
    return { pageCount: outDoc.getPageCount() };
}

// ---- Conversion (Word / Excel / PowerPoint / HTML <-> PDF) ----
async function pdfConvertFile({ filePath, targetFormat, outputPath }) {
    const srcExt = path.extname(filePath).slice(1).toLowerCase();

    if (targetFormat === 'pdf' && ['html', 'htm'].includes(srcExt)) {
        await convertHtmlToPdfNative(filePath, outputPath);
        return { outputPath, engine: 'electron' };
    }

    if (targetFormat === 'pdf' && ['docx', 'doc'].includes(srcExt)) {
        if (isWordAvailable()) {
            await wordToPdfCom(filePath, outputPath);
            return { outputPath, engine: 'word' };
        }
        const { producedPath, tmpDir } = await sofficeConvert(filePath, 'pdf');
        await copyProducedFile(producedPath, tmpDir, outputPath);
        return { outputPath, engine: 'libreoffice' };
    }

    if (targetFormat === 'pdf' && ['xlsx', 'xls'].includes(srcExt)) {
        if (isExcelAvailable()) {
            await excelToPdfCom(filePath, outputPath);
            return { outputPath, engine: 'excel' };
        }
        const { producedPath, tmpDir } = await sofficeConvert(filePath, 'pdf');
        await copyProducedFile(producedPath, tmpDir, outputPath);
        return { outputPath, engine: 'libreoffice' };
    }

    // PowerPoint -> PDF
    if (targetFormat === 'pdf' && ['pptx', 'ppt'].includes(srcExt)) {
        if (isPowerPointAvailable()) {
            await powerPointToPdfCom(filePath, outputPath);
            return { outputPath, engine: 'powerpoint' };
        }
        const { producedPath, tmpDir } = await sofficeConvert(filePath, 'pdf');
        await copyProducedFile(producedPath, tmpDir, outputPath);
        return { outputPath, engine: 'libreoffice' };
    }

    if (targetFormat === 'docx' && srcExt === 'pdf') {
        if (isWordAvailable()) {
            await pdfToWordCom(filePath, outputPath);
            return { outputPath, engine: 'word' };
        }
        const { producedPath, tmpDir } = await sofficeConvert(filePath, 'docx');
        await copyProducedFile(producedPath, tmpDir, outputPath);
        return { outputPath, engine: 'libreoffice' };
    }

    // PDF -> Excel, PDF -> HTML : uniquement via LibreOffice.
    const { producedPath, tmpDir } = await sofficeConvert(filePath, targetFormat);
    await copyProducedFile(producedPath, tmpDir, outputPath);
    return { outputPath, engine: 'libreoffice' };
}

// ------------------------------------------------------------
// IPC — Fenêtre / système de fichiers
// ------------------------------------------------------------
ipcMain.handle('shell:show-in-folder', (_e, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('shell:open-path', (_e, filePath) => shell.openPath(filePath));

// ------------------------------------------------------------
// IPC — Outils / sélecteurs
// ------------------------------------------------------------
ipcMain.handle('pdf:check-tools', (event, { forceRefresh = false } = {}) => {
    if (forceRefresh) {
        cachedSofficePath = undefined;
        cachedGsPath = undefined;
        cachedWordAvailable = undefined;
        cachedExcelAvailable = undefined;
        cachedPowerPointAvailable = undefined;
    }
    return {
        pdfLib: !!pdfLib,
        sharp: !!sharpLib,
        pdfjs: !!getPdfjsExtract(),
        ghostscript: !!locateGhostscript(),
        libreoffice: !!locateSoffice(),
        word: isWordAvailable(),
        excel: isExcelAvailable(),
        powerpoint: isPowerPointAvailable(),
    };
});

ipcMain.handle('pdf:choose-files', async (event, { multiple = false, extensions = ['pdf'], title } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
        title,
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: 'Fichiers pris en charge', extensions }, { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths;
});

ipcMain.handle('pdf:choose-image', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
});

ipcMain.handle('pdf:choose-save-path', async (event, { defaultName = 'document.pdf', extensions = ['pdf'] } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('downloads'), defaultName),
        filters: [{ name: 'Fichier', extensions }],
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
});

ipcMain.handle('pdf:choose-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
});

ipcMain.handle('pdf:get-info', async (event, filePath, opts = {}) => {
    try {
        const doc = await loadPdf(filePath, opts?.password);
        const pages = doc.getPages().map((p, i) => ({ index: i, width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle }));
        return { ok: true, pageCount: doc.getPageCount(), pages, fileSize: fs.statSync(filePath).size };
    } catch (err) {
        const needsPassword = /password|encrypt/i.test(err.message || '');
        return { ok: false, error: needsPassword ? 'Ce PDF est protégé par mot de passe.' : err.message, needsPassword };
    }
});

ipcMain.handle('pdf:read-file-base64', async (event, filePath) => {
    try {
        return { ok: true, base64: fs.readFileSync(filePath).toString('base64') };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// ------------------------------------------------------------
// IPC — Organiser / Fusionner / Compresser / Scinder
// ------------------------------------------------------------
ipcMain.handle('pdf:organize', async (event, payload) => {
    try { return { ok: true, ...(await pdfOrganize(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('pdf:merge', async (event, payload) => {
    try { return { ok: true, ...(await pdfMerge(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('pdf:split', async (event, payload) => {
    try { return { ok: true, ...(await pdfSplit(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('pdf:compress', async (event, payload) => {
    try { return { ok: true, ...(await pdfCompress(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});

// ------------------------------------------------------------
// IPC — Modifier
// ------------------------------------------------------------
ipcMain.handle('pdf:add-watermark', async (event, payload) => {
    try { return { ok: true, ...(await pdfAddWatermark(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('pdf:insert-blank-pages', async (event, payload) => {
    try { return { ok: true, ...(await pdfInsertBlankPages(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});

// ------------------------------------------------------------
// IPC — Protéger
// ------------------------------------------------------------
ipcMain.handle('pdf:protect', async (event, payload) => {
    try { return { ok: true, ...(await pdfProtect(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('pdf:unlock', async (event, payload) => {
    try { return { ok: true, ...(await pdfUnlock(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});

// ------------------------------------------------------------
// IPC — Traduire
// ------------------------------------------------------------
ipcMain.handle('pdf:extract-text', async (event, payload) => {
    try { return { ok: true, ...(await pdfExtractText(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('pdf:translate', async (event, payload) => {
    try { return { ok: true, ...(await pdfTranslate(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});

// ------------------------------------------------------------
// IPC — Créateur PDF
// ------------------------------------------------------------
ipcMain.handle('pdf:create', async (event, payload) => {
    try { return { ok: true, ...(await pdfCreate(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});

// ------------------------------------------------------------
// IPC — Convertir
// ------------------------------------------------------------
ipcMain.handle('pdf:convert', async (event, payload) => {
    try { return { ok: true, ...(await pdfConvertFile(payload)) }; } catch (err) { return { ok: false, error: err.message }; }
});
