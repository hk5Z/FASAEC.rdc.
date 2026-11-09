'use strict';
/*
 * Beat Cut multicam : script hôte exécuté sur une timeline SIMULÉE où razor() coupe réellement les clips.
 * Vérifie la logique (plan -> coupes -> retraits), pas le comportement réel de Premiere Pro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const D = require('../extension/js/dsp.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'jsx', 'host.jsx'), 'utf8');
const FPS = 25;

class Time {
  constructor(s = 0) { this.seconds = s; }
  getFormatted(frameRate) {
    const f = Math.round(this.seconds / frameRate.seconds), p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(f / FPS / 3600))}:${p(Math.floor(f / FPS / 60) % 60)}:${p(Math.floor(f / FPS) % 60)}:${p(f % FPS)}`;
  }
}
function tcToSeconds(tc) {
  const [h, m, s, f] = tc.split(':').map(Number);
  return h * 3600 + m * 60 + s + f / FPS;
}
function collection(arr, countKey = 'numItems') {
  return new Proxy({}, { get: (t, k) => (k === countKey ? arr.length : (/^\d+$/.test(String(k)) ? arr[Number(k)] : undefined)) });
}

function makeTimeline({ cloneActivates = true, openWorks = true, razorWorks = true, selectAudio = false, rushTracks = 3, withMusic = true, rushAudio = true, musicVideo = false } = {}) {
  let id = 1;
  const calls = [];
  const pi = name => ({ nodeId: 'pi-' + name, name, getMediaPath: () => 'C:\\media\\' + name });
  function item(name, mediaType, start, end, proj, track) {
    const it = {
      name, mediaType, nodeId: 'ti-' + (id++), projectItem: proj, selected: false,
      start: new Time(start), end: new Time(end), inPoint: new Time(0), outPoint: new Time(end - start),
      getSpeed: () => 1, isSelected() { return this.selected; },
      remove(ripple, align) { calls.push(['remove', name, this.start.seconds, this.end.seconds]); track.splice(track.indexOf(this), 1); return 0; }
    };
    return it;
  }
  const video = [], audio = [[], []];
  for (let t = 0; t < Math.max(3, rushTracks); t++) {
    const arr = [];
    if (t < rushTracks) arr.push(item('MVI_00' + (33 + t) + '.MP4', 'Video', 0, 12, pi('rush' + t), arr));
    video.push(arr);
  }
  if (withMusic) audio[0].push(item(musicVideo ? 'musique_clip.mp4' : 'musique.wav', 'Audio', 0, 12, pi(musicVideo ? 'rush2' : 'musique'), audio[0]));
  if (rushAudio) audio[1].push(item('MVI_0033.MP4', 'Audio', 0, 12, pi('rush0'), audio[1])); // son d'un rush : dernier recours
  video.forEach(arr => arr.forEach(c => { c.selected = true; }));
  if (selectAudio) audio[0][0].selected = true;

  const markers = [];
  const seq = {
    name: 'Clip', sequenceID: 'seq-1',
    videoTracks: collection(video.map(arr => ({ clips: collection(arr) })), 'numTracks'),
    audioTracks: collection(audio.map(arr => ({ clips: collection(arr) })), 'numTracks'),
    videoDisplayFormat: 101,
    getSelection: () => [...video.flat(), ...audio.flat()].filter(c => c.selected),
    getSettings: () => ({ videoFrameRate: new Time(1 / FPS) }),
    markers: { createMarker(t) { const m = { start: t }; markers.push(m); return m; }, get numMarkers() { return markers.length; } },
    clone() {
      // Comportement observé dans Premiere : la copie devient la séquence active.
      const copy = { name: seq.name + ' Copie', sequenceID: 'seq-copy' };
      seqs.push(copy); calls.push(['clone']);
      if (cloneActivates) project.activeSequence = copy;
      return true;
    }
  };
  const qeTrack = t => ({
    razor(tc) {
      calls.push(['razor', t, tc]);
      if (!razorWorks) return;
      const at = tcToSeconds(tc), arr = video[t];
      const c = arr.find(x => x.start.seconds < at && x.end.seconds > at);
      if (!c) return;
      const right = item(c.name, 'Video', at, c.end.seconds, c.projectItem, arr);
      c.end = new Time(at);
      arr.splice(arr.indexOf(c) + 1, 0, right);
    }
  });
  const seqs = [seq];
  const project = {
    activeSequence: seq, rootItem: { children: collection([]) }, sequences: collection(seqs, 'numSequences'),
    openSequence(sid) {
      calls.push(['openSequence', sid]);
      const s = seqs.find(x => String(x.sequenceID) === String(sid));
      if (!s || !openWorks) return false;
      project.activeSequence = s;
      return true;
    }
  };
  const ctx = vm.createContext({
    app: { project, enableQE() {} },
    qe: { project: { getActiveSequence: () => ({ getVideoTrackAt: qeTrack }) } },
    Time, File: function () {}, Folder: { fs: 'Windows' }, ProjectItemType: { BIN: 2 }
  });
  vm.runInContext(SRC, ctx);
  const call = (fn, args) => JSON.parse(vm.runInContext('cadence.' + fn + '(' + JSON.stringify(args || {}) + ')', ctx));
  return { call, calls, video, markers };
}

test('Contexte : rushes par piste et musique trouvée automatiquement (son des rushes ignoré)', () => {
  const w = makeTimeline();
  const r = w.call('getBeatCutContext');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.data.tracks.map(t => t.name), ['V1', 'V2', 'V3']);
  assert.equal(r.data.rushCount, 3);
  assert.equal(r.data.music.name, 'musique.wav');
  assert.equal(r.data.music.mediaPath, 'C:\\media\\musique');
  assert.ok(Math.abs(r.data.frame - 0.04) < 1e-9);
  assert.deepEqual(r.data.range, { start: 0, end: 12 });
});

test('Contexte : messages clairs (pas de rush, une seule piste, pas de musique)', () => {
  const none = makeTimeline();
  none.video.flat().forEach(c => { c.selected = false; });
  assert.match(none.call('getBeatCutContext').error, /Aucun rush sélectionné/);
  assert.match(makeTimeline({ rushTracks: 1 }).call('getBeatCutContext').error, /au moins 2 pistes vidéo/);
  assert.match(makeTimeline({ withMusic: false, rushAudio: false }).call('getBeatCutContext').error, /Aucun clip audio en face des rushes.*A1 : 0 clip\(s\), A2 : 0 clip/);
});

test('Beat Cut : sauvegarde, coupes au rythme, un seul angle visible par segment, musique intacte', () => {
  const w = makeTimeline();
  const ctx = w.call('getBeatCutContext').data;
  const beats = []; for (let t = 0.5; t < 12; t += 0.7) beats.push(t); // ~86 BPM
  const plan = D.planMulticam({ beats, range: ctx.range, tracks: ctx.tracks, every: 2, fps: 1 / ctx.frame });
  const r = w.call('beatCutMulticam', { sequenceId: ctx.sequence.id, tracks: ctx.tracks.map(t => t.index), cuts: plan.cuts, segments: plan.segments, markers: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.calls[0][0], 'clone', 'sauvegarde avant toute coupe');
  assert.deepEqual(w.calls[1], ['openSequence', 'seq-1'], 'séquence d’origine rouverte après la copie');
  assert.equal(r.data.backupName, 'Clip Copie');
  assert.equal(r.data.razored, plan.cuts.length * 3);
  assert.equal(r.data.skipped, 0);
  assert.equal(r.data.missing, 0);
  assert.equal(r.data.markers, plan.cuts.length);
  // Pour chaque segment : la piste « keep » a son morceau, toutes les pistes au-dessus sont vides.
  for (const s of plan.segments) {
    const mid = (s.start + s.end) / 2;
    const has = t => w.video[t].some(c => c.start.seconds < mid && c.end.seconds > mid);
    assert.ok(has(s.keep), `segment ${s.start}: V${s.keep + 1} visible`);
    for (let t = s.keep + 1; t < 3; t++) assert.ok(!has(t), `segment ${s.start}: V${t + 1} retiré`);
  }
  assert.deepEqual([...new Set(plan.segments.map(s => s.keep))].sort(), [0, 1, 2], 'les 3 angles sont utilisés');
  assert.ok(w.calls.every(c => c[0] !== 'razor' || typeof c[1] === 'number'), 'seules des pistes vidéo sont coupées');
});

test('Sécurité : si la coupe QE échoue, aucun rush entier n’est supprimé', () => {
  const w = makeTimeline({ razorWorks: false });
  const ctx = w.call('getBeatCutContext').data;
  const plan = D.planMulticam({ beats: [1, 2, 3, 4, 5, 6], range: ctx.range, tracks: ctx.tracks, every: 1, fps: 25 });
  const r = w.call('beatCutMulticam', { sequenceId: ctx.sequence.id, tracks: [0, 1, 2], cuts: plan.cuts, segments: plan.segments });
  assert.equal(r.data.removed, 0);
  assert.equal(r.data.missing, r.data.razored, 'coupes manquantes détectées');
  assert.ok(r.data.missing > 0);
  assert.equal(w.video.flat().length, 3);
});

test('Beat Cut : refus si la séquence active a changé ou si une seule piste', () => {
  const w = makeTimeline();
  assert.match(w.call('beatCutMulticam', { sequenceId: 'autre', tracks: [0, 1], cuts: [1], segments: [] }).error, /séquence active a changé/);
  assert.match(w.call('beatCutMulticam', { sequenceId: 'seq-1', tracks: [0], cuts: [1], segments: [] }).error, /Au moins 2 pistes/);
});

test('Musique = fichier vidéo dont l’image est sélectionnée avec les rushes (cas réel signalé)', () => {
  const r = makeTimeline({ musicVideo: true }).call('getBeatCutContext');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.music.name, 'musique_clip.mp4');
  assert.match(r.data.musicNote, /image est aussi un angle \(V3\)/);
});

test('Sans fichier de musique séparé : le son d’un rush est utilisé, avec avertissement', () => {
  const r = makeTimeline({ withMusic: false }).call('getBeatCutContext');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.music.name, 'MVI_0033.MP4');
  assert.match(r.data.musicNote, /Musique = son de « MVI_0033.MP4 » \(A2\)/);
});

test('Un clip audio sélectionné est prioritaire', () => {
  const r = makeTimeline({ selectAudio: true }).call('getBeatCutContext');
  assert.equal(r.data.music.name, 'musique.wav');
  assert.equal(r.data.musicNote, null);
});

test('Sauvegarde : si Premiere ne rouvre pas la séquence d’origine, rien n’est coupé', () => {
  const w = makeTimeline({ openWorks: false });
  const r = w.call('beatCutMulticam', { sequenceId: 'seq-1', tracks: [0, 1, 2], cuts: [2, 4], segments: [] });
  assert.match(r.error, /Copie de sauvegarde créée \(« Clip Copie »\), mais Premiere n'a pas pu rouvrir la séquence « Clip »/);
  assert.equal(w.calls.filter(c => c[0] === 'razor').length, 0);
});

test('Sauvegarde : fonctionne aussi si la copie ne devient pas active', () => {
  const w = makeTimeline({ cloneActivates: false });
  const ctx = w.call('getBeatCutContext').data;
  const plan = D.planMulticam({ beats: [1, 2, 3, 4], range: ctx.range, tracks: ctx.tracks, every: 1, fps: 25 });
  const r = w.call('beatCutMulticam', { sequenceId: 'seq-1', tracks: [0, 1, 2], cuts: plan.cuts, segments: plan.segments });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.calls.filter(c => c[0] === 'openSequence').length, 0);
  assert.equal(r.data.missing, 0);
});

function runPlan(layout, rushTracks = 3) {
  const w = makeTimeline({ rushTracks });
  const ctx = w.call('getBeatCutContext').data;
  const beats = []; for (let t = 0.5; t < 12; t += 0.5) beats.push(t);
  const plan = D.planMulticam({ beats, range: ctx.range, tracks: ctx.tracks, every: 2, fps: 25 });
  const args = { sequenceId: ctx.sequence.id, tracks: ctx.tracks.map(t => t.index), cuts: plan.cuts, segments: plan.segments };
  if (layout) args.layout = layout;
  const r = w.call('beatCutMulticam', args);
  assert.equal(r.ok, true, r.error);
  const has = (t, mid) => w.video[t].some(c => c.start.seconds < mid && c.end.seconds > mid);
  return { w, r, plan, has };
}

test('Mode « toutes les pistes » (défaut) : chaque piste sélectionnée est découpée, un seul plan par segment', () => {
  const { r, plan, has } = runPlan(undefined);
  assert.equal(r.data.layout, 'all');
  for (const s of plan.segments) {
    const mid = (s.start + s.end) / 2;
    assert.deepEqual([0, 1, 2].filter(t => has(t, mid)), [s.keep], `segment ${s.start}`);
  }
  assert.equal(r.data.perTrack.length, 3);
  r.data.perTrack.forEach(p => {
    assert.equal(p.cuts, plan.cuts.length, p.name + ' coupée à chaque temps');
    assert.ok(p.pieces > 0 && p.pieces < plan.segments.length, `${p.name} : ${p.pieces} plans gardés sur ${plan.segments.length}`);
  });
});

test('Mode « toutes les pistes » avec 5 pistes vidéo sélectionnées', () => {
  const { r, plan, has } = runPlan(undefined, 5);
  assert.deepEqual(r.data.perTrack.map(p => p.name), ['V1', 'V2', 'V3', 'V4', 'V5']);
  assert.deepEqual([...new Set(plan.segments.map(s => s.keep))].sort(), [0, 1, 2, 3, 4]);
  for (const s of plan.segments) {
    const mid = (s.start + s.end) / 2;
    assert.deepEqual([0, 1, 2, 3, 4].filter(t => has(t, mid)), [s.keep]);
  }
});

test('Mode « superposé » : la piste du bas reste continue', () => {
  const { r, plan, has } = runPlan('stack');
  assert.equal(r.data.layout, 'stack');
  for (const s of plan.segments) assert.ok(has(0, (s.start + s.end) / 2), 'V1 présente partout');
});
