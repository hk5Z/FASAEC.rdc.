'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/js/dsp.js');

const SR = 22050;
function silence(sec) { return new Float32Array(Math.round(sec * SR)); }
function tone(sec, freq, amp) {
  const a = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  return a;
}
function noise(sec, amp, seed = 1) {
  const a = new Float32Array(Math.round(sec * SR));
  let s = seed;
  for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = amp * ((s / 2147483647) * 2 - 1); }
  return a;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function add(a, b) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] || 0); return o; }
function zeroCrossFreq(x, sr) {
  let z = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++;
  return z / 2 / (x.length / sr);
}
function clickTrack(bpm, sec, offset) {
  const a = noise(sec, 0.001, 7), period = 60 / bpm, times = [];
  for (let t = offset; t < sec - 0.1; t += period) {
    times.push(t);
    const s = Math.round(t * SR);
    for (let i = 0; i < 0.06 * SR && s + i < a.length; i++) a[s + i] += 0.8 * Math.exp(-i / (0.01 * SR)) * Math.sin(2 * Math.PI * 80 * i / SR);
  }
  return { a, times };
}

test('WAV : aller-retour 16 et 24 bits, stéréo', () => {
  const l = tone(0.1, 440, 0.5), r = tone(0.1, 220, -0.25);
  for (const bits of [16, 24]) {
    const w = D.parseWav(D.encodeWav([l, r], SR, bits));
    assert.equal(w.sampleRate, SR);
    assert.equal(w.channels.length, 2);
    assert.equal(w.channels[0].length, l.length);
    const tolerance = bits === 16 ? 1e-4 : 1e-6;
    for (let i = 0; i < l.length; i += 37) {
      assert.ok(Math.abs(w.channels[0][i] - l[i]) < tolerance);
      assert.ok(Math.abs(w.channels[1][i] - r[i]) < tolerance);
    }
  }
});

test('WAV : rejet clair des fichiers invalides', () => {
  assert.throws(() => D.parseWav(new Uint8Array(20)), /WAV valide/);
});

test('Voice Cut : détecte les pauses et respecte durée minimale et marge', () => {
  const speech = () => add(tone(1.0, 220, 0.3), noise(1.0, 0.05));
  const x = concat(speech(), silence(0.8), speech(), silence(0.2), speech(), silence(1.5));
  const total = x.length / SR;
  const regions = D.detectSilences(add(x, noise(total, 0.001, 3)), SR, { thresholdDb: -40, minSilence: 0.5, padding: 0.1 });
  assert.equal(regions.length, 2, JSON.stringify(regions));
  assert.ok(Math.abs(regions[0].start - 1.1) < 0.03 && Math.abs(regions[0].end - 1.7) < 0.03, JSON.stringify(regions[0]));
  // silence final : coupé jusqu’à la fin, marge seulement côté parole
  assert.ok(Math.abs(regions[1].start - (total - 1.5 + 0.1)) < 0.03);
  assert.ok(Math.abs(regions[1].end - total) < 1e-9);
  const kept = D.keptSegments(regions, total);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].start, 0);
});

test('Voice Cut : seuil suggéré entre bruit de fond et parole', () => {
  const x = concat(add(tone(2, 200, 0.3), noise(2, 0.02)), noise(2, 0.003, 9));
  const s = D.suggestThreshold(x, SR);
  assert.ok(s.thresholdDb > s.noiseDb && s.thresholdDb < s.speechDb, JSON.stringify(s));
});

test('Beat Cut : attaques détectées sur une piste de clics à 120 BPM', () => {
  const { a, times } = clickTrack(120, 8, 0.25);
  const r = D.detectBeats(a, SR, { sensitivity: 0.5, minInterval: 0.25 });
  assert.ok(Math.abs(r.bpm - 120) < 2, 'bpm ' + r.bpm);
  assert.equal(r.beats.length, times.length);
  r.beats.forEach((b, i) => assert.ok(Math.abs(b.time - times[i]) < 0.03, `temps ${i}: ${b.time} vs ${times[i]}`));
});

