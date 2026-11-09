# Cadence – panneau de montage rapide pour Premiere Pro 2023 (nom provisoire)

Extension **CEP** originale pour **Adobe Premiere Pro 2023 (23.x) sous Windows**. Elle propose Beat Cut, Voice Cut, l’amélioration de la voix, l’accélération, l’import de médias et l’effacement des marqueurs. Tout le traitement audio se fait localement, hors connexion.

> **Statut des tests** : le code a été testé dans Node.js et dans Chrome headless avec un Premiere **simulé**. **Il n’a pas été lancé dans Premiere Pro.** Faites d’abord la check-list du § 9 sur un projet de test.

---

## 1. Compatibilité vérifiée (sources officielles Adobe)

| Point | Constat | Source |
|---|---|---|
| Type d’extension | Premiere 23.x ne prend pas UXP en charge. Les plug-ins UXP pour Premiere commencent à la version **25.6**. Il faut donc une extension **CEP** (HTML/JS + ExtendScript). | developer.adobe.com/premiere-pro/uxp/introduction (« Premiere (version 25.6) »). Le ReadMe d’Adobe-CEP/Samples/PProPanel de novembre 2025 confirme que CEP reste pris en charge. |
| Version CEP | Le cookbook CEP 11 indique Premiere **15.4 → CEP 11**. Le cookbook CEP 12 indique Premiere **25.0 → CEP 12**. Premiere 23.x se situe entre les deux : **CEP 11**. Adobe ne publie pas de ligne « 23.x » explicite. C’est donc une **déduction encadrée par deux documents officiels**. Le panneau affiche la version CEP réellement détectée (§ 8). | Adobe-CEP/CEP-Resources : *CEP 11.1 HTML Extension Cookbook* et *CEP 12 HTML Extension Cookbook*. |
| Moteur CEP 11 | Chromium 88, Node.js 15.9.0. | Cookbook CEP 11.1 |
| Manifeste | `ExtensionManifest Version="7.0"` : Adobe indique que le schéma v7 reste valable après CEP 7. Hôte `PPRO` dans la plage `[23.0,23.99]`, `RequiredRuntime CSXS 11.0`, `--enable-nodejs` et `--mixed-context`. Le manifeste est **validé** contre `ExtensionManifest_v_7_0.xsd` d’Adobe. | Cookbook CEP 11.1, CEP-Resources/CEP_7.x |
| Extension non signée | Créer `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`, valeur **chaîne** `PlayerDebugMode` = `1`. | Cookbook CEP 11.1 |
| API Premiere | API ExtendScript officielle. Signatures vérifiées dans la référence ExtendScript (ppro-scripting.docsforadobe.dev) et dans l’exemple officiel `PProPanel/jsx/PPRO/Premiere.jsx`. | — |

## 2. Arborescence

```
cadence-premiere/
├── extension/                       ← dossier à installer (copié sous le nom fr.cadence.montage)
│   ├── .debug                       débogage à distance : http://localhost:8088
│   ├── CSXS/manifest.xml            manifeste CEP 11 / Premiere 23.x
│   ├── index.html                   interface (français)
│   ├── css/style.css                thème sombre compact, redimensionnable
│   ├── js/dsp.js                    moteur audio : WAV, silences, temps forts, voix, WSOLA
│   ├── js/audio.js                  lecture des médias (WAV natif / Web Audio / FFmpeg), rendus, pré-écoute
│   ├── js/bridge.js                 communication avec ExtendScript (+ hôte simulé dans un navigateur)
│   ├── js/waveform.js               forme d’onde et propositions superposées
│   ├── js/main.js                   logique du panneau et confirmations
│   └── jsx/host.jsx                 script hôte ExtendScript (ES3) pour Premiere
├── scripts/
│   ├── installer.cmd / installer-windows.ps1
│   ├── desinstaller.cmd / desinstaller-windows.ps1
│   ├── activer-extensions-non-signees-CSXS11.reg
│   ├── desactiver-extensions-non-signees-CSXS11.reg
│   └── validate-manifest.js         validation XSD du manifeste
├── tests/                           tests Node + test d’interface Chrome headless
├── package.json
└── README.md
```

## 3. Installation sous Windows

