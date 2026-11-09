'use strict';
/*
 * Test de fumée de l'interface dans Chrome headless (mode navigateur, Premiere SIMULÉ).
 * Vérifie que chaque bouton fonctionne, que rien n'est « modifié » sans confirmation et que les erreurs sont lisibles.
 * Ne prouve RIEN sur le comportement dans Premiere Pro.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright-core');
const D = require('../extension/js/dsp.js');

const OUT = path.join(__dirname, 'output');
const CHROME = process.env.CHROME_PATH || ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));

function makeTestWav(file) {
  const sr = 44100, secs = 12, x = new Float32Array(sr * secs);
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  const speech = [[0.3, 2.2], [3.2, 5.0], [5.4, 7.5], [9.0, 11.0]];
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    let v = 0.002 * rnd();
    if (speech.some(([a, b]) => t >= a && t < b)) v += 0.25 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) + 0.03 * rnd();
    const beat = (t - 0.1) % 0.5;
    if (t > 0.1 && beat < 0.05) v += 0.5 * Math.exp(-beat / 0.01) * Math.sin(2 * Math.PI * 70 * beat);
    x[i] = v;
  }
  fs.writeFileSync(file, Buffer.from(D.encodeWav([x, x], sr, 16)));
}

(async () => {
  if (!CHROME) { console.error('Chrome introuvable : définissez CHROME_PATH.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const wav = path.join(OUT, 'test_voix_musique.wav');
  makeTestWav(wav);

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 760 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'extension', 'index.html'));

  const status = () => page.textContent('#status');
  const waitStatus = async (re) => { await page.waitForFunction(r => new RegExp(r).test(document.querySelector('#status').textContent), re.source, { timeout: 15000 }); return status(); };
  const waitModal = (re) => page.waitForFunction(r => !document.querySelector('#modal').hidden && new RegExp(r).test(document.querySelector('#modalTitle').textContent), re.source, { timeout: 15000 });
  const markers = () => page.evaluate(() => window.CadenceBridge.mock.sequence.markers.length);
  const step = (name) => console.log('✔ ' + name);

  assert.match(await page.textContent('#envBadge'), /navigateur/);
  for (const label of ['BEAT CUT', 'VOICE CUT', 'AMÉLIORER LA VOIX', 'IMPORTER', 'ACCÉLÉRER', 'EFFACER LES MARQUEURS']) {
    assert.ok(await page.isVisible(`.tool:text-is("${label}")`), label);
  }
  step('6 boutons visibles, badge « mode navigateur »');

  await page.click('text=BEAT CUT');
  await page.click('#beatAnalyze');
  assert.match(await waitStatus(/Ouvrez d’abord/), /Ouvrez d’abord un fichier audio/);
  step('Erreur lisible sans source');

  await page.setInputFiles('#fileInput', wav);
  assert.match(await waitStatus(/Source chargée/), /WAV/);
  await page.screenshot({ path: path.join(OUT, 'ui-1-source.png') });
  step('Fichier WAV chargé et forme d’onde affichée');

  // Le signal mélange voix et clics : la grille de tempo est le mode adapté (précision DSP testée à part).
  await page.selectOption('#beatMode', 'grid');
  await page.click('#beatAnalyze');
  await waitStatus(/Analyse terminée/);
  const beatTxt = await page.textContent('#beatResult');
  assert.match(beatTxt, /temps proposés/);
  const nBeats = Number(/^(\d+)/.exec(beatTxt)[1]);
  assert.ok(nBeats >= 18 && nBeats <= 26, 'temps détectés : ' + nBeats);
  await page.screenshot({ path: path.join(OUT, 'ui-2-beatcut.png') });
  await page.click('#beatMarkers');
  await waitModal(/Ajouter/);
  await page.click('#modalCancel');
  await waitStatus(/annulé/);
  assert.equal(await markers(), 0, 'aucun marqueur sans confirmation');
  await page.click('#beatMarkers');
  await waitModal(/Ajouter/);
  await page.click('#modalOk');
  await waitStatus(/marqueurs ajoutés/);
  assert.equal(await markers(), nBeats);
  step(`Beat Cut : ${beatTxt.split('\n')[0]} ; annulation respectée ; marqueurs après confirmation`);

  await page.click('#beatRazor');
  await waitModal(/Couper toutes les pistes/);
  assert.match(await page.textContent('#modalBody'), /copie de sauvegarde/);
  await page.click('#modalCancel');
  await waitStatus(/annulée/);
  step('Coupe expérimentale : sauvegarde annoncée, annulation respectée');

  await page.click('text=VOICE CUT');
  await page.click('#voiceSuggest');
  await waitStatus(/Seuil suggéré/);
  await page.click('#voiceAnalyze');
  await waitStatus(/passages proposés/);
  const nReg = await page.$$eval('#voiceList li', l => l.length);
  assert.ok(nReg >= 2 && nReg <= 4, 'silences : ' + nReg);
  await page.click('#voiceList li:first-child input');
  assert.match(await page.textContent('#voiceResult'), new RegExp(`${nReg - 1} / ${nReg} passages`));
  await page.screenshot({ path: path.join(OUT, 'ui-3-voicecut.png') });
  await page.click('#voicePreview');
  await page.click('#btnStop');
  await page.click('#voiceMarkers');
  await waitModal(/Marquer/);
  await page.click('#modalOk');
  await waitStatus(/« Silence » ajoutés/);
  await page.click('#voiceSequence');
  await waitModal(/nouvelle séquence/);
  assert.match(await page.textContent('#modalBody'), /pas modifiée/);
  await page.click('#modalOk');
  await waitStatus(/sans silences » créée/);
  const lastCall = await page.evaluate(() => window.CadenceBridge.mock.log.slice(-1)[0]);
  assert.equal(lastCall.fn, 'createCutSequence');
  // nReg − 1 silences retenus => entre nReg − 1 et nReg segments conservés
  const nSeg = lastCall.args.segments.length;
  assert.ok(nSeg >= nReg - 1 && nSeg <= nReg, `segments : ${nSeg}`);
  step(`Voice Cut : ${nReg} silences, exclusion manuelle, pré-écoute, marqueurs, nouvelle séquence (${lastCall.args.segments.length} segments)`);

  await page.click('text=AMÉLIORER LA VOIX');
  await page.click('#enhanceRun');
  await waitStatus(/Aperçu prêt/);
  assert.match(await page.textContent('#enhanceResult'), /Appliqué : Filtre passe-haut/);
  await page.screenshot({ path: path.join(OUT, 'ui-4-voix.png') });
  const dl = page.waitForEvent('download');
  await page.click('#enhanceSave');
  await waitModal(/Enregistrer/);
  await page.click('#modalOk');
  const download = await dl;
  const saved = path.join(OUT, download.suggestedFilename());
  await download.saveAs(saved);
  const w = D.parseWav(fs.readFileSync(saved));
  assert.ok(Math.abs(w.channels[0].length / w.sampleRate - 12) < 0.01);
  await waitStatus(/Fichier enregistré/);
  step('Améliorer la voix : aperçu, WAV 24 bits produit (' + download.suggestedFilename() + ')');

  await page.click('text=ACCÉLÉRER');
  await page.fill('#speedVal', '1.5');
  await page.dispatchEvent('#speedVal', 'input');
  await page.click('#speedRender');
  await waitStatus(/Version accélérée prête/);
  assert.match(await page.textContent('#speedResult'), /0:12,00 → 0:08,00/);
  await page.click('#speedApply');
  await waitModal(/Changer la vitesse/);
  await page.click('#modalOk');
  await waitStatus(/vitesse relue/);
  await page.screenshot({ path: path.join(OUT, 'ui-5-accelerer.png') });
  step('Accélérer : version ×1,5 (12 s → 8 s) et appel Premiere simulé');

  await page.click('text=IMPORTER');
  await waitModal(/Importer/);
  assert.match(await page.textContent('#modalTitle'), /Importer 3 fichier/);
  await page.click('#modalOk');
  const imp = await waitStatus(/importé/);
  assert.match(imp, /notes\.txt – extension \.txt non prise en charge/);
  step('Importer : sélection, confirmation, fichier incompatible signalé');

  const before = await markers();
  await page.click('text=EFFACER LES MARQUEURS');
  await waitModal(/Effacer/);
  assert.match(await page.textContent('#modalTitle'), new RegExp(`Effacer ${before} marqueur`));
  await page.screenshot({ path: path.join(OUT, 'ui-6-confirmation.png') });
  await page.click('#modalCancel');
  await waitStatus(/aucun marqueur effacé/);
  assert.equal(await markers(), before);
  await page.click('text=EFFACER LES MARQUEURS');
  await waitModal(/Effacer/);
  await page.click('#modalOk');
  await waitStatus(new RegExp(`${before} marqueur\\(s\\) effacé`));
  assert.equal(await markers(), 0);
  await page.click('text=EFFACER LES MARQUEURS');
  await waitStatus(/aucun marqueur/);
  step(`Effacer les marqueurs : ${before} → annulation respectée → 0 après confirmation`);

  await page.setViewportSize({ width: 250, height: 600 });
  await page.screenshot({ path: path.join(OUT, 'ui-7-etroit.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow, false, 'pas de débordement horizontal à 250 px');
  step('Panneau étroit (250 px) sans débordement horizontal');

  await browser.close();
  assert.deepEqual(errors, [], 'erreurs JavaScript : ' + errors.join(' | '));
  console.log('\nTest UI réussi (navigateur, Premiere simulé). Captures : ' + OUT);
})().catch(e => { console.error('✖ ' + (e.stack || e)); process.exit(1); });
