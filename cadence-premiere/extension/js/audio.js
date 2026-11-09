/*
 * Cadence – lecture des médias, écriture des rendus et pré-écoute (Web Audio).
 * Tout est local : aucune requête réseau.
 */
(function (root) {
  'use strict';
  var DSP = root.CadenceDSP;
  var nodeRequire = typeof root.require === 'function' ? root.require
    : (root.cep_node && typeof root.cep_node.require === 'function' ? root.cep_node.require : null);

  var MAX_SECONDS = 15 * 60;
  var MAX_NATIVE_VIDEO_BYTES = 1e9;
  var WEB_AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'webm'];
  var VIDEO_EXT = ['mp4', 'm4v', 'mov', 'mxf', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', '3gp', 'mkv'];

  function ext(path) { var m = /\.([^.\\/]+)$/.exec(path || ''); return m ? m[1].toLowerCase() : ''; }

  function decodeWithWebAudio(arrayBuffer) {
    var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctx) return Promise.reject(new Error('Web Audio indisponible.'));
    var ctx = new Ctx(2, 1, 48000);
    return new Promise(function (resolve, reject) {
      ctx.decodeAudioData(arrayBuffer, resolve, function () { reject(new Error('format non décodable par le moteur du panneau')); });
    }).then(function (buf) {
      var ch = [];
      for (var c = 0; c < buf.numberOfChannels; c++) ch.push(new Float32Array(buf.getChannelData(c)));
      return { sampleRate: buf.sampleRate, channels: ch };
    });
  }

  function decodeArrayBuffer(ab, name) {
    if (ext(name) === 'wav') {
      try { return Promise.resolve(DSP.parseWav(ab)); } catch (e) { /* WAV exotique : on tente Web Audio */ }
    }
    return decodeWithWebAudio(ab);
  }

  function finish(decoded, start, end, decoder) {
    var total = decoded.channels[0].length / decoded.sampleRate;
    var s = Math.max(0, start || 0), e = end != null ? Math.min(end, total) : total;
    if (e - s <= 0.05) throw new Error('La portion audio à analyser est vide (point d’entrée au-delà de la fin du fichier ?).');
    return {
      sampleRate: decoded.sampleRate,
      channels: (s > 0 || e < total) ? DSP.sliceChannels(decoded.channels, decoded.sampleRate, s, e) : decoded.channels,
      offset: s, duration: e - s, decoder: decoder
    };
  }

  /** Navigateur : fichier choisi par l'utilisateur (input type=file). */
  function loadFileObject(file) {
    return file.arrayBuffer().then(function (ab) { return decodeArrayBuffer(ab, file.name); }).then(function (d) {
      var r = finish(d, 0, null, ext(file.name) === 'wav' ? 'WAV (lecteur intégré)' : 'Web Audio');
      if (r.duration > MAX_SECONDS) throw new Error('Fichier trop long (' + Math.round(r.duration / 60) + ' min) : 15 minutes au maximum.');
      return r;
    }, function (e) { throw new Error('Impossible de lire « ' + file.name + ' » : ' + e.message + '.'); });
  }

  function ffmpegCandidates(configured) {
    var list = [];
    if (configured) list.push(configured);
    list.push('ffmpeg');
    if (root.process && root.process.platform === 'win32') list.push('C:\\ffmpeg\\bin\\ffmpeg.exe');
    return list;
  }

  function runFfmpeg(path, start, end, configured) {
    var cp = nodeRequire('child_process'), fs = nodeRequire('fs'), os = nodeRequire('os'), pth = nodeRequire('path');
    var tmp = pth.join(os.tmpdir(), 'cadence_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.wav');
    var args = ['-hide_banner', '-v', 'error', '-ss', String(start || 0)];
    if (end != null) args.push('-t', String(Math.max(0.05, end - (start || 0))));
    args.push('-i', path, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-y', tmp);
    var candidates = ffmpegCandidates(configured);
    function attempt(i) {
      if (i >= candidates.length) {
        return Promise.reject(new Error('FFmpeg est introuvable. Ce format (vidéo ou audio compressé) nécessite FFmpeg installé localement : ' +
          'indiquez le chemin de ffmpeg.exe dans « Réglages », ou exportez l’audio en WAV.'));
      }
      return new Promise(function (resolve, reject) {
        cp.execFile(candidates[i], args, { windowsHide: true, maxBuffer: 1024 * 1024 }, function (err, stdout, stderr) {
          if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return resolve(attempt(i + 1));
          if (err) return reject(new Error('FFmpeg n’a pas pu extraire l’audio : ' + String(stderr || err.message).trim().slice(0, 300)));
          try {
            var d = DSP.parseWav(fs.readFileSync(tmp));
            resolve(d);
          } catch (e) { reject(e); } finally { try { fs.unlinkSync(tmp); } catch (e2) { /* ignoré */ } }
        });
      });
    }
    return attempt(0);
  }

  /** CEP : lit l'audio d'un fichier média entre start et end (secondes, temps média). */
  function loadPath(path, start, end, opts) {
    opts = opts || {};
    if (!nodeRequire) return Promise.reject(new Error('Accès aux fichiers indisponible (Node.js désactivé dans le panneau).'));
    var fs = nodeRequire('fs'), e = ext(path);
    if (!fs.existsSync(path)) return Promise.reject(new Error('Fichier introuvable : ' + path + ' (média hors ligne ?).'));
    if (end != null && end - (start || 0) > MAX_SECONDS) {
      return Promise.reject(new Error('Portion trop longue (' + Math.round((end - start) / 60) + ' min) : 15 minutes au maximum. Raccourcissez le clip dans la séquence.'));
    }
    var size = fs.statSync(path).size;
    if (e === 'wav' && size < 1.5e9) {
      try { return Promise.resolve(finish(DSP.parseWav(fs.readFileSync(path)), start, end, 'WAV (lecteur intégré)')); } catch (err) { /* repli FFmpeg */ }
    }
    if (WEB_AUDIO_EXT.indexOf(e) >= 0 && size < 2e8) {
      var b = fs.readFileSync(path);
      var ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      return decodeWithWebAudio(ab).then(function (d) { return finish(d, start, end, 'Web Audio'); }, function () {
        return runFfmpeg(path, start, end, opts.ffmpegPath).then(function (d) { return finish(d, 0, null, 'FFmpeg'); }).then(shift(start));
      });
    }
    if (VIDEO_EXT.indexOf(e) < 0 && WEB_AUDIO_EXT.indexOf(e) < 0 && e !== 'wav' && e !== 'aif' && e !== 'aiff') {
      return Promise.reject(new Error('Format .' + e + ' non pris en charge pour l’analyse audio.'));
    }
    var viaFfmpeg = function () {
      return runFfmpeg(path, start, end, opts.ffmpegPath).then(function (d) { return finish(d, 0, null, 'FFmpeg'); }).then(shift(start));
    };
    // Le moteur CEP lit le MP4 H.264/AAC (doc. Adobe) : on tente d'abord le décodeur intégré, sans FFmpeg.
    if (VIDEO_EXT.indexOf(e) >= 0 && size <= MAX_NATIVE_VIDEO_BYTES) {
      var vb = fs.readFileSync(path);
      return decodeWithWebAudio(vb.buffer.slice(vb.byteOffset, vb.byteOffset + vb.byteLength)).then(function (d) {
        return finish(d, start, end, 'décodeur intégré');
      }, function () {
        return viaFfmpeg().catch(function (err) {
          throw new Error('Le décodeur intégré ne lit pas l’audio de ce fichier (.' + e + ', codec non AAC ?). ' + err.message);
        });
      });
    }
    return viaFfmpeg().catch(function (err) {
      if (VIDEO_EXT.indexOf(e) >= 0) throw new Error('Vidéo trop lourde pour le décodeur intégré (' + Math.round(size / 1e6) + ' Mo, max ' + Math.round(MAX_NATIVE_VIDEO_BYTES / 1e6) + ' Mo). ' + err.message);
      throw err;
    });
  }

  function shift(start) { return function (r) { r.offset = start || 0; return r; }; }

  // ------------------------------------------------------------------ rendus
  function outputDir(projectPath) {
    var pth = nodeRequire('path'), os = nodeRequire('os');
    if (projectPath && /\.prproj$/i.test(projectPath)) return pth.join(pth.dirname(projectPath), 'Cadence_Rendus');
    return pth.join(os.homedir(), 'Documents', 'Cadence_Rendus');
  }

  function safeName(s) { return String(s || 'clip').replace(/\.[^.]+$/, '').replace(/[^\w\-À-ÿ]+/g, '_').slice(0, 60); }

  /** Enregistre un WAV. CEP : écrit sur disque et renvoie le chemin. Navigateur : téléchargement, renvoie null. */
  function saveWav(baseName, suffix, channels, sampleRate, projectPath) {
    var ab = DSP.encodeWav(channels, sampleRate, 24);
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    var name = safeName(baseName) + '_' + suffix + '_' + stamp + '.wav';
    if (nodeRequire && root.CadenceBridge && root.CadenceBridge.inCEP) {
      var fs = nodeRequire('fs'), pth = nodeRequire('path'), dir = outputDir(projectPath);
      fs.mkdirSync(dir, { recursive: true });
      var full = pth.join(dir, name);
      fs.writeFileSync(full, Buffer.from(ab));
      return Promise.resolve({ path: full, name: name });
    }
    var url = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return Promise.resolve({ path: null, name: name });
  }

  // ------------------------------------------------------------------ pré-écoute
  function buildCutPreview(channels, sampleRate, segments) {
    var fade = Math.round(sampleRate * 0.005), total = 0;
    segments.forEach(function (s) { total += Math.round((s.end - s.start) * sampleRate); });
    var out = channels.map(function () { return new Float32Array(total); }), pos = 0;
    segments.forEach(function (s) {
      var a = Math.round(s.start * sampleRate), n = Math.round((s.end - s.start) * sampleRate);
      for (var c = 0; c < channels.length; c++) {
        for (var i = 0; i < n; i++) {
          var g = Math.min(1, i / fade, (n - 1 - i) / fade);
          out[c][pos + i] = (channels[c][a + i] || 0) * Math.max(0, g);
        }
      }
      pos += n;
    });
    return out;
  }

  var player = {
    ctx: null, src: null, nodes: [], startedAt: 0, offset: 0, onEnd: null,
    context: function () {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) throw new Error('Lecture audio indisponible dans ce navigateur.');
      this.ctx = this.ctx || new Ctx();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    play: function (channels, sampleRate, opts) {
      opts = opts || {};
      this.stop();
      var ctx = this.context(), buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate), self = this;
      channels.forEach(function (ch, i) { buf.getChannelData(i).set(ch); });
      var src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination);
      var t0 = ctx.currentTime + 0.05;
      (opts.clicks || []).forEach(function (t) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 1500; g.gain.setValueAtTime(0.0001, t0 + t);
        g.gain.exponentialRampToValueAtTime(0.4, t0 + t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.04);
        o.connect(g); g.connect(ctx.destination); o.start(t0 + t); o.stop(t0 + t + 0.05);
        self.nodes.push(o);
      });
      src.onended = function () { if (self.src === src) { self.src = null; if (self.onEnd) self.onEnd(); } };
      src.start(t0);
      this.src = src; this.startedAt = t0; this.duration = buf.duration;
    },
    position: function () { return this.src && this.ctx ? Math.max(0, this.ctx.currentTime - this.startedAt) : null; },
    stop: function () {
      var s = this.src; this.src = null;
      if (s) { try { s.stop(); } catch (e) { /* déjà arrêté */ } }
      this.nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* ignoré */ } });
      this.nodes = [];
    }
  };

  root.CadenceAudio = {
    loadFileObject: loadFileObject, loadPath: loadPath, saveWav: saveWav,
    buildCutPreview: buildCutPreview, player: player, hasNode: !!nodeRequire, ext: ext
  };
}(window));
