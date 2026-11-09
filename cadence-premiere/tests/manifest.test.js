'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extension');
const manifest = fs.readFileSync(path.join(EXT, 'CSXS', 'manifest.xml'), 'utf8');

test('Manifeste : Premiere Pro 23.x (PPRO) et runtime CSXS 11', () => {
  assert.match(manifest, /<Host Name="PPRO" Version="\[23\.0,23\.99\]"\/>/);
  assert.match(manifest, /<RequiredRuntime Name="CSXS" Version="11\.0"\/>/);
  assert.match(manifest, /<Type>Panel<\/Type>/);
  assert.match(manifest, /<Menu>Cadence – Montage rapide<\/Menu>/);
});

test('Manifeste : identifiants cohérents et fichiers référencés présents', () => {
  const bundle = /ExtensionBundleId="([^"]+)"/.exec(manifest)[1];
  const ids = [...manifest.matchAll(/<Extension Id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, 1);
  assert.ok(ids[0].startsWith(bundle + '.'));
  for (const tag of ['MainPath', 'ScriptPath']) {
    const p = new RegExp('<' + tag + '>([^<]+)</' + tag + '>').exec(manifest)[1];
    assert.ok(fs.existsSync(path.join(EXT, p)), tag + ' ' + p);
  }
  const debug = fs.readFileSync(path.join(EXT, '.debug'), 'utf8');
  assert.match(debug, new RegExp('Extension Id="' + ids[0].replace(/\./g, '\\.') + '"'));
  assert.match(debug, /Host Name="PPRO" Port="\d+"/);
});

test('Manifeste : Node.js activé (lecture des médias et écriture des rendus)', () => {
  assert.match(manifest, /--enable-nodejs/);
  assert.match(manifest, /--mixed-context/);
});

test('index.html : tous les scripts locaux existent, aucune ressource distante', () => {
  const html = fs.readFileSync(path.join(EXT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  refs.forEach(r => {
    assert.ok(!/^(https?:)?\/\//.test(r), 'ressource distante : ' + r);
    assert.ok(fs.existsSync(path.join(EXT, r)), 'manquant : ' + r);
  });
  for (const label of ['BEAT CUT', 'VOICE CUT', 'AMÉLIORER LA VOIX', 'IMPORTER', 'ACCÉLÉRER', 'EFFACER LES MARQUEURS']) {
    assert.ok(html.includes('>' + label + '<'), label);
  }
});

test('Aucun appel réseau dans le code du panneau (fonctionnement hors connexion)', () => {
  for (const f of fs.readdirSync(path.join(EXT, 'js'))) {
    const src = fs.readFileSync(path.join(EXT, 'js', f), 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|https?:\/\//, f);
  }
});
