/*
 * Cadence – pont entre le panneau HTML et Premiere Pro (ExtendScript via CEP).
 * Hors de Premiere (navigateur), un hôte SIMULÉ permet de tester l'interface ; il ne touche à rien.
 */
(function (root) {
  'use strict';

  var cep = root.__adobe_cep__;
  var inCEP = !!(cep && typeof cep.evalScript === 'function');

  function systemPath(type) {
    var p = decodeURI(cep.getSystemPath(type));
    // même normalisation que CSInterface.getSystemPath()
    return /^file:\/\/\/[A-Za-z]:/.test(p) ? p.replace('file:///', '') : p.replace('file://', '');
  }

  function evalScript(script) {
    return new Promise(function (resolve) { cep.evalScript(script, resolve); });
  }

  function ensureHostScript() {
    return evalScript('typeof cadence === "object" && typeof cadence.ping === "function"').then(function (r) {
      if (r === 'true') return;
      var path = (systemPath('extension') + '/jsx/host.jsx').replace(/\\/g, '/');
      return evalScript('$.evalFile(' + JSON.stringify(path) + ')').then(function (r2) {
        if (r2 === 'EvalScript error.') throw new Error('Le script hôte (jsx/host.jsx) n’a pas pu être chargé dans Premiere Pro.');
      });
    });
  }

  var ready = null;

  function callCEP(fn, args) {
    ready = ready || ensureHostScript();
    return ready.then(function () {
      var payload = JSON.stringify(args || {}).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      return evalScript('cadence.' + fn + '(' + payload + ')');
    }).then(function (res) {
      if (res === 'EvalScript error.' || res === undefined || res === '') {
        throw new Error('Premiere Pro n’a pas pu exécuter « ' + fn + ' » (EvalScript error). Voir le guide de dépannage.');
      }
      var parsed;
      try { parsed = JSON.parse(res); } catch (e) { throw new Error('Réponse inattendue de Premiere Pro : ' + String(res).slice(0, 200)); }
      if (!parsed.ok) throw new Error(parsed.error || 'Erreur inconnue côté Premiere Pro.');
      return parsed.data;
    });
  }

  // ------------------------------------------------------------------ hôte simulé
  var mock = {
    sequence: { name: 'Séquence de démonstration', id: 'demo-1', markers: [] },
    clip: null,
    log: [],
    ping: function () {
      return { hostScript: 'simulation', appVersion: '— (navigateur)', projectName: 'Projet simulé', projectPath: null,
        sequence: { name: this.sequence.name, id: this.sequence.id, markers: this.sequence.markers.length } };
    },
    getSelectedClip: function () {
      if (!this.clip) throw new Error('Aucun fichier chargé : en mode navigateur, choisissez un fichier audio avec « Ouvrir un fichier ».');
      return this.clip;
    },
    countMarkers: function () { return { sequence: this.sequence.name, sequenceId: this.sequence.id, count: this.sequence.markers.length }; },
    addMarkers: function (a) {
      var before = this.sequence.markers.length;
      this.sequence.markers = this.sequence.markers.concat(a.markers);
      return { created: a.markers.length, before: before, after: this.sequence.markers.length, sequence: this.sequence.name };
    },
    clearMarkers: function () {
      var n = this.sequence.markers.length;
      this.sequence.markers = [];
      return { sequence: this.sequence.name, before: n, deleted: n, remaining: 0 };
    },
    razorAtTimes: function (a) { return { backup: true, cuts: a.times.length, timecodes: [], clipsBefore: 1, clipsAfter: 1 + a.times.length }; },
    createCutSequence: function (a) { return { sequenceName: (a.name || 'Clip') + ' – sans silences', segments: a.segments.length, bin: 'Cadence – Voice Cut' }; },
    chooseFiles: function () { return { paths: ['C:/Médias/demo_interview.mp4', 'C:/Médias/musique.wav', 'C:/Médias/notes.txt'] }; },
    importFiles: function (a) {
      var ok = a.paths.filter(function (p) { return !/\.txt$/i.test(p); });
      return { requested: ok.length, imported: ok.length, result: true, bin: 'Projet simulé',
        rejected: a.paths.filter(function (p) { return /\.txt$/i.test(p); }).map(function (p) { return { path: p, reason: 'extension .txt non prise en charge par ce panneau' }; }) };
    },
    importRendered: function (a) { return { imported: true, name: a.path, bin: 'Cadence – rendus', placed: !!a.place, track: a.place ? 'A2' : undefined }; },
    setClipSpeed: function (a) { return { requested: a.speed, results: [{ name: 'clip simulé', before: 1, after: a.speed, ok: true }] }; }
  };

  function callMock(fn, args) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          if (typeof mock[fn] !== 'function') throw new Error('Fonction inconnue : ' + fn);
          mock.log.push({ fn: fn, args: args });
          resolve(JSON.parse(JSON.stringify(mock[fn](args || {}))));
        } catch (e) { reject(e); }
      }, 30);
    });
  }

  function environment() {
    if (!inCEP) return { inCEP: false, label: 'Mode navigateur – Premiere simulé' };
    var env = {}, api = {};
    try { env = JSON.parse(cep.getHostEnvironment()); } catch (e) { /* ignoré */ }
    try { api = JSON.parse(cep.getCurrentApiVersion()); } catch (e) { /* ignoré */ }
    return {
      inCEP: true,
      appName: env.appName, appVersion: env.appVersion, locale: env.appUILocale,
      cep: api.major != null ? api.major + '.' + api.minor + '.' + api.micro : '?',
      extensionPath: systemPath('extension'),
      label: (env.appName || 'Hôte') + ' ' + (env.appVersion || '') + ' · CEP ' + (api.major != null ? api.major + '.' + api.minor : '?')
    };
  }

  root.CadenceBridge = {
    inCEP: inCEP,
    call: inCEP ? callCEP : callMock,
    environment: environment,
    mock: mock
  };
}(window));