test('Beat Cut : grille de tempo à 95 BPM et filtre « 1 temps sur 2 »', () => {
  const { a, times } = clickTrack(95, 10, 0.4);
  const g = D.detectBeats(a, SR, { mode: 'grid' });
  assert.ok(Math.abs(g.bpm - 95) < 2, 'bpm ' + g.bpm);
  const near = times.filter(t => g.beats.some(b => Math.abs(b.time - t) < 0.04));
  assert.ok(near.length >= times.length - 1, `${near.length}/${times.length}`);
  const half = D.detectBeats(a, SR, { mode: 'grid', every: 2 });
  assert.equal(half.beats.length, Math.ceil(g.beats.length / 2));
});

test('Beat Cut : aucun temps sur un silence', () => {
  assert.equal(D.detectBeats(silence(3), SR).beats.length, 0);
});

test('Améliorer la voix : passe-haut, expandeur et normalisation mesurés', () => {
  const rumble = tone(2, 30, 0.3), voice = tone(2, 1000, 0.3);
  const hp = D.processVoice([rumble], SR, { demud: false, presence: false, expander: false, compressor: false, normalize: false });
  assert.ok(hp.report.after.rmsDb < hp.report.before.rmsDb - 20, 'atténuation 30 Hz');
  const keep = D.processVoice([voice], SR, { demud: false, presence: false, expander: false, compressor: false, normalize: false });
  assert.ok(Math.abs(keep.report.after.rmsDb - keep.report.before.rmsDb) < 0.5, '1 kHz préservé');

  const x = concat(add(tone(1, 300, 0.2), noise(1, 0.004)), noise(1, 0.004, 5), add(tone(1, 300, 0.2), noise(1, 0.004, 6)));
  const full = D.processVoice([x], SR, {});
  assert.ok(Math.abs(full.report.after.peakDb - -1) < 0.05, 'crête ' + full.report.after.peakDb);
  const gap = full.channels[0].slice(Math.round(1.3 * SR), Math.round(1.7 * SR));
  const speechPart = full.channels[0].slice(Math.round(0.2 * SR), Math.round(0.8 * SR));
  const gapDb = D.stats([gap]).rmsDb, spDb = D.stats([speechPart]).rmsDb;
  const origGap = D.stats([x.slice(Math.round(1.3 * SR), Math.round(1.7 * SR))]).rmsDb;
  const origSp = D.stats([x.slice(Math.round(0.2 * SR), Math.round(0.8 * SR))]).rmsDb;
  assert.ok((spDb - gapDb) > (origSp - origGap) + 6, `écart parole/bruit ${(spDb - gapDb).toFixed(1)} vs ${(origSp - origGap).toFixed(1)}`);
  assert.deepEqual(full.report.applied.map(s => s.id), ['highpass', 'demud', 'presence', 'expander', 'compressor', 'normalize']);
});

test('Accélérer : WSOLA change la durée sans changer la hauteur', () => {
  const x = tone(2, 440, 0.5);
  for (const rate of [1.5, 0.8]) {
    const [y] = D.timeStretch([x], SR, rate);
    assert.equal(y.length, Math.floor(x.length / rate));
    const f = zeroCrossFreq(y.slice(1000, y.length - 1000), SR);
    assert.ok(Math.abs(f - 440) < 6, `rate ${rate}: ${f} Hz`);
    const rms = D.stats([y.slice(1000, y.length - 1000)]).rmsDb, ref = D.stats([x]).rmsDb;
    assert.ok(Math.abs(rms - ref) < 1, `niveau ${rms} vs ${ref}`);
  }
  assert.throws(() => D.timeStretch([x], SR, 10), /hors limites/);
});

test('Correspondance temps média -> séquence (vitesse comprise)', () => {
  const clip = { start: 10, inPoint: 2, speed: 2 };
  assert.equal(D.mediaToSequence(2, clip), 10);
  assert.equal(D.mediaToSequence(6, clip), 12);
});
