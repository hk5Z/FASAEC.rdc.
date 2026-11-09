'use strict';
/*
 * Exécute jsx/host.jsx dans Node avec un DOM Premiere SIMULÉ (signatures de la documentation ExtendScript).
 * Ce test vérifie la logique du script hôte, pas le comportement réel de Premiere Pro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const HOST = path.join(__dirname, '..', 'extension', 'jsx', 'host.jsx');
const SRC = fs.readFileSync(HOST, 'utf8');

class Time {
  constructor(s = 0) { this.seconds = s; }
  get ticks() { return String(Math.round(this.seconds * 254016000000)); }
  set ticks(v) { this.seconds = Number(v) / 254016000000; }
  getFormatted(frameRate, fmt) {
    const fps = Math.round(1 / frameRate.seconds), f = Math.round(this.seconds * fps);
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(f / fps / 3600))}:${p(Math.floor(f / fps / 60) % 60)}:${p(Math.floor(f / fps) % 60)}:${p(f % fps)}|${fmt}`;
  }
}
function collection(arr, countKey = 'numItems') {
  const c = { get [countKey]() { return arr.length; } };
  return new Proxy(c, { get: (t, k) => (k in t ? t[k] : (/^\d+$/.test(String(k)) ? arr[Number(k)] : undefined)) });
}
function markerCollection() {
  const list = [];
  return {
    list,
    get numMarkers() { return list.length; },
    createMarker(t) { const m = { start: new Time(t), name: '', comments: '', end: t }; list.push(m); list.sort((a, b) => a.start.seconds - b.start.seconds); return m; },
    getFirstMarker() { return list[0]; },
    deleteMarker(m) { list.splice(list.indexOf(m), 1); }
  };
}

function makeWorld(opts = {}) {
  let nodeSeq = 100;
  const calls = [];
  const media = { nodeId: 'pi-1', name: 'interview.mp4', type: 1, getMediaPath: () => 'C:\\media\\interview.mp4',
    createSubClip(name, s, e, hard, a, v) {
      // Comme l'exemple officiel PProPanel : des objets Time sont attendus.
      if (!(s instanceof Time) || !(e instanceof Time)) throw new Error('createSubClip : objets Time attendus');
      calls.push(['createSubClip', name, s.ticks, e.ticks]); return { nodeId: 'sub-' + (nodeSeq++), name, type: 1, moveBin(b) { calls.push(['moveBin', name, b.name]); } }; } };
  const rootChildren = [media];
  const root = { name: 'root', type: 3, nodeId: 'root', children: collection(rootChildren),
    createBin(name) { const arr = []; rootChildren.push({ name, type: 2, nodeId: 'bin-' + (nodeSeq++), children: collection(arr), _arr: arr }); } };
  const mk = (name, mediaType, start, end, inP, speed = 1) => {
    let sp = speed;
    return { name, mediaType, nodeId: 'ti-' + (nodeSeq++), start: new Time(start), end: new Time(end), inPoint: new Time(inP), outPoint: new Time(inP + (end - start) * sp),
      projectItem: media, getSpeed: () => sp, _setSpeed(v) { sp = v; }, isSpeedReversed: () => 0 };
  };
  const v1 = [mk('interview.mp4', 'Video', 10, 20, 2)], a1 = [mk('interview.mp4', 'Audio', 10, 20, 2)], a2 = [];
  const track = (clips) => ({ clips: collection(clips), overwriteClip(item, t) { calls.push(['overwriteClip', item.name, t]); clips.push(mk(item.name, 'Audio', t, t + 5, 0)); } });
  const sequences = [];
  const seq = {
    name: 'Montage', sequenceID: 'seq-1', markers: markerCollection(),
    videoTracks: collection([track(v1)], 'numTracks'), audioTracks: collection([track(a1), track(a2)], 'numTracks'),
    videoDisplayFormat: 101,
    selection: opts.selection === undefined ? [v1[0], a1[0]] : opts.selection,
    getSelection() { return this.selection; },
    getSettings: () => ({ videoFrameRate: new Time(1 / 25) }),
    clone() { calls.push(['clone']); sequences.push({ name: 'Montage Copie' }); return true; }
  };
  sequences.push(seq);
  const qeItems = { video: [{ type: 'Empty', name: '' }, { type: 'Clip', name: 'interview.mp4', setSpeed(...a) { calls.push(['setSpeed', ...a]); if (opts.speedWorks !== false) v1[0]._setSpeed(a[0]); } }] };
  const qeTrack = kind => ({ razor(tc) { calls.push(['razor', kind, tc]); }, get numItems() { return (qeItems[kind] || []).length; }, getItemAt: i => qeItems[kind][i] });
  const project = opts.noProject ? null : {
    name: 'Projet', path: 'C:\\Projets\\demo.prproj', rootItem: root,
    activeSequence: opts.noSequence ? null : seq,
    sequences: collection(sequences, 'numSequences'),
    getInsertionBin: () => root,
    importFiles(paths, suppress, bin, stills) {
      calls.push(['importFiles', paths, bin.name]);
      paths.forEach(p => {
        const pi = { name: path.win32.basename(p), type: 1, nodeId: 'imp-' + (nodeSeq++), getMediaPath: () => p };
        (bin === root ? rootChildren : bin._arr).push(pi);
      });
      return true;
    },
    createNewSequenceFromClips(name, items, bin) { calls.push(['createNewSequenceFromClips', name, items.length, bin.name]); sequences.push({ name }); return {}; }
  };
  class File {
    constructor(p) { this.fsName = p; }
    get exists() { return fs.existsSync(this.fsName); }
    static openDialog() { return opts.dialog || null; }
  }
  const ctx = vm.createContext({
    app: { version: '23.6.0', build: '1', project, enableQE() { calls.push(['enableQE']); } },
    qe: { project: { getActiveSequence: () => ({ numVideoTracks: 1, numAudioTracks: 2, getVideoTrackAt: () => qeTrack('video'), getAudioTrackAt: () => qeTrack('audio') }) } },
    Time, File, Folder: { fs: 'Windows' }, ProjectItemType: { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 }
  });
  vm.runInContext(SRC, ctx, { filename: 'host.jsx' });
  // Comme le pont CEP : les arguments arrivent sous forme de littéral évalué dans le moteur hôte.
  const call = (fn, args) => JSON.parse(vm.runInContext('cadence.' + fn + '(' + JSON.stringify(args || {}) + ')', ctx));
  return { call, calls, seq, rootChildren, sequences };
}

test('host.jsx : uniquement ASCII (pas de souci d’encodage dans ExtendScript)', () => {
  assert.doesNotMatch(SRC, /[^\x00-\x7f]/);
});

test('host.jsx : syntaxe ECMAScript 3 (ExtendScript)', () => {
  assert.doesNotThrow(() => acorn.parse(SRC, { ecmaVersion: 3, sourceType: 'script' }));
});

test('JSON produit par le script hôte : échappements corrects', () => {
  const ctx = vm.createContext({});
  vm.runInContext(SRC, ctx);
  const tricky = { a: 'guillemet " barre \\ ligne\nretour\r tab\t é \u2028 \u0001', n: [1, 2.5, -3, null, true], o: { x: Infinity } };
  assert.deepEqual(JSON.parse(ctx.cadence.toJson(tricky)), { ...tricky, o: { x: null } });
});

test('Messages clairs : pas de projet, pas de séquence, pas de sélection', () => {
  assert.match(makeWorld({ noProject: true }).call('countMarkers').error, /Aucun projet/);
  assert.match(makeWorld({ noSequence: true }).call('getSelectedClip').error, /Aucune séquence active/);
  assert.match(makeWorld({ selection: [] }).call('getSelectedClip').error, /Aucun clip sélectionné/);
});

test('getSelectedClip : préfère l’élément audio et renvoie les temps', () => {
  const r = makeWorld().call('getSelectedClip');
  assert.equal(r.ok, true);
  assert.equal(r.data.mediaType, 'Audio');
  assert.equal(r.data.mediaPath, 'C:\\media\\interview.mp4');
  assert.deepEqual([r.data.start, r.data.end, r.data.inPoint, r.data.speed], [10, 20, 2, 1]);
  assert.deepEqual(r.data.position, { type: 'audio', trackIndex: 0, clipIndex: 0 });
});

test('Marqueurs : ajout avec durée, refus si la séquence a changé, effacement complet', () => {
  const w = makeWorld();
  const add = w.call('addMarkers', { sequenceId: 'seq-1', markers: [{ time: 12, name: 'Temps' }, { time: 14, end: 15.5, name: 'Silence', comment: 'c' }] });
  assert.equal(add.data.created, 2);
  assert.equal(w.seq.markers.list[1].end, 15.5);
  assert.match(w.call('addMarkers', { sequenceId: 'autre', markers: [{ time: 1 }] }).error, /séquence active a changé/);
  assert.equal(w.call('countMarkers').data.count, 2);
  const clr = w.call('clearMarkers', { sequenceId: 'seq-1' });
  assert.deepEqual([clr.data.deleted, clr.data.remaining], [2, 0]);
});

test('Voice Cut : nouvelle séquence à partir de sous-éléments (ticks exacts)', () => {
  const w = makeWorld();
  const r = w.call('createCutSequence', { projectItemNodeId: 'pi-1', name: 'interview', segments: [{ start: 2, end: 3.5 }, { start: 4, end: 6 }] });
  assert.equal(r.ok, true, r.error);
  const subs = w.calls.filter(c => c[0] === 'createSubClip');
  assert.deepEqual(subs.map(c => [c[2], c[3]]), [['508032000000', '889056000000'], ['1016064000000', '1524096000000']]);
  assert.ok(w.calls.some(c => c[0] === 'createNewSequenceFromClips' && c[1] === 'interview – sans silences' && c[2] === 2));
  assert.equal(r.data.sequenceName, 'interview – sans silences');
  assert.match(w.call('createCutSequence', { projectItemNodeId: 'absent', segments: [{ start: 0, end: 1 }] }).error, /pas été retrouvé/);
});

test('Import : fichiers absents et extensions inconnues refusés avec raison', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-'));
  const ok = path.join(dir, 'a.wav'), bad = path.join(dir, 'notes.txt');
  fs.writeFileSync(ok, 'x'); fs.writeFileSync(bad, 'x');
  const w = makeWorld();
  const r = w.call('importFiles', { paths: [ok, bad, path.join(dir, 'absent.mp4')] });
  assert.equal(r.data.requested, 1);
  assert.equal(r.data.imported, 1);
  assert.deepEqual(r.data.rejected.map(x => x.reason), ['extension .txt non prise en charge par ce panneau', 'fichier introuvable']);
  assert.deepEqual(makeWorld().call('chooseFiles').data, { paths: [] });
});

test('Rendu importé puis placé sur la première piste audio libre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-'));
  const f = path.join(dir, 'voix.wav'); fs.writeFileSync(f, 'x');
  const w = makeWorld();
  const r = w.call('importRendered', { path: f, place: true, time: 10, duration: 10, sequenceId: 'seq-1' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.track, 'A2');
  assert.ok(w.calls.some(c => c[0] === 'overwriteClip' && c[2] === 10));
});

test('Beat Cut (QE) : sauvegarde de la séquence AVANT les coupes, toutes les pistes', () => {
  const w = makeWorld();
  const r = w.call('razorAtTimes', { sequenceId: 'seq-1', times: [11, 12.5] });
  assert.equal(r.ok, true, r.error);
  const names = w.calls.map(c => c[0]);
  assert.ok(names.indexOf('clone') < names.indexOf('razor'));
  assert.equal(w.calls.filter(c => c[0] === 'razor').length, 2 * 3);
  assert.ok(w.calls.some(c => c[0] === 'razor' && c[2] === '00:00:12:13|101'));
});

test('Accélérer (QE) : clip retrouvé malgré les vides, vitesse relue et vérifiée', () => {
  const w = makeWorld({ selection: undefined });
  w.seq.selection = [w.seq.videoTracks[0].clips[0]];
  const r = w.call('setClipSpeed', { sequenceId: 'seq-1', speed: 1.5 });
  assert.equal(r.data.results[0].ok, true);
  const sp = w.calls.find(c => c[0] === 'setSpeed');
  assert.equal(sp[1], 1.5);
  assert.equal(sp[5], true, 'conserver la hauteur demandé');

  const w2 = makeWorld({ speedWorks: false });
  w2.seq.selection = [w2.seq.videoTracks[0].clips[0]];
  const r2 = w2.call('setClipSpeed', { sequenceId: 'seq-1', speed: 1.5 });
  assert.equal(r2.data.results[0].ok, false, 'échec détecté si Premiere ignore la commande');
  assert.match(w2.call('setClipSpeed', { sequenceId: 'seq-1', speed: 50 }).error, /hors limites/);
});