### Méthode automatique
1. Fermez Premiere Pro.
2. Double-cliquez sur `scripts\installer.cmd`. Le script :
   - copie `extension\` vers **`%APPDATA%\Adobe\CEP\extensions\fr.cadence.montage\`** ;
   - active `PlayerDebugMode` pour CSXS.11 (voir § 4).
3. Redémarrez Premiere Pro.

### Méthode manuelle
1. Copiez le **contenu** du dossier `extension` dans :
   `C:\Users\<VOTRE_NOM>\AppData\Roaming\Adobe\CEP\extensions\fr.cadence.montage\`
   Le fichier `manifest.xml` doit se trouver exactement ici :
   `…\extensions\fr.cadence.montage\CSXS\manifest.xml`, et non dans un sous-dossier supplémentaire.
   Dans l’explorateur, `%APPDATA%\Adobe\CEP\extensions` mène au même endroit. Créez les dossiers `CEP\extensions` s’ils n’existent pas.
2. Autre emplacement possible, pour tous les utilisateurs (droits administrateur) : `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`.

## 4. Réglage développeur obligatoire (extension non signée)

Premiere refuse les extensions non signées tant que ce réglage n’est pas fait. Utilisez **une** des méthodes suivantes :

- double-cliquer sur `scripts\activer-extensions-non-signees-CSXS11.reg`, puis accepter ;
- ou, dans une invite de commandes :
  ```
  reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
  ```
- ou, dans `regedit`, ouvrir `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` (créer la clé si besoin) et ajouter une **Valeur chaîne** `PlayerDebugMode` = `1`.

Ce réglage autorise **toutes** les extensions CEP 11 non signées pour votre compte Windows. Pour une diffusion, signez plutôt l’extension en ZXP avec ZXPSignCmd d’Adobe.

## 5. Ouvrir le panneau

1. Quittez complètement Premiere Pro, puis relancez-le. Le réglage et le dossier ne sont lus qu’au démarrage.
2. Menu **Fenêtre > Extensions > Cadence – Montage rapide**. En interface anglaise : *Window > Extensions*.
3. Ancrez le panneau où vous voulez. Il se redimensionne et passe de 3 à 2 colonnes quand il est étroit.

## 6. Utilisation

Commencez par **sélectionner un clip** dans la séquence active. Ensuite, ouvrez BEAT CUT ou VOICE CUT et cliquez sur **Analyser** : le clip sélectionné est chargé automatiquement. Vous pouvez aussi cliquer d’abord sur **Charger le clip sélectionné**. Le panneau lit l’audio de la portion utilisée (du point d’entrée au point de sortie), puis la forme d’onde affiche les propositions. **Aucune analyse ne modifie la séquence.** Chaque action qui touche au projet ouvre d’abord une **demande de confirmation** qui décrit ce qui va changer.

| Bouton | Ce qu’il fait | Ce qui est modifié (après confirmation) |
|---|---|---|
| **BEAT CUT** | **Montage multicam au rythme**, comme dans les vidéos de démonstration. Préparation : rushes empilés sur V1, V2, V3…, musique sur une piste audio, rushes sélectionnés. Le panneau trouve la musique tout seul sous les rushes (le son des rushes est ignoré), estime le BPM et propose une cadence **RAPIDE** (1 temps), **NORMAL** (2 temps) ou **LENT** (4 temps), avec un ordre des angles cyclique ou aléatoire. L’aperçu sur la forme d’onde montre les coupes et une bande de couleur indiquant l’angle visible. Pré-écoute avec clics. Les réglages avancés proposent la grille de tempo ou les attaques, la sensibilité et l’écart minimal. | **Copie de sauvegarde** de la séquence, puis coupe des pistes vidéo des rushes aux temps choisis. Dans chaque segment, les morceaux des pistes **au-dessus** de l’angle choisi sont retirés : un seul angle reste visible. Un marqueur « Beat » est ajouté à chaque coupe (option). La musique et le son des rushes ne sont pas coupés. La coupe passe par la commande QE `razor`, non documentée : chaque coupe est **vérifiée**, et si une seule manque, **rien n’est retiré**. Le bouton **Marqueurs seulement** ne pose que des marqueurs (API officielle) ; il fonctionne aussi avec un simple clip de musique sélectionné. |
| **VOICE CUT** | Détecte les silences d’après un seuil en dBFS (bouton « Suggérer »), une durée minimale et une marge conservée. Liste des passages, exclusion au clic, pré-écoute « sans les silences ». | **Marqueurs « Silence »** avec durée, **ou** une **nouvelle séquence** « … – sans silences » construite à partir de sous-éléments (API officielle). La séquence d’origine n’est pas touchée. |
| **AMÉLIORER LA VOIX** | Chaîne réglable : passe-haut 80 Hz, −2 dB à 300 Hz, +3 dB à 3 kHz, expandeur (−12 dB max entre les phrases), compresseur 3:1, normalisation crête à −1 dBFS. Écoute avant/après. | Écrit un **nouveau WAV 24 bits** dans `Cadence_Rendus\` à côté du `.prproj`, l’importe dans le chutier « Cadence – rendus » et, en option, le place sur une piste audio libre sous le clip. Le média d’origine reste intact. |
| **ACCÉLÉRER** | **A** (expérimental) : vitesse des clips sélectionnés via le DOM QE avec « conserver la hauteur » demandé. La vitesse est **relue et vérifiée**. **B** (fiable) : version audio étirée par WSOLA, hauteur conservée, avec pré-écoute. | A : vitesse du clip (Ctrl+Z pour annuler). B : nouveau WAV importé (et placé en option). |
| **IMPORTER** | Sélecteur de fichiers Windows, puis liste et confirmation. Les extensions non reconnues et les fichiers absents sont signalés. | Les médias sont ajoutés au chutier courant du projet, référencés et non copiés. |
| **EFFACER LES MARQUEURS** | Compte les marqueurs de la séquence active. | Après confirmation, supprime **uniquement** les marqueurs de **la séquence active**. Les marqueurs des clips et des autres séquences restent. |

### Formats lus (hors connexion)
- **WAV** : décodeur intégré au panneau.
- **MP3, M4A, AAC, OGG** et **vidéos MP4/MOV avec audio AAC** (jusqu’à 1 Go) : décodeur intégré au moteur CEP. La documentation Adobe indique que CEP lit le MP4 H.264/AAC. **FFmpeg n’est pas nécessaire** pour ces fichiers.
- **Autres cas** (MXF, audio PCM dans un MOV, fichiers de plus de 1 Go…) : le panneau utilise **FFmpeg installé localement**, s’il est présent. Indiquez le chemin de `ffmpeg.exe` dans **Réglages et diagnostic** s’il n’est pas dans le PATH. Sans FFmpeg, exportez l’audio en WAV.

Aucune fonction n’utilise Internet.

## 7. Ce qui n’est pas faisable avec l’API de Premiere 23.x, et les alternatives

| Besoin | Limite | Alternative retenue |
|---|---|---|
| Couper (rasoir) une piste | Aucune méthode officielle en ExtendScript 23.x. Le retrait d’un morceau, lui, est officiel (`TrackItem.remove`). | Beat Cut coupe via le DOM QE (`track.razor(timecode)`) après une copie de sauvegarde ; il vérifie chaque coupe avec l’API officielle et ne retire rien en cas d’échec. Repli : « Marqueurs seulement », puis Ctrl+K dans Premiere. Voice Cut reconstruit une séquence à partir de sous-éléments (officiel). |
| Supprimer les silences avec ondulation sur toutes les pistes | Pas d’API officielle d’édition par ondulation multipiste. | Nouvelle séquence sans silences (clip analysé seulement). |
| Changer la vitesse d’un clip | L’API officielle ne propose que `getSpeed()` ; `setSpeed` n’existe que dans le DOM QE, non documenté. | QE + vérification via `getSpeed()`, ou rendu audio WSOLA. Repli manuel : **Clip > Vitesse/Durée (Ctrl+R)**. |
| Appliquer des effets audio Premiere (DeNoise, Améliorer la parole…) | Pas d’ajout d’effet dans l’API officielle 23.x. Les noms QE dépendent de la langue de l’interface. | Traitement local rendu dans un nouveau fichier. Pour un débruitage plus poussé : panneau *Son essentiel* de Premiere. |
| Garantir la conservation de la hauteur en QE | Ce n’est pas lisible par script. | À vérifier dans Ctrl+R ; l’option B la garantit pour l’audio. |

## 8. Dépannage

- **Le panneau n’apparaît pas dans Fenêtre > Extensions**
  1. Vérifiez le chemin : `…\CEP\extensions\fr.cadence.montage\CSXS\manifest.xml`.
  2. Vérifiez `PlayerDebugMode` : clé **CSXS.11**, type **chaîne** (REG_SZ), valeur `1`.
  3. Redémarrez complètement Premiere.
  4. Vérifiez la version dans **Aide > À propos de Premiere Pro** : le manifeste n’accepte que **23.0 à 23.x**. Pour une autre version, adaptez `<Host Name="PPRO" Version="…"/>` à vos risques. À partir de 25.0, la clé devient **CSXS.12**.
- **Panneau vide ou gris** : ouvrez Chrome sur `http://localhost:8088` pendant que le panneau est ouvert (fichier `.debug`) et consultez la console.
- **« Script hôte : ERREUR » ou « EvalScript error »** dans *Réglages et diagnostic* : réinstallez, puis vérifiez que `jsx\host.jsx` est présent. Journaux : `%TEMP%\CEP11-PPRO.log`. Pour plus de détails, ajoutez une valeur chaîne `LogLevel` = `6` dans la clé CSXS.11 et redémarrez.
- **Vérifier la version CEP réelle** : *Réglages et diagnostic* affiche « PPRO 23.x · CEP 11.x ».
- **« Aucune séquence active »** : cliquez dans le panneau Montage pour donner le focus à la séquence.
- **« Aucun clip sélectionné »** : sélectionnez un clip dans la timeline, pas dans le panneau Projet.
- **« Le décodeur intégré ne lit pas l’audio… FFmpeg est introuvable »** : le codec audio du fichier n’est pas lu par CEP. Installez FFmpeg (§ 6) ou exportez l’audio en WAV.
- **« La séquence active a changé »** : le panneau refuse d’agir sur une autre séquence que celle du clip analysé. Rouvrez-la ou rechargez le clip.
- **Une fonction expérimentale (QE) échoue** : le panneau l’indique, la vitesse relue faisant foi. Utilisez l’alternative proposée.

