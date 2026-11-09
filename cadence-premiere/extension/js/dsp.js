/*
 * Cadence – moteur audio (100 % local, sans dépendance).
 * Utilisable dans le panneau CEP (window.CadenceDSP) et dans Node (tests).
 */
(function (root) {
  'use strict';

  var LN10 = Math.log(10);
  function toDb(x) { return 20 * Math.log(Math.max(x, 1e-12)) / LN10; }
  function fromDb(db) { return Math.pow(10, db / 20); }

  // ---------------------------------------------------------------- WAV
  function asUint8(buf) {
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  function parseWav(buf) {
    var u8 = asUint8(buf);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    function tag(o) { return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); }
    if (u8.length < 12 || (tag(0) !== 'RIFF' && tag(0) !== 'RF64') || tag(8) !== 'WAVE') {
      throw new Error('Ce fichier n’est pas un WAV valide.');
    }
    var off = 12, fmt = null, dataOff = -1, dataLen = 0;
    while (off + 8 <= u8.length) {
      var id = tag(off), size = dv.getUint32(off + 4, true), body = off + 8;
      if (id === 'fmt ') {
        fmt = {
          format: dv.getUint16(body, true),
          channels: dv.getUint16(body + 2, true),
          sampleRate: dv.getUint32(body + 4, true),
          bits: dv.getUint16(body + 14, true)
        };
        if (fmt.format === 0xFFFE && size >= 40) fmt.format = dv.getUint16(body + 24, true);
      } else if (id === 'data') {
        dataOff = body;
        dataLen = (size === 0xFFFFFFFF || body + size > u8.length) ? u8.length - body : size;
        break;
      }
      off = body + size + (size & 1);
    }
    if (!fmt || dataOff < 0) throw new Error('WAV incomplet (bloc fmt ou data manquant).');
    var bps = fmt.bits / 8, nch = fmt.channels;
    if (!nch || !bps) throw new Error('WAV : en-tête incohérent.');
    var supported = (fmt.format === 1 && [8, 16, 24, 32].indexOf(fmt.bits) >= 0) ||
                    (fmt.format === 3 && (fmt.bits === 32 || fmt.bits === 64));
    if (!supported) throw new Error('WAV non pris en charge (codage ' + fmt.format + ', ' + fmt.bits + ' bits).');
    var frames = Math.floor(dataLen / (bps * nch));
    var channels = [];
    for (var c = 0; c < nch; c++) channels.push(new Float32Array(frames));
    var p = dataOff;
    for (var i = 0; i < frames; i++) {
      for (c = 0; c < nch; c++) {
        var v;
        if (fmt.format === 3) v = fmt.bits === 32 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
        else if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
        else if (fmt.bits === 24) {
          var x = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16);
          if (x & 0x800000) x -= 0x1000000;
          v = x / 8388608;
        } else if (fmt.bits === 32) v = dv.getInt32(p, true) / 2147483648;
        else v = (u8[p] - 128) / 128;
        channels[c][i] = v;
        p += bps;
      }
    }
    return { sampleRate: fmt.sampleRate, channels: channels };
  }

  /** Encode en WAV PCM 16 ou 24 bits (défaut 24). Retourne un ArrayBuffer. */
  function encodeWav(channels, sampleRate, bits) {
    bits = bits || 24;
    var nch = channels.length, frames = channels[0].length, bps = bits / 8;
    var dataLen = frames * nch * bps;
    var ab = new ArrayBuffer(44 + dataLen), dv = new DataView(ab), u8 = new Uint8Array(ab);
    function w(o, s) { for (var k = 0; k < 4; k++) u8[o + k] = s.charCodeAt(k); }
    w(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
    w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * nch * bps, true);
    dv.setUint16(32, nch * bps, true); dv.setUint16(34, bits, true);
    w(36, 'data'); dv.setUint32(40, dataLen, true);
    var p = 44;
    for (var i = 0; i < frames; i++) {
      for (var c = 0; c < nch; c++) {
        var s = Math.max(-1, Math.min(1, channels[c][i]));
        if (bits === 16) { dv.setInt16(p, Math.round(s < 0 ? s * 32768 : s * 32767), true); }
        else {
          var x = Math.round(s < 0 ? s * 8388608 : s * 8388607);
          if (x < 0) x += 0x1000000;
          u8[p] = x & 255; u8[p + 1] = (x >> 8) & 255; u8[p + 2] = (x >> 16) & 255;
        }
        p += bps;
      }
    }
    return ab;
  }

  // ---------------------------------------------------------------- utilitaires
  function mixToMono(channels) {
    if (channels.length === 1) return channels[0];
    var n = channels[0].length, out = new Float32Array(n), k = 1 / channels.length;
    for (var c = 0; c < channels.length; c++) {
      var ch = channels[c];
      for (var i = 0; i < n; i++) out[i] += ch[i] * k;
    }
    return out;
  }

  function sliceChannels(channels, sampleRate, startSec, endSec) {
    var a = Math.max(0, Math.round(startSec * sampleRate));
    var b = Math.min(channels[0].length, Math.round(endSec * sampleRate));
    return channels.map(function (ch) { return ch.slice(a, Math.max(a, b)); });
  }

  function computePeaks(mono, buckets) {
    var min = new Float32Array(buckets), max = new Float32Array(buckets);
    var step = mono.length / buckets;
    for (var b = 0; b < buckets; b++) {
      var a = Math.floor(b * step), e = Math.max(a + 1, Math.floor((b + 1) * step));
      var lo = 1, hi = -1;
      for (var i = a; i < e && i < mono.length; i++) { var v = mono[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi < lo) { lo = 0; hi = 0; }
      min[b] = lo; max[b] = hi;
    }
    return { min: min, max: max };
  }

  function stats(channels) {
    var peak = 0, sum = 0, n = 0;
    channels.forEach(function (ch) {
      for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > peak) peak = a; sum += ch[i] * ch[i]; }
      n += ch.length;
    });
    return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / Math.max(1, n))) };
  }

  /** Niveau RMS (dBFS) par fenêtre. */
  function frameLevels(mono, sampleRate, windowSec) {
    var hop = Math.max(1, Math.round(sampleRate * windowSec));
    var n = Math.floor(mono.length / hop), out = new Float32Array(n);
    for (var f = 0; f < n; f++) {
      var s = 0, base = f * hop;
      for (var i = 0; i < hop; i++) { var v = mono[base + i]; s += v * v; }
      out[f] = toDb(Math.sqrt(s / hop));
    }
    return { db: out, hopSec: hop / sampleRate };
  }

  function percentile(arr, p) {
    if (!arr.length) return -120;
    var s = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  }

  // ---------------------------------------------------------------- Voice Cut
  /** Propose un seuil de silence à partir du bruit de fond et du niveau de parole. */
  function suggestThreshold(mono, sampleRate) {
    var lv = frameLevels(mono, sampleRate, 0.02).db;
    var noise = percentile(lv, 0.1), speech = percentile(lv, 0.9);
    var thr = noise + Math.max(6, 0.3 * (speech - noise));
    return { thresholdDb: Math.round(Math.max(-70, Math.min(-15, thr))), noiseDb: noise, speechDb: speech };
  }

  /**
   * Détecte les passages silencieux à couper.
   * opts : thresholdDb, minSilence (s), padding (s, marge conservée autour de la parole), windowMs.
   */
  function detectSilences(mono, sampleRate, opts) {
    opts = opts || {};
    var thr = opts.thresholdDb != null ? opts.thresholdDb : -40;
    var minSil = opts.minSilence != null ? opts.minSilence : 0.5;
    var pad = opts.padding != null ? opts.padding : 0.1;
    var lv = frameLevels(mono, sampleRate, (opts.windowMs || 20) / 1000);
    var total = mono.length / sampleRate, regions = [], i = 0, n = lv.db.length;
    while (i < n) {
      if (lv.db[i] < thr) {
        var j = i;
        while (j < n && lv.db[j] < thr) j++;
        var s = i * lv.hopSec, e = j >= n ? total : j * lv.hopSec;
        if (e - s >= minSil) {
          var cs = s <= 0 ? 0 : s + pad, ce = e >= total ? total : e - pad;
          if (ce - cs >= 0.05) regions.push({ start: cs, end: ce, duration: ce - cs });
        }
        i = j;
      } else i++;
    }
    return regions;
  }

  /** Segments conservés (complément des régions retirées) dans [0, total]. */
  function keptSegments(regions, total) {
    var out = [], t = 0;
    regions.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (r) {
      if (r.start > t + 1e-6) out.push({ start: t, end: Math.min(r.start, total) });
      t = Math.max(t, r.end);
    });
    if (total > t + 1e-6) out.push({ start: t, end: total });
    return out.filter(function (s) { return s.end - s.start > 1e-3; });
  }

  // ---------------------------------------------------------------- filtres (RBJ)
  function biquad(type, freq, q, sampleRate, gainDb) {
    var A = Math.pow(10, (gainDb || 0) / 40), w0 = 2 * Math.PI * freq / sampleRate;
    var cs = Math.cos(w0), sn = Math.sin(w0), alpha = sn / (2 * q), b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'peaking') { b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; }
    else throw new Error('Filtre inconnu : ' + type);
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function applyBiquad(x, c) {
    var y = new Float32Array(x.length), z1 = 0, z2 = 0;
    for (var i = 0; i < x.length; i++) {
      var v = x[i], o = c.b0 * v + z1;
      z1 = c.b1 * v - c.a1 * o + z2;
      z2 = c.b2 * v - c.a2 * o;
      y[i] = o;
    }
    return y;
  }

  // ---------------------------------------------------------------- Beat Cut
  function onsetEnvelope(mono, sampleRate) {
    var hop = Math.max(1, Math.round(sampleRate * 0.01)), win = hop * 2;
    var low = applyBiquad(mono, biquad('lowpass', 200, 0.707, sampleRate));
    var n = Math.max(0, Math.floor((mono.length - win) / hop) + 1);
    var env = new Float32Array(n), prevF = 0, prevL = 0;
    for (var f = 0; f < n; f++) {
      var ef = 0, el = 0, base = f * hop;
      for (var i = 0; i < win; i++) { var a = mono[base + i], b = low[base + i]; ef += a * a; el += b * b; }
      var lf = Math.log(1 + 1000 * ef / win), ll = Math.log(1 + 1000 * el / win);
      env[f] = f === 0 ? 0 : Math.max(0, lf - prevF) + Math.max(0, ll - prevL);
      prevF = lf; prevL = ll;
    }
    return { env: env, fps: sampleRate / hop, offset: hop / sampleRate };
  }

  function estimateTempo(env, fps) {
    var n = env.length, mean = 0, i;
    for (i = 0; i < n; i++) mean += env[i];
    mean /= Math.max(1, n);
    var x = new Float32Array(n);
    for (i = 0; i < n; i++) x[i] = env[i] - mean;
    var minLag = Math.floor(fps * 60 / 200), maxLag = Math.min(n - 1, Math.ceil(fps * 60 / 60));
    if (maxLag <= minLag + 2) return null;
    var ac = new Float32Array(maxLag + 2);
    for (var L = minLag - 1; L <= maxLag + 1; L++) {
      var s = 0;
      for (i = 0; i + L < n; i++) s += x[i] * x[i + L];
      ac[L] = s / (n - L);
    }
    var best = -1, bestScore = -Infinity;
    for (L = minLag; L <= maxLag; L++) {
      var bpm = 60 * fps / L, oct = Math.log(bpm / 120) / Math.LN2;
      var score = ac[L] * Math.exp(-0.5 * oct * oct);
      if (score > bestScore) { bestScore = score; best = L; }
    }
    if (best < 0 || bestScore <= 0) return null;
    var y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1], d = y0 - 2 * y1 + y2;
    var lag = best + (d !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / d)) : 0);
    return { lag: lag, bpm: 60 * fps / lag };
  }

  /**
   * opts : sensitivity (0..1), minInterval (s), mode ('onsets' | 'grid'), every (1, 2, 4…)
   * Retourne { beats: [{time, strength}], bpm }
   */
  function detectBeats(mono, sampleRate, opts) {
    opts = opts || {};
    var sens = opts.sensitivity != null ? opts.sensitivity : 0.5;
    var minInt = opts.minInterval != null ? opts.minInterval : 0.25;
    var o = onsetEnvelope(mono, sampleRate), env = o.env, fps = o.fps, n = env.length;
    var maxEnv = 0, i;
    for (i = 0; i < n; i++) if (env[i] > maxEnv) maxEnv = env[i];
    var tempo = estimateTempo(env, fps);
    var beats = [];
    if (maxEnv <= 0) return { beats: [], bpm: null };

    if (opts.mode === 'grid' && tempo) {
      var L = tempo.lag, bestPhi = 0, bestS = -1;
      for (var phi = 0; phi < L; phi += 0.25) {
        var s = 0;
        for (var t = phi; t < n; t += L) s += env[Math.round(t)] || 0;
        if (s > bestS) { bestS = s; bestPhi = phi; }
      }
      for (t = bestPhi; t < n; t += L) {
        var k = Math.round(t), loc = 0;
        for (var d = -2; d <= 2; d++) loc = Math.max(loc, env[k + d] || 0);
        beats.push({ time: t / fps + o.offset, strength: loc / maxEnv });
      }
    } else {
      var w = Math.max(1, Math.round(0.05 * fps)), lw = Math.max(2, Math.round(0.5 * fps));
      var kk = 2.0 - 1.8 * sens, cand = [];
      for (i = 1; i < n - 1; i++) {
        var v = env[i], isMax = true;
        for (var j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
          if (env[j] > v || (env[j] === v && j < i)) { isMax = false; break; }
        }
        if (!isMax) continue;
        var a = Math.max(0, i - lw), b = Math.min(n, i + lw + 1), m = 0, sq = 0;
        for (j = a; j < b; j++) { m += env[j]; sq += env[j] * env[j]; }
        m /= (b - a);
        var sd = Math.sqrt(Math.max(0, sq / (b - a) - m * m));
        if (v >= m + kk * sd && v >= (0.35 - 0.3 * sens) * maxEnv) cand.push({ time: i / fps + o.offset, strength: v / maxEnv });
      }
      cand.sort(function (x, y) { return y.strength - x.strength; });
      cand.forEach(function (c) {
        for (var q = 0; q < beats.length; q++) if (Math.abs(beats[q].time - c.time) < minInt) return;
        beats.push(c);
      });
      beats.sort(function (x, y) { return x.time - y.time; });
    }
    var every = Math.max(1, opts.every || 1);
    if (every > 1) beats = beats.filter(function (_, idx) { return idx % every === 0; });
    return { beats: beats, bpm: tempo ? tempo.bpm : null };
  }

  // ---------------------------------------------------------------- Améliorer la voix
  function envelopeFollower(mono, sampleRate, attackSec, releaseSec) {
    var ga = Math.exp(-1 / (attackSec * sampleRate)), gr = Math.exp(-1 / (releaseSec * sampleRate));
    var out = new Float32Array(mono.length), e = 0;
    for (var i = 0; i < mono.length; i++) {
      var x = mono[i] * mono[i], g = x > e ? ga : gr;
      e = g * e + (1 - g) * x;
      out[i] = toDb(Math.sqrt(e));
    }
    return out;
  }

  function applyGainCurve(channels, gainDb, sampleRate, attackSec, releaseSec) {
    var ga = Math.exp(-1 / (attackSec * sampleRate)), gr = Math.exp(-1 / (releaseSec * sampleRate));
    var g = 0, n = gainDb.length, lin = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var target = gainDb[i], c = target < g ? ga : gr; // réduction rapide, relâchement lent
      g = c * g + (1 - c) * target;
      lin[i] = fromDb(g);
    }
    return channels.map(function (ch) {
      var o = new Float32Array(ch.length);
      for (var i = 0; i < ch.length; i++) o[i] = ch[i] * lin[i];
      return o;
    });
  }

  var VOICE_STEPS = {
    highpass: 'Filtre passe-haut 80 Hz (≈ 24 dB/octave) : retire grondements, souffle de vent et bruits de manipulation graves.',
    demud: 'Égaliseur −2 dB à 300 Hz : réduit l’effet « boîte » / voix étouffée.',
    presence: 'Égaliseur +3 dB à 3 kHz : améliore l’intelligibilité (peut accentuer les sifflantes).',
    expander: 'Expandeur vers le bas (max −12 dB) : baisse le bruit de fond entre les phrases. Ce n’est pas un débruiteur spectral : le bruit présent pendant la parole reste.',
    compressor: 'Compresseur 3:1 au-dessus de −24 dBFS : resserre les écarts de volume entre syllabes.',
    normalize: 'Normalisation crête à −1 dBFS : remonte le niveau global sans saturer (ce n’est pas une mesure LUFS).'
  };

  function processVoice(channels, sampleRate, opts) {
    opts = opts || {};
    var on = function (k) { return opts[k] !== false; };
    var cur = channels.map(function (c) { return new Float32Array(c); });
    var before = stats(cur), applied = [];
    function eachChannel(fn) { cur = cur.map(fn); }
    if (on('highpass')) {
      var hp = biquad('highpass', 80, 0.707, sampleRate);
      eachChannel(function (c) { return applyBiquad(applyBiquad(c, hp), hp); });
      applied.push('highpass');
    }
    if (on('demud')) { var dm = biquad('peaking', 300, 1, sampleRate, -2); eachChannel(function (c) { return applyBiquad(c, dm); }); applied.push('demud'); }
    if (on('presence')) { var pr = biquad('peaking', 3000, 1, sampleRate, 3); eachChannel(function (c) { return applyBiquad(c, pr); }); applied.push('presence'); }
    var noiseInfo = null;
    if (on('expander')) {
      var mono = mixToMono(cur), lv = frameLevels(mono, sampleRate, 0.02).db;
      var noise = percentile(lv, 0.1), speech = percentile(lv, 0.9);
      if (speech - noise >= 10) {
        var thr = noise + Math.min(10, 0.35 * (speech - noise));
        var env = envelopeFollower(mono, sampleRate, 0.005, 0.12), gdb = new Float32Array(env.length);
        for (var i = 0; i < env.length; i++) gdb[i] = env[i] < thr ? Math.max(-12, (env[i] - thr)) : 0;
        cur = applyGainCurve(cur, gdb, sampleRate, 0.002, 0.08);
        applied.push('expander');
        noiseInfo = { noiseDb: noise, thresholdDb: thr };
      } else {
        noiseInfo = { skipped: 'Écart parole/bruit trop faible (' + (speech - noise).toFixed(1) + ' dB) : expandeur ignoré.' };
      }
    }
    if (on('compressor')) {
      var m2 = mixToMono(cur), env2 = envelopeFollower(m2, sampleRate, 0.01, 0.15), g2 = new Float32Array(env2.length);
      for (var k = 0; k < env2.length; k++) { var over = env2[k] + 24; g2[k] = over > 0 ? -over * (1 - 1 / 3) : 0; }
      cur = applyGainCurve(cur, g2, sampleRate, 0.005, 0.15);
      applied.push('compressor');
    }
    if (on('normalize')) {
      var pk = 0;
      cur.forEach(function (c) { for (var i = 0; i < c.length; i++) { var a = Math.abs(c[i]); if (a > pk) pk = a; } });
      if (pk > 1e-6) {
        var gain = fromDb(-1) / pk;
        eachChannel(function (c) { var o = new Float32Array(c.length); for (var i = 0; i < c.length; i++) o[i] = c[i] * gain; return o; });
      }
      applied.push('normalize');
    }
    return {
      channels: cur,
      report: {
        applied: applied.map(function (k) { return { id: k, description: VOICE_STEPS[k] }; }),
        before: before, after: stats(cur), noise: noiseInfo
      }
    };
  }

  // ---------------------------------------------------------------- Accélérer (WSOLA)
  /**
   * Étirement temporel WSOLA : change la durée sans changer la hauteur.
   * rate > 1 accélère. Les décalages sont calculés sur le mixage mono et appliqués à tous les canaux.
   */
  function timeStretch(channels, sampleRate, rate) {
    if (!(rate > 0.25 && rate <= 4)) throw new Error('Vitesse hors limites (0,25 à 4).');
    var N = 2 * Math.round(sampleRate * 0.02), Hs = N / 2, Ha = Hs * rate;
    var tol = Math.round(sampleRate * 0.008), L = Hs;
    var mono = mixToMono(channels), inLen = mono.length;
    var outLen = Math.floor(inLen / rate);
    var win = new Float32Array(N);
    for (var n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N);
    var out = channels.map(function () { return new Float32Array(outLen + N); });
    var maxPos = Math.max(0, inLen - N), prevPos = 0;
    function corr(a, b, step) {
      var s = 0;
      for (var i = 0; i < L; i += step) s += (mono[a + i] || 0) * (mono[b + i] || 0);
      return s;
    }
    for (var k = 0; k * Hs < outLen; k++) {
      var pos;
      if (k === 0) pos = 0;
      else {
        var nominal = Math.round(k * Ha), natural = prevPos + Hs;
        var lo = Math.max(0, nominal - tol), hi = Math.min(maxPos, nominal + tol);
        if (hi < lo) pos = Math.min(maxPos, Math.max(0, nominal));
        else {
          var best = lo, bestC = -Infinity, c;
          for (var p = lo; p <= hi; p += 4) { c = corr(natural, p, 4); if (c > bestC) { bestC = c; best = p; } }
          var r0 = Math.max(lo, best - 3), r1 = Math.min(hi, best + 3);
          bestC = -Infinity;
          for (p = r0; p <= r1; p++) { c = corr(natural, p, 1); if (c > bestC) { bestC = c; best = p; } }
          pos = best;
        }
      }
      var sp = k * Hs;
      for (var ch = 0; ch < channels.length; ch++) {
        var src = channels[ch], dst = out[ch];
        for (n = 0; n < N; n++) dst[sp + n] += win[n] * (src[pos + n] || 0);
      }
      prevPos = pos;
    }
    // premier demi-cadre : compense l’absence de recouvrement
    for (ch = 0; ch < out.length; ch++) for (n = 0; n < Hs && n < outLen; n++) out[ch][n] = channels[ch][n] || 0;
    return out.map(function (c) { return c.slice(0, outLen); });
  }

  // ---------------------------------------------------------------- correspondance temps
  /** Temps média (s) -> temps séquence (s) pour un clip de la timeline. */
  function mediaToSequence(t, clip) {
    return clip.start + (t - clip.inPoint) / (clip.speed || 1);
  }

  var api = {
    toDb: toDb, fromDb: fromDb,
    parseWav: parseWav, encodeWav: encodeWav, mixToMono: mixToMono, sliceChannels: sliceChannels,
    computePeaks: computePeaks, stats: stats, frameLevels: frameLevels,
    suggestThreshold: suggestThreshold, detectSilences: detectSilences, keptSegments: keptSegments,
    biquad: biquad, applyBiquad: applyBiquad,
    onsetEnvelope: onsetEnvelope, estimateTempo: estimateTempo, detectBeats: detectBeats,
    processVoice: processVoice, VOICE_STEPS: VOICE_STEPS,
    timeStretch: timeStretch, mediaToSequence: mediaToSequence
  };
  if (root) root.CadenceDSP = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : null));
