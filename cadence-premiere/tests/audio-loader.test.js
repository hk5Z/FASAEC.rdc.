'use strict';
/* Teste js/audio.js (chemin CEP : Node.js + FFmpeg) dans Node, avec un objet window minimal. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const D = require('../extension/js/dsp.js');

function loadAudioModule(extraWindow = {}) {
  const window = { CadenceDSP: D, require, process, CadenceBridge: { inCEP: true }, ...extraWindow };
  const ctx = vm.createContext({ window, Buffer, Promise, setTimeout, Date, Math, Float32Array, Uint8Array, DataView, ArrayBuffer, String, Number, Error, RegExp, JSON });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'js', 'audio.js'), 'utf8'), ctx);
  return window.CadenceAudio;
}

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-audio-'));
const sr = 48000;
const tone = new Float32Array(sr * 4).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr));
const wavPath = path.join(dir, 'source.wav');
fs.writeFileSync(wavPath, Buffer.from(D.encodeWav([tone], sr, 16)));

test('WAV : lecture native de la portion [in, out] du clip', async () => {
  const A = loadAudioModule();
  const r = await A.loadPath(wavPath, 1, 2.5);
  assert.equal(r.decoder, 'WAV (lecteur intégré)');
  assert.equal(r.offset, 1);
  assert.ok(Math.abs(r.duration - 1.5) < 1e-6);
  assert.equal(r.channels[0].length, 1.5 * sr);
});

test('Vidéo MP4 (AAC) : extraction locale via FFmpeg, décalage conservé', { skip: !hasFfmpeg && 'FFmpeg absent' }, async () => {
  const mp4 = path.join(dir, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=4', '-i', wavPath, '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-y', mp4]);
  const A = loadAudioModule();
  const r = await A.loadPath(mp4, 1, 2.5);
  assert.equal(r.decoder, 'FFmpeg');
  assert.equal(r.offset, 1);
  assert.ok(Math.abs(r.duration - 1.5) < 0.05, 'durée ' + r.duration);
  const lvl = D.stats(r.channels).rmsDb; // sinus −9 dBFS ; l’upmix mono→stéréo de FFmpeg peut retirer 3 dB
  assert.ok(lvl > -15 && lvl < -6, 'niveau ' + lvl);
});

test('Messages clairs : fichier absent, format inconnu, FFmpeg introuvable', async () => {
  const A = loadAudioModule();
  await assert.rejects(A.loadPath(path.join(dir, 'absent.wav'), 0, 1), /Fichier introuvable/);
  const odd = path.join(dir, 'doc.xyz'); fs.writeFileSync(odd, 'x');
  await assert.rejects(A.loadPath(odd, 0, 1), /non pris en charge/);
  await assert.rejects(A.loadPath(wavPath, 0, 20 * 60), /15 minutes/);
  const fakeMov = path.join(dir, 'clip.mov'); fs.writeFileSync(fakeMov, 'x');
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    await assert.rejects(A.loadPath(fakeMov, 0, 1, { ffmpegPath: path.join(dir, 'nope.exe') }), /FFmpeg est introuvable/);
  } finally { process.env.PATH = savedPath; }
});

// Simule le décodeur Web Audio de CEP (absent de Node) pour vérifier l'ordre : décodeur intégré, puis FFmpeg.
function fakeOfflineAudioContext(works, seen) {
  return function () {
    this.decodeAudioData = (ab, ok, ko) => {
      seen.push(ab.byteLength);
      if (!works) return ko(new Error('codec'));
      const len = sr * 4, data = new Float32Array(len).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr));
      ok({ sampleRate: sr, numberOfChannels: 1, getChannelData: () => data });
    };
  };
}

test('Vidéo : décodeur intégré utilisé en priorité, sans FFmpeg', async () => {
  const mov = path.join(dir, 'interview.mov'); fs.writeFileSync(mov, Buffer.alloc(1234));
  const seen = [];
  const A = loadAudioModule({ OfflineAudioContext: fakeOfflineAudioContext(true, seen) });
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const r = await A.loadPath(mov, 1, 2.5);
    assert.equal(r.decoder, 'décodeur intégré');
    assert.deepEqual(seen, [1234]);
    assert.equal(r.offset, 1);
    assert.equal(r.channels[0].length, 1.5 * sr);
  } finally { process.env.PATH = savedPath; }
});

test('Vidéo : repli FFmpeg si le décodeur intégré échoue, message clair sinon', async () => {
  const mov = path.join(dir, 'interview2.mov'); fs.writeFileSync(mov, Buffer.alloc(10));
  const seen = [];
  const A = loadAudioModule({ OfflineAudioContext: fakeOfflineAudioContext(false, seen) });
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    await assert.rejects(A.loadPath(mov, 0, 1, { ffmpegPath: path.join(dir, 'nope.exe') }), /décodeur intégré ne lit pas.*FFmpeg est introuvable/s);
    assert.equal(seen.length, 1);
  } finally { process.env.PATH = savedPath; }
});