## 9. Validation

Dans le dossier `cadence-premiere` (Node.js 18 ou plus) :

```
npm install                 # outils de test seulement (acorn, xmllint-wasm, playwright-core)
npm test                    # 36 tests Node : DSP, Beat Cut multicam, script hôte sur DOM simulé, manifeste, chargeur audio
npm run validate:manifest   # validation XSD Adobe (télécharge le schéma une fois)
npm run test:ui             # interface dans Chrome headless (CHROME_PATH si Chrome n’est pas trouvé)
```

**Check-list à faire dans Premiere Pro 23.x** (projet de test, enregistré au préalable) :
1. Le panneau apparaît dans Fenêtre > Extensions. Le diagnostic affiche PPRO 23.x, CEP 11 et le script hôte 0.2.0.
2. Chargez un clip WAV, puis un clip MP4 **sans FFmpeg** : l’état doit indiquer « décodeur intégré ». Comparez la forme d’onde et la durée affichée avec la timeline.
3. Beat Cut : empilez 3 rushes sur V1–V3 avec une musique sur A1, sélectionnez les rushes, choisissez NORMAL, puis lancez. Vérifiez qu’une copie « … Copie » de la séquence apparaît, que les coupes tombent sur les temps à la lecture, et que les angles alternent. Faites un essai avec une séquence en 25 i/s et une autre en 29,97 i/s (format du timecode envoyé à la commande de coupe).
4. Marquez les silences, puis créez la séquence sans silences. Contrôlez les raccords, en particulier sur un média dont le timecode ne commence pas à 0.
5. Améliorer la voix : le fichier est écrit dans `Cadence_Rendus`, importé et placé sur une piste libre, aligné avec le clip.
6. Accélérer A : la vitesse est relue et la hauteur doit être conservée (Ctrl+R). Accélérer B : fichier importé.
7. Importer des fichiers mixtes, puis effacer les marqueurs : seuls ceux de la séquence active disparaissent.

