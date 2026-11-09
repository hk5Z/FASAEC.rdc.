/* Cadence – logique du panneau. Aucune modification de séquence sans confirmation explicite. */
(function (root) {
  'use strict';
  var D = root.CadenceDSP, Bridge = root.CadenceBridge, A = root.CadenceAudio;
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    env: Bridge.environment(), host: null, clip: null, audio: null, mono: null,
    beats: null, ctx: null, plan: null, cadence: 'normal', regions: null, enhanced: null, stretched: null, tool: null, busy: false
  };
  var wave = new root.CadenceWaveform($('wave'));

  // ------------------------------------------------------------------ utilitaires
  function fmt(t) {
    if (t == null || !isFinite(t)) return '–';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2).replace('.', ',');
  }
  function n2(x, d) { return Number(x).toFixed(d == null ? 1 : d).replace('.', ','); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function status(msg, kind) { var el = $('status'); el.textContent = msg; el.className = 'status ' + (kind || ''); }
  function nextFrame() { return new Promise(function (r) { setTimeout(r, 30); }); }
  function seqTime(t) { return D.mediaToSequence(S.audio.offset + t, S.clip); }
  function simNote() { return Bridge.inCEP ? '' : '\n(Simulation navigateur : Premiere n’a pas été modifié.)'; }

  function confirmDialog(title, html, okLabel) {
    return new Promise(function (resolve) {
      var modal = $('modal'), ok = $('modalOk'), cancel = $('modalCancel');
      $('modalTitle').textContent = title;
      $('modalBody').innerHTML = html;
      ok.textContent = okLabel || 'Confirmer';
      modal.hidden = false;
      cancel.focus();
      function done(v) {
        modal.hidden = true;
        ok.removeEventListener('click', yes); cancel.removeEventListener('click', no); document.removeEventListener('keydown', key);
        resolve(v);
      }
      function yes() { done(true); }
      function no() { done(false); }
      function key(e) { if (e.key === 'Escape') no(); }
      ok.addEventListener('click', yes); cancel.addEventListener('click', no); document.addEventListener('keydown', key);
    });
  }

  async function task(label, fn) {
    if (S.busy) { status('Une opération est déjà en cours…', 'busy'); return; }
    S.busy = true; document.body.classList.add('busy');
    document.querySelectorAll('button').forEach(function (b) { if (!b.closest('#modal')) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; } });
    status(label + '…', 'busy');
    await nextFrame();
    try {
      var msg = await fn();
      if (msg !== undefined) status(msg, 'ok');
    } catch (e) {
      status(e && e.message ? e.message : String(e), 'error');
      if (root.console) console.warn(e); // visible dans le débogueur CEP (port 8088)
    } finally {
      S.busy = false; document.body.classList.remove('busy');
      document.querySelectorAll('button').forEach(function (b) { if (!b.closest('#modal')) b.disabled = b.dataset.wasDisabled === '1'; });
      refreshButtons();
    }
  }

  function requireSource() {
    if (!S.audio) throw new Error(Bridge.inCEP ? 'Chargez d’abord un clip : sélectionnez-le dans la séquence puis « Charger le clip sélectionné ».' : 'Ouvrez d’abord un fichier audio.');
  }

  async function requireSameSequence() {
    var info = await Bridge.call('ping');
    if (!info.sequence) throw new Error('Aucune séquence active dans Premiere Pro.');
    if (S.clip && info.sequence.id !== S.clip.sequence.id) {
      throw new Error('La séquence active (« ' + info.sequence.name + ' ») n’est plus celle du clip analysé (« ' + S.clip.sequence.name + ' »). Rouvrez-la ou rechargez le clip.');
    }
    return info.sequence;
  }

  // ------------------------------------------------------------------ source
  function setSource(clip, audio) {
    A.player.stop();
    S.clip = clip; S.audio = audio; S.mono = D.mixToMono(audio.channels);
    S.beats = null; S.plan = null; S.regions = null; S.enhanced = null; S.stretched = null;
    wave.beats = []; wave.regions = []; wave.mono2 = null; wave.peaks2 = null;
    wave.setAudio(S.mono, audio.sampleRate);
    $('waveEmpty').hidden = true;
    var st = D.stats(audio.channels);
    $('sourceInfo').textContent = clip.name + ' · ' + fmt(audio.duration) + ' · ' + audio.sampleRate + ' Hz · ' + audio.channels.length + ' can.';
    $('sourceInfo').title = clip.mediaPath;
    ['beatResult', 'voiceResult', 'enhanceResult', 'speedResult'].forEach(function (id) { $(id).textContent = ''; });
    $('voiceList').innerHTML = '';
    var warn = clip.speed !== 1 ? '\nAttention : vitesse du clip ×' + n2(clip.speed, 2) + ' – les positions sont converties, mais la séquence sans silences et le placement automatique sont désactivés.' : '';
    renderDiag();
    return 'Source chargée (' + audio.decoder + ') : crête ' + n2(st.peakDb) + ' dBFS, RMS ' + n2(st.rmsDb) + ' dBFS.' + warn;
  }

  async function loadClipCore() {
    var clip = await Bridge.call('getSelectedClip');
    if (clip.reversed) throw new Error('Le clip « ' + clip.name + ' » est lu à l’envers : non pris en charge.');
    if (clip.outPoint - clip.inPoint <= 0.05) throw new Error('Le clip sélectionné est trop court.');
    status('Décodage de l’audio de « ' + clip.name + ' »…', 'busy');
    await nextFrame();
    var audio = await A.loadPath(clip.mediaPath, clip.inPoint, clip.outPoint, { ffmpegPath: $('ffmpegPath').value.trim() });
    var extra = clip.selectionCount > 1 ? '\n' + clip.selectionCount + ' éléments sélectionnés : seul « ' + clip.name + ' » (' + clip.mediaType + ') est analysé.' : '';
    return setSource(clip, audio) + extra;
  }

  function loadSelectedClip() { return task('Lecture du clip sélectionné', loadClipCore); }

  // Dans Premiere, les analyses chargent d'elles-mêmes le clip sélectionné si aucune source n'est prête.
  async function ensureSource() {
    if (!S.audio && Bridge.inCEP) await loadClipCore();
    requireSource();
  }

  function loadBrowserFile(file) {
    return task('Lecture de « ' + file.name + ' »', async function () {
      var audio = await A.loadFileObject(file);
      var clip = {
        name: file.name, mediaPath: file.name, mediaType: 'Audio', start: 0, end: audio.duration,
        inPoint: 0, outPoint: audio.duration, speed: 1, reversed: false, projectItemNodeId: 'simulation',
        selectionCount: 1, sequence: { name: Bridge.mock.sequence.name, id: Bridge.mock.sequence.id }
      };
      Bridge.mock.clip = clip;
      return setSource(clip, audio);
    });
  }

  // ------------------------------------------------------------------ outils
  function selectTool(name) {
    S.tool = S.tool === name ? null : name;
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === S.tool); });
    ['beat', 'voice', 'enhance', 'speed'].forEach(function (t) { $('panel-' + t).hidden = S.tool !== t; });
    syncOverlay();
  }

  function syncOverlay() {
    var bo = S.tool === 'beat' ? planOverlay() : { beats: [], segments: [] };
    wave.beats = bo.beats; wave.segments = bo.segments;
    wave.regions = S.tool === 'voice' && S.regions ? S.regions : [];
    wave.mono2 = S.tool === 'enhance' && S.enhanced ? D.mixToMono(S.enhanced.channels) : null;
    wave.peaks2 = null;
    wave.draw();
  }

  function refreshButtons() {
    if (S.busy) return;
    var has = !!S.audio;
    $('btnPlay').disabled = !has; $('btnStop').disabled = !has;
    var nb = S.beats && S.beats.beats.length > 0;
    $('beatPreview').disabled = !nb;
    var nr = S.regions && S.regions.some(function (r) { return r.enabled; });
    $('voicePreview').disabled = !nr; $('voiceMarkers').disabled = !nr;
    $('voiceSequence').disabled = !nr || (S.clip && S.clip.speed !== 1);
    $('enhanceListenA').disabled = !has; $('enhanceListenB').disabled = !S.enhanced; $('enhanceSave').disabled = !S.enhanced;
    $('speedListen').disabled = !S.stretched; $('speedSave').disabled = !S.stretched;
    $('enhancePlace').disabled = !!(S.clip && S.clip.speed !== 1);
  }

  // ---- Beat Cut (montage multicam au rythme de la musique)
  var TRACK_COLORS = ['#4fb3a9', '#f2b44c', '#9b7bf0', '#e0645c', '#5ea3e6', '#c9d36a'];

  /** Temps séquence -> temps dans l'audio chargé (inverse de seqTime). */
  function localTime(t) { return (t - S.clip.start) * (S.clip.speed || 1) + S.clip.inPoint - S.audio.offset; }

  function detectMusicBeats() {
    S.beats = D.detectBeats(S.mono, S.audio.sampleRate, {
      mode: $('beatMode').value, sensitivity: ($('beatSens').value - 1) / 9,
      minInterval: Number($('beatMin').value) || 0.25
    });
    $('bpmBadge').hidden = !S.beats.bpm;
    $('bpmBadge').textContent = S.beats.bpm ? Math.round(S.beats.bpm) + ' BPM' : '';
  }

  function cadence() { return D.CADENCES[S.cadence] || D.CADENCES.normal; }

  /** Recalcule le plan (sans toucher à Premiere) et l'affiche sur la forme d'onde. */
  function updatePlan() {
    S.plan = null;
    if (!S.ctx || !S.beats || !S.audio) { syncOverlay(); return; }
    var beats = S.beats.beats.map(function (b) { return seqTime(b.time); });
    S.plan = D.planMulticam({
      beats: beats, range: S.ctx.range, tracks: S.ctx.tracks, every: cadence().every,
      order: $('beatOrder').value, fps: 1 / S.ctx.frame, seed: 7
    });
    var counts = {};
    S.plan.segments.forEach(function (s) { if (s.keep !== null) counts[s.keep] = (counts[s.keep] || 0) + 1; });
    $('beatLegend').innerHTML = S.ctx.tracks.slice().reverse().map(function (t) {
      return '<span><i style="background:' + TRACK_COLORS[t.index % TRACK_COLORS.length] + '"></i>' + t.name + ' · ' + (counts[t.index] || 0) + '</span>';
    }).join('');
    $('beatResult').textContent = S.plan.cuts.length
      ? S.plan.cuts.length + ' coupes · ' + S.plan.segments.length + ' plans de ' + n2((S.ctx.range.end - S.ctx.range.start) / S.plan.segments.length, 2) + ' s en moyenne (cadence ' + cadence().label + ').'
      : 'Aucun temps exploitable entre ' + fmt(S.ctx.range.start) + ' et ' + fmt(S.ctx.range.end) + ' : vérifiez que la musique couvre les rushes, ou essayez une autre cadence.';
    syncOverlay();
    refreshButtons();
  }

  function planOverlay() {
    if (!S.plan) return { beats: S.beats ? S.beats.beats : [], segments: [] };
    return {
      beats: S.plan.cuts.map(function (t) { return { time: localTime(t), strength: 1 }; }),
      segments: S.plan.segments.filter(function (s) { return s.keep !== null; }).map(function (s) {
        return { start: localTime(s.start), end: localTime(s.end), color: TRACK_COLORS[s.keep % TRACK_COLORS.length] };
      })
    };
  }

  async function loadBeatCutContext() {
    var ctx = await Bridge.call('getBeatCutContext'), m = ctx.music;
    var same = S.clip && S.audio && S.clip.mediaPath === m.mediaPath && Math.abs(S.clip.start - m.start) < 1e-3 && Math.abs(S.clip.inPoint - m.inPoint) < 1e-3;
    if (!same) {
      if (!Bridge.inCEP) throw new Error('Mode navigateur : ouvrez d’abord le fichier de musique.');
      status('Décodage de la musique « ' + m.name + ' »…', 'busy');
      await nextFrame();
      var audio = await A.loadPath(m.mediaPath, m.inPoint, m.outPoint, { ffmpegPath: $('ffmpegPath').value.trim() });
      setSource({ name: m.name, mediaPath: m.mediaPath, mediaType: 'Audio', start: m.start, end: m.end, inPoint: m.inPoint, outPoint: m.outPoint,
        speed: m.speed, reversed: false, projectItemNodeId: m.projectItemNodeId, selectionCount: 1, sequence: ctx.sequence }, audio);
    } else {
      S.clip.sequence = ctx.sequence;
    }
    S.ctx = ctx;
    $('rushPill').textContent = ctx.rushCount + (ctx.rushCount > 1 ? ' rushes sélectionnés' : ' rush sélectionné') +
      ' (' + ctx.tracks.map(function (t) { return t.name; }).join(', ') + ') · musique : ' + m.name + (ctx.musicNote ? '\n' + ctx.musicNote : '');
    $('rushPill').classList.add('on');
    detectMusicBeats();
    updatePlan();
    return ctx;
  }

  function runBeatCut() {
    return task('Beat Cut', async function () {
      var ctx = await loadBeatCutContext();
      if (!S.plan || !S.plan.cuts.length) throw new Error($('beatResult').textContent || 'Aucune coupe possible.');
      var p = S.plan, removed = p.segments.reduce(function (n, s) {
        return n + (s.keep === null ? 0 : ctx.tracks.filter(function (t) { return t.index > s.keep; }).length);
      }, 0);
      var ok = await confirmDialog('Monter ' + ctx.rushCount + ' rushes au rythme ?',
        '<p>Cadence <b>' + cadence().label + '</b> (' + esc(cadence().hint) + ')' + (S.beats.bpm ? ', ≈ ' + Math.round(S.beats.bpm) + ' BPM' : '') +
        ' : <b>' + p.cuts.length + ' coupes</b> sur ' + ctx.tracks.map(function (t) { return t.name; }).join(', ') + ' dans <b>' + esc(ctx.sequence.name) + '</b>.</p>' +
        '<ul><li>Une <b>copie de sauvegarde</b> de la séquence est créée d’abord.</li>' +
        '<li>Jusqu’à ' + removed + ' morceaux seront retirés des pistes du dessus pour alterner les angles (aperçu en couleur sur la forme d’onde).</li>' +
        '<li>La musique et le son des rushes ne sont pas coupés. Les médias d’origine ne sont pas modifiés.</li>' +
        '<li><b>Expérimental</b> : la coupe utilise une commande interne non documentée de Premiere ; chaque coupe est vérifiée et, si une seule manque, rien n’est retiré.</li></ul>',
        'Sauvegarder puis monter');
      if (!ok) return 'Beat Cut annulé : rien n’a été modifié.';
      var r = await Bridge.call('beatCutMulticam', {
        sequenceId: ctx.sequence.id, tracks: ctx.tracks.map(function (t) { return t.index; }),
        cuts: p.cuts, segments: p.segments, markers: $('beatMarkersOpt').checked, backup: true
      });
      if (r.missing > 0) {
        throw new Error('Premiere n’a pas effectué ' + r.missing + ' coupe(s) sur ' + r.razored + ' (commande interne non disponible ?). Aucun morceau n’a été retiré' +
          (r.backup ? ' ; une copie de sauvegarde de la séquence se trouve dans le projet' : '') + '. Utilisez « Marqueurs seulement » puis coupez avec Ctrl+K.');
      }
      return 'Beat Cut terminé dans « ' + r.sequence + ' » : ' + r.razored + ' coupes, ' + r.removed + ' morceaux retirés' +
        (r.markers ? ', ' + r.markers + ' marqueurs' : '') + '.' + (r.skipped ? '\n' + r.skipped + ' morceau(x) laissé(s) en place (hors segment).' : '') +
        (r.backup ? '\nCopie de sauvegarde créée' + (r.backupName ? ' : « ' + r.backupName + ' »' : '') + '. Lancez la lecture pour vérifier.' : '') + simNote();
    });
  }

  /** Marqueurs seulement : sur les rushes sélectionnés (avec musique) ou, à défaut, sur le clip musical sélectionné. */
  function addBeatMarkers() {
    return task('Ajout des marqueurs', async function () {
      var times;
      try { await loadBeatCutContext(); } catch (e) {
        if (!/rush|pistes vidéo/.test(e.message)) throw e;
        S.ctx = null; S.plan = null;
        await ensureSource();
        detectMusicBeats();
        syncOverlay();
      }
      if (S.plan) times = S.plan.cuts;
      else {
        var every = cadence().every;
        times = S.beats.beats.map(function (b) { return seqTime(b.time); })
          .filter(function (t, i) { return i % every === 0 && t >= S.clip.start && t < S.clip.end - 0.02; });
      }
      if (!times.length) throw new Error('Aucun temps fort détecté dans la musique.');
      var seq = await requireSameSequence();
      var ok = await confirmDialog('Ajouter ' + times.length + ' marqueurs ?',
        '<p>Des marqueurs « Beat » (cadence ' + cadence().label + ') seront ajoutés dans <b>' + esc(seq.name) + '</b>, de ' + fmt(times[0]) + ' à ' + fmt(times[times.length - 1]) + '.</p><p>Aucun clip n’est coupé ni déplacé.</p>', 'Ajouter');
      if (!ok) return 'Ajout annulé : rien n’a été modifié.';
      var r = await Bridge.call('addMarkers', {
        sequenceId: seq.id,
        markers: times.map(function (t) { return { time: t, name: 'Beat', comment: 'Cadence – Beat Cut (' + cadence().label + ')' }; })
      });
      return r.created + ' marqueurs ajoutés à « ' + r.sequence + ' » (' + r.before + ' → ' + r.after + ').' + simNote();
    });
  }

  function selectCadence(name) {
    S.cadence = name;
    document.querySelectorAll('.cad').forEach(function (b) {
      var on = b.dataset.cadence === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    updatePlan();
  }

  // ---- Voice Cut
  function updateVoiceResult() {
    var on = S.regions.filter(function (r) { return r.enabled; });
    var cut = on.reduce(function (s, r) { return s + r.duration; }, 0);
    $('voiceResult').textContent = S.regions.length
      ? on.length + ' / ' + S.regions.length + ' passages retenus · ' + n2(cut) + ' s retirés sur ' + n2(S.audio.duration) + ' s (' + Math.round(100 * cut / S.audio.duration) + ' %)'
      : 'Aucun silence détecté avec ces réglages.';
    var list = $('voiceList');
    list.innerHTML = '';
    S.regions.forEach(function (r, i) {
      var li = document.createElement('li');
      li.innerHTML = '<label><input type="checkbox"' + (r.enabled ? ' checked' : '') + '> ' + fmt(seqTime(r.start)) + ' → ' + fmt(seqTime(r.end)) + ' <span class="muted">(' + n2(r.duration, 2) + ' s)</span></label>';
      li.querySelector('input').addEventListener('change', function (e) { toggleRegion(i, e.target.checked); });
      list.appendChild(li);
    });
    refreshButtons();
  }

  function toggleRegion(i, value) {
    if (!S.regions || !S.regions[i]) return;
    S.regions[i].enabled = value == null ? !S.regions[i].enabled : value;
    updateVoiceResult(); syncOverlay();
  }

  function analyzeVoice() {
    return task('Détection des silences', async function () {
      await ensureSource();
      S.regions = D.detectSilences(S.mono, S.audio.sampleRate, {
        thresholdDb: Number($('voiceThr').value), minSilence: Number($('voiceMin').value) || 0.5, padding: Number($('voicePad').value) || 0
      }).map(function (r) { r.enabled = true; return r; });
      syncOverlay(); updateVoiceResult();
      return 'Analyse terminée : ' + S.regions.length + ' passages proposés. Rien n’a été modifié.';
    });
  }

  function enabledRegions() { return (S.regions || []).filter(function (r) { return r.enabled; }); }

  function addSilenceMarkers() {
    return task('Marquage des silences', async function () {
      var seq = await requireSameSequence(), regs = enabledRegions();
      var ok = await confirmDialog('Marquer ' + regs.length + ' passages ?',
        '<p>Des marqueurs à durée « Silence » seront ajoutés dans <b>' + esc(seq.name) + '</b> sur chaque passage proposé.</p><p>Aucun clip n’est coupé ni déplacé.</p>', 'Marquer');
      if (!ok) return 'Marquage annulé : rien n’a été modifié.';
      var r = await Bridge.call('addMarkers', {
        sequenceId: seq.id,
        markers: regs.map(function (g) { return { time: seqTime(g.start), end: seqTime(g.end), name: 'Silence', comment: 'Cadence – Voice Cut : passage proposé à couper (' + n2(g.duration, 2) + ' s)' }; })
      });
      return r.created + ' marqueurs « Silence » ajoutés à « ' + r.sequence + ' ».' + simNote();
    });
  }

  function createCutSequence() {
    return task('Création de la séquence sans silences', async function () {
      await ensureSource();
      if (S.clip.speed !== 1) throw new Error('Clip avec changement de vitesse : séquence sans silences non disponible. Utilisez « Marquer les silences ».');
      var regs = enabledRegions(), keep = D.keptSegments(regs, S.audio.duration).map(function (s) {
        return { start: S.audio.offset + s.start, end: S.audio.offset + s.end };
      });
      var kept = keep.reduce(function (a, s) { return a + s.end - s.start; }, 0);
      var ok = await confirmDialog('Créer une nouvelle séquence ?',
        '<p>Une <b>nouvelle séquence</b> « ' + esc(S.clip.name) + ' – sans silences » sera créée avec ' + keep.length + ' segments (' + fmt(kept) + ' au lieu de ' + fmt(S.audio.duration) + ').</p>' +
        '<ul><li>La séquence d’origine n’est <b>pas modifiée</b>.</li><li>' + keep.length + ' sous-éléments seront ajoutés au chutier « Cadence – Voice Cut ».</li><li>Seul le clip analysé est repris (pas les autres pistes).</li></ul>', 'Créer');
      if (!ok) return 'Création annulée : rien n’a été modifié.';
      var r = await Bridge.call('createCutSequence', { projectItemNodeId: S.clip.projectItemNodeId, name: S.clip.name.replace(/\.[^.]+$/, ''), segments: keep });
      return 'Séquence « ' + r.sequenceName + ' » créée (' + r.segments + ' segments, chutier « ' + r.bin + ' »). Vérifiez les raccords à l’écoute.' + simNote();
    });
  }

  // ---- Améliorer la voix
  function buildEnhanceSteps() {
    var box = $('enhanceSteps');
    Object.keys(D.VOICE_STEPS).forEach(function (k) {
      var parts = D.VOICE_STEPS[k].split(' : ');
      var l = document.createElement('label');
      l.innerHTML = '<input type="checkbox" data-step="' + k + '" checked><span>' + esc(parts[0]) + '<small>' + esc(parts.slice(1).join(' : ')) + '</small></span>';
      box.appendChild(l);
    });
  }

  function runEnhance() {
    return task('Traitement de la voix', async function () {
      await ensureSource();
      var opts = {};
      document.querySelectorAll('#enhanceSteps input').forEach(function (i) { opts[i.dataset.step] = i.checked; });
      S.enhanced = D.processVoice(S.audio.channels, S.audio.sampleRate, opts);
      var r = S.enhanced.report;
      $('enhanceResult').textContent =
        'Appliqué : ' + (r.applied.map(function (s) { return s.description.split(' : ')[0]; }).join(' · ') || 'aucun traitement') +
        '\nAvant : crête ' + n2(r.before.peakDb) + ' dBFS, RMS ' + n2(r.before.rmsDb) + ' dBFS' +
        '\nAprès : crête ' + n2(r.after.peakDb) + ' dBFS, RMS ' + n2(r.after.rmsDb) + ' dBFS' +
        (r.noise && r.noise.skipped ? '\n' + r.noise.skipped : r.noise ? '\nBruit de fond estimé : ' + n2(r.noise.noiseDb) + ' dBFS' : '');
      syncOverlay();
      return 'Aperçu prêt : écoutez avant/après. Rien n’a été écrit ni importé.';
    });
  }

  async function saveAndImport(channels, suffix, place, label) {
    var dur = channels[0].length / S.audio.sampleRate, info = Bridge.inCEP ? await Bridge.call('ping') : Bridge.mock.ping();
    if (place && info.sequence && info.sequence.id !== S.clip.sequence.id) {
      throw new Error('La séquence active a changé depuis le chargement du clip : rouvrez « ' + S.clip.sequence.name + ' » ou décochez le placement.');
    }
    var ok = await confirmDialog(label,
      '<ul><li>Un nouveau fichier WAV (' + fmt(dur) + ') sera écrit ' + (Bridge.inCEP ? 'dans le dossier « Cadence_Rendus » à côté du projet' : '(téléchargement)') + '.</li>' +
      '<li>Il sera importé dans le chutier « Cadence – rendus ».</li>' +
      (place ? '<li>Il sera placé à ' + fmt(S.clip.start) + ' sur la première piste audio libre de <b>' + esc(S.clip.sequence.name) + '</b>. Coupez le son du clip d’origine pour comparer.</li>' : '<li>La séquence ne sera pas modifiée.</li>') +
      '<li>Le média d’origine n’est pas modifié.</li></ul>', 'Enregistrer');
    if (!ok) return 'Opération annulée : aucun fichier écrit.';
    var saved = await A.saveWav(S.clip.name, suffix, channels, S.audio.sampleRate, info.projectPath);
    var r = await Bridge.call('importRendered', { path: saved.path || saved.name, place: place, time: S.clip.start, duration: dur, sequenceId: S.clip.sequence.id });
    return 'Fichier enregistré : ' + (saved.path || saved.name) + '\nImporté dans « ' + r.bin + ' »' +
      (r.placed ? ', placé sur la piste ' + r.track + '.' : '.') + (r.placeError ? '\n' + r.placeError : '') + simNote();
  }

  // ---- Accélérer
  function speedValue() { return Number($('speedVal').value); }

  function applySpeedQE() {
    return task('Changement de vitesse', async function () {
      var seq = await requireSameSequenceOrAny(), sp = speedValue();
      var ok = await confirmDialog('Changer la vitesse à ×' + n2(sp, 2) + ' ?',
        '<p>Les clips <b>actuellement sélectionnés</b> dans <b>' + esc(seq.name) + '</b> seront passés à ×' + n2(sp, 2) + ' avec « conserver la hauteur audio » demandé.</p>' +
        '<ul><li><b>Expérimental</b> : commande interne non documentée d’Adobe (DOM QE).</li><li>Sans ondulation : un espace (accélération) ou un recouvrement refusé (ralenti) peut apparaître.</li><li>Annulez avec Édition &gt; Annuler (Ctrl+Z) si le résultat ne convient pas.</li></ul>', 'Appliquer');
      if (!ok) return 'Changement annulé : rien n’a été modifié.';
      var r = await Bridge.call('setClipSpeed', { sequenceId: seq.id, speed: sp });
      if (!r.results.length) throw new Error('Aucun clip sélectionné n’a pu être traité.');
      var good = r.results.filter(function (x) { return x.ok; });
      var lines = r.results.map(function (x) {
        return '• ' + x.name + ' : ' + (x.ok ? '×' + n2(x.before, 2) + ' → ×' + n2(x.after, 2) : 'échec' + (x.after != null ? ' (vitesse lue ×' + n2(x.after, 2) + ')' : '') + (x.error ? ' – ' + x.error : ''));
      }).join('\n');
      $('speedResult').textContent = lines + '\nVérifiez « Conserver la hauteur audio » dans Clip > Vitesse/Durée (Ctrl+R).';
      if (!good.length) throw new Error('La vitesse n’a pas été appliquée par Premiere. Utilisez Clip > Vitesse/Durée (Ctrl+R), ou l’option B ci-dessous.');
      return good.length + ' / ' + r.results.length + ' clip(s) passés à ×' + n2(sp, 2) + ' (vitesse relue et vérifiée).' + simNote();
    });
  }

  async function requireSameSequenceOrAny() {
    var info = await Bridge.call('ping');
    if (!info.sequence) throw new Error('Aucune séquence active dans Premiere Pro.');
    return info.sequence;
  }

  function renderStretch() {
    return task('Calcul de la version accélérée', async function () {
      await ensureSource();
      var sp = speedValue();
      S.stretched = { speed: sp, channels: D.timeStretch(S.audio.channels, S.audio.sampleRate, sp) };
      $('speedResult').textContent = 'Version ×' + n2(sp, 2) + ' : ' + fmt(S.audio.duration) + ' → ' + fmt(S.stretched.channels[0].length / S.audio.sampleRate) + ', hauteur conservée (WSOLA). Audio seulement : la vidéo n’est pas accélérée.';
      return 'Version accélérée prête : écoutez-la avant de l’enregistrer.';
    });
  }

  // ---- Importer
  function importMedia() {
    return task('Import de médias', async function () {
      var pick = await Bridge.call('chooseFiles');
      if (!pick.paths.length) return 'Import annulé.';
      var names = pick.paths.map(function (p) { return '<li>' + esc(p.split(/[\\/]/).pop()) + '</li>'; }).join('');
      var ok = await confirmDialog('Importer ' + pick.paths.length + ' fichier(s) ?', '<ul>' + names + '</ul><p>Les fichiers sont référencés par le projet, pas copiés ni modifiés.</p>', 'Importer');
      if (!ok) return 'Import annulé.';
      var r = await Bridge.call('importFiles', { paths: pick.paths });
      var rej = r.rejected && r.rejected.length ? '\nNon importés :\n' + r.rejected.map(function (x) { return '• ' + x.path.split(/[\\/]/).pop() + ' – ' + x.reason; }).join('\n') : '';
      if (!r.imported && !r.requested) throw new Error('Aucun fichier compatible.' + rej);
      return (r.imported > 0 ? r.imported + ' élément(s) importé(s) dans « ' + r.bin + ' ».' : 'Premiere n’a ajouté aucun élément (fichiers déjà présents ou illisibles ?).') + rej + simNote();
    });
  }

  // ---- Effacer les marqueurs
  function clearMarkers() {
    return task('Lecture des marqueurs', async function () {
      var c = await Bridge.call('countMarkers');
      if (!c.count) return 'La séquence « ' + c.sequence + ' » ne contient aucun marqueur.';
      var ok = await confirmDialog('Effacer ' + c.count + ' marqueur(s) ?',
        '<p>Tous les marqueurs de la séquence active <b>' + esc(c.sequence) + '</b> seront supprimés.</p><ul><li>Les marqueurs des clips et des autres séquences ne sont pas touchés.</li><li>Enregistrez le projet avant si vous voulez pouvoir revenir en arrière.</li></ul>', 'Effacer');
      if (!ok) return 'Suppression annulée : aucun marqueur effacé.';
      var r = await Bridge.call('clearMarkers', { sequenceId: c.sequenceId });
      return r.deleted + ' marqueur(s) effacé(s) dans « ' + r.sequence + ' »' + (r.remaining ? ' – ' + r.remaining + ' restant(s) !' : '.') + simNote();
    });
  }

  // ------------------------------------------------------------------ lecture
  var raf = null;
  function play(channels, opts) {
    A.player.stop(); cancelAnimationFrame(raf);
    A.player.play(channels, S.audio.sampleRate, opts);
    var follow = opts && opts.follow;
    A.player.onEnd = function () { wave.playhead = null; wave.draw(); };
    (function tick() {
      var p = A.player.position();
      if (p == null) { wave.playhead = null; wave.draw(); return; }
      wave.playhead = follow ? Math.min(p, S.audio.duration) : null;
      $('timeInfo').textContent = fmt(p) + ' / ' + fmt(A.player.duration);
      wave.draw();
      raf = requestAnimationFrame(tick);
    }());
  }
  function stop() { A.player.stop(); cancelAnimationFrame(raf); wave.playhead = null; wave.draw(); $('timeInfo').textContent = ''; }

  // ------------------------------------------------------------------ diagnostic
  async function renderDiag() {
    var env = S.env, lines = [
      'Environnement : ' + env.label,
      'Accès fichiers (Node.js) : ' + (A.hasNode ? 'oui' : 'non'),
      'Hors connexion : oui (aucune requête réseau)'
    ];
    if (env.inCEP) {
      lines.push('Dossier de l’extension : ' + env.extensionPath);
      if (env.appName !== 'PPRO') lines.push('⚠ Hôte inattendu : ' + env.appName);
      if (!/^23\./.test(env.appVersion || '')) lines.push('⚠ Version testée pour Premiere 23.x ; détectée : ' + env.appVersion);
    }
    try {
      var p = await Bridge.call('ping');
      lines.push('Script hôte : ' + p.hostScript + ' · Premiere ' + p.appVersion);
      lines.push('Séquence active : ' + (p.sequence ? p.sequence.name + ' (' + p.sequence.markers + ' marqueurs)' : 'aucune'));
    } catch (e) { lines.push('Script hôte : ERREUR – ' + e.message); }
    $('diag').textContent = lines.join('\n');
  }

  // ------------------------------------------------------------------ branchements
  function init() {
    document.body.classList.add(Bridge.inCEP ? 'cep' : 'browser');
    document.querySelectorAll('.only-cep').forEach(function (e) { e.hidden = !Bridge.inCEP; });
    document.querySelectorAll('.only-browser').forEach(function (e) { e.hidden = Bridge.inCEP; });
    $('envBadge').textContent = S.env.label;
    $('envBadge').classList.toggle('sim', !Bridge.inCEP);
    if (!Bridge.inCEP) $('waveEmpty').textContent = 'Mode navigateur : ouvrez un fichier audio (WAV, MP3…) pour tester les analyses';

    try { $('ffmpegPath').value = localStorage.getItem('cadence.ffmpeg') || ''; } catch (e) { /* stockage indisponible */ }
    $('ffmpegPath').addEventListener('change', function () { try { localStorage.setItem('cadence.ffmpeg', this.value.trim()); } catch (e) { /* ignoré */ } });

    $('btnLoadClip').addEventListener('click', loadSelectedClip);
    $('fileInput').addEventListener('change', function () { if (this.files[0]) loadBrowserFile(this.files[0]); this.value = ''; });
    $('btnPlay').addEventListener('click', function () { if (S.audio) play(S.audio.channels, { follow: true }); });
    $('btnStop').addEventListener('click', stop);

    document.querySelectorAll('.tool[data-tool]').forEach(function (b) { b.addEventListener('click', function () { selectTool(b.dataset.tool); }); });
    document.querySelector('[data-action=import]').addEventListener('click', importMedia);
    document.querySelector('[data-action=markers]').addEventListener('click', clearMarkers);

    $('beatSens').addEventListener('input', function () { $('beatSensOut').textContent = this.value; });
    $('beatGo').addEventListener('click', runBeatCut);
    document.querySelectorAll('.cad').forEach(function (b) { b.addEventListener('click', function () { selectCadence(b.dataset.cadence); }); });
    $('beatOrder').addEventListener('change', updatePlan);
    ['beatMode', 'beatSens', 'beatMin'].forEach(function (id) { $(id).addEventListener('change', function () { if (S.audio && S.beats) { detectMusicBeats(); updatePlan(); } }); });
    $('beatPreview').addEventListener('click', function () { play(S.audio.channels, { follow: true, clicks: planOverlay().beats.map(function (b) { return b.time; }) }); });
    $('beatMarkers').addEventListener('click', addBeatMarkers);

    $('voiceThr').addEventListener('input', function () { $('voiceThrOut').textContent = this.value + ' dB'; });
    $('voiceSuggest').addEventListener('click', function () {
      task('Calcul du seuil', async function () {
        await ensureSource();
        var s = D.suggestThreshold(S.mono, S.audio.sampleRate);
        $('voiceThr').value = s.thresholdDb; $('voiceThrOut').textContent = s.thresholdDb + ' dB';
        return 'Seuil suggéré : ' + s.thresholdDb + ' dB (bruit de fond ≈ ' + Math.round(s.noiseDb) + ' dB, parole ≈ ' + Math.round(s.speechDb) + ' dB).';
      });
    });
    $('voiceAnalyze').addEventListener('click', analyzeVoice);
    $('voicePreview').addEventListener('click', function () {
      var segs = D.keptSegments(enabledRegions(), S.audio.duration);
      play(A.buildCutPreview(S.audio.channels, S.audio.sampleRate, segs), {});
    });
    $('voiceMarkers').addEventListener('click', addSilenceMarkers);
    $('voiceSequence').addEventListener('click', createCutSequence);
    wave.onRegionClick = function (i) { if (S.tool === 'voice') toggleRegion(i); };

    buildEnhanceSteps();
    $('enhanceRun').addEventListener('click', runEnhance);
    $('enhanceListenA').addEventListener('click', function () { play(S.audio.channels, { follow: true }); });
    $('enhanceListenB').addEventListener('click', function () { play(S.enhanced.channels, { follow: true }); });
    $('enhanceSave').addEventListener('click', function () {
      task('Enregistrement', function () { return saveAndImport(S.enhanced.channels, 'voix', $('enhancePlace').checked && S.clip.speed === 1, 'Enregistrer la voix traitée ?'); });
    });

    $('speedVal').addEventListener('input', function () { $('speedOut').textContent = '×' + n2(this.value, 2); S.stretched = null; refreshButtons(); });
    $('speedApply').addEventListener('click', applySpeedQE);
    $('speedRender').addEventListener('click', renderStretch);
    $('speedListen').addEventListener('click', function () { play(S.stretched.channels, {}); });
    $('speedSave').addEventListener('click', function () {
      task('Enregistrement', function () { return saveAndImport(S.stretched.channels, 'x' + String(S.stretched.speed).replace('.', '_'), $('speedPlace').checked, 'Enregistrer la version accélérée ?'); });
    });

    refreshButtons();
    renderDiag();
    status(Bridge.inCEP ? 'Prêt. Sélectionnez un clip dans la séquence active.' : 'Mode navigateur : les actions Premiere sont simulées et signalées comme telles.');
  }

  root.CadenceApp = { state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}(window));
