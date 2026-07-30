# PDF Manager Pro

Application Electron autonome regroupant toutes les fonctions du module
« Gestionnaire PDF » extrait de Central Browser, avec de nouvelles
fonctionnalités : organisation en grille avec aperçu réel des pages,
protection par mot de passe, traduction de PDF, création de PDF depuis
zéro, et conversion PowerPoint → PDF.

## Fonctionnalités

- **Organiser** — grille de vignettes avec aperçu du contenu réel de
  chaque page (rendu via pdf.js), glisser-déposer pour réordonner,
  rotation, suppression de pages.
- **Fusionner** — combine plusieurs PDF en un seul, dans l'ordre choisi.
- **Compresser** — 3 niveaux, moteur natif (sharp) puis Ghostscript en
  repli si présent sur le poste.
- **Scinder** — par plages, toutes les N pages, ou une page par fichier.
- **Modifier** — filigrane / texte libre, insertion de pages blanches.
- **Protéger** *(nouveau)* — ajoute un mot de passe d'ouverture et/ou
  propriétaire avec permissions détaillées (impression, copie,
  modification, annotations, formulaires, assemblage) ; peut aussi
  retirer une protection existante (mot de passe requis).
- **Traduire** *(nouveau)* — extrait le texte du PDF, le traduit (service
  gratuit MyMemory, sans clé API) et régénère un PDF traduit. Le texte
  est reflowé : la mise en page d'origine (colonnes, images) n'est pas
  conservée — c'est indiqué clairement dans l'interface.
- **Créer** *(nouveau)* — éditeur simple pour composer un PDF depuis
  zéro : plusieurs pages, formats A4/Letter/A5, blocs de texte
  (police, couleur, gras, alignement), images, rectangles de couleur,
  déplacement/redimensionnement à la souris.
- **Convertir** — Word ↔ PDF, Excel ↔ PDF, **PowerPoint → PDF**
  *(nouveau)*, HTML ↔ PDF. Priorité à Microsoft Office (COM, Windows)
  si installé, sinon repli automatique sur LibreOffice.

## Installation

```bash
npm install
npm start
```

> `sharp` est un module natif : `npm install` doit être exécuté sur la
> machine cible (Windows) pour récupérer le bon binaire. Ne copie/colle
> jamais un dossier `node_modules` d'une autre machine/OS.

## Build Windows (.exe)

```bash
npm run dist:win
```

Le programme d'installation NSIS est généré dans `dist/`.

## Outils externes optionnels

Certaines conversions utilisent, quand ils sont disponibles sur le
poste : Microsoft Word / Excel / PowerPoint (automation COM, Windows
uniquement), LibreOffice (repli multiplateforme), Ghostscript (moteur
de compression complémentaire). Le panneau latéral « Outils détectés »
indique ce qui est disponible ; clique sur « Revérifier » après avoir
installé un outil.

Aucun de ces outils n'est nécessaire pour : Organiser, Fusionner,
Compresser (moteur natif), Scinder, Modifier, Protéger, Créer, et
HTML → PDF.

## Structure du projet

```
main.js         Processus principal Electron (toute la logique PDF)
preload.js      Pont contextBridge exposant window.api au renderer
index.html      Interface (barre latérale + panneaux)
app.js          Logique du renderer (module ES)
styles.css      Thème sombre
vendor/pdfjs/   pdf.js (rendu des vignettes de pages, dans le renderer)
vendor/fontawesome/   Icônes (sous-ensemble local, hors ligne)
```

## Notes techniques

- Le chiffrement PDF (fonction **Protéger**) utilise `@cantoo/pdf-lib`,
  un fork de `pdf-lib` qui ajoute le support natif du chiffrement
  (RC4/AES, mots de passe utilisateur/propriétaire, permissions) —
  entièrement en JavaScript, sans dépendance binaire externe.
- L'extraction de texte (fonction **Traduire**) utilise `pdfjs-dist`
  (build « legacy », sans dépendance `canvas`) côté processus principal.
- Le rendu des vignettes (fonction **Organiser**) utilise `pdfjs-dist`
  côté renderer, avec un vrai `<canvas>` (Chromium).