## 10. Désinstallation

1. Fermez Premiere Pro.
2. Double-cliquez sur `scripts\desinstaller.cmd`, ou supprimez `%APPDATA%\Adobe\CEP\extensions\fr.cadence.montage`.
3. Facultatif : retirez le mode développeur avec `scripts\desactiver-extensions-non-signees-CSXS11.reg`, ou `desinstaller.cmd -DesactiverModeDeveloppeur`. Cela désactive **toutes** les extensions CEP 11 non signées.
4. Les fichiers déjà rendus (`Cadence_Rendus`) et les éléments importés dans vos projets sont conservés.

## 11. Limites connues

- **Non testé dans Premiere Pro.** Points les plus incertains :
  - le DOM QE (rasoir, vitesse) ;
  - l’origine des temps de `createSubClip` pour les médias à timecode non nul ;
  - le placement automatique sur une piste audio.
- Les analyses reposent sur des règles de traitement du signal, pas sur de l’IA. Les résultats sont des **propositions** à écouter et ne sont pas de qualité « professionnelle » garantie. Sur une musique sans attaques nettes, préférez la grille de tempo et ajustez la sensibilité.
- Voice Cut utilise un seuil d’énergie : la respiration ou un bruit de fond fort peuvent être pris pour de la parole, et un chuchotement pour un silence.
- La séquence sans silences ne reprend que le clip analysé, et seulement si sa vitesse est 100 %.
- La longueur analysée est limitée à 15 minutes par clip. Le calcul se fait dans le panneau : un clip long peut le figer quelques secondes.
- Marqueurs : leur suppression n’est pas garantie annulable par Ctrl+Z ; enregistrez le projet avant.
