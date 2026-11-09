/*
 * Cadence \u2013 script h\u00f4te ExtendScript pour Adobe Premiere Pro 2023 (23.x).
 * ExtendScript = ECMAScript 3 : pas de let/const, de fonctions fl\u00e9ch\u00e9es, de JSON natif ni d'Array.indexOf.
 *
 * Chaque fonction publique renvoie une cha\u00eene JSON : {"ok":true,"data":...} ou {"ok":false,"error":"..."}.
 * Les fonctions marqu\u00e9es \u00ab QE \u00bb utilisent le DOM QE de Premiere, NON document\u00e9 et NON pris en charge
 * par Adobe : leur effet est v\u00e9rifi\u00e9 apr\u00e8s coup avec l'API officielle quand c'est possible.
 */
var cadence = (function () {
    var TICKS_PER_SECOND = 254016000000;
    var VERSION = '0.2.3';
    var IMPORT_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mxf', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', '3gp',
        'wav', 'mp3', 'aac', 'm4a', 'aif', 'aiff', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'psd', 'gif', 'bmp'];

    // ------------------------------------------------------------ JSON minimal (ES3)
    function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

    function quote(s) {
        return '"' + String(s).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
            if (c === '"') { return '\\"'; }
            if (c === '\\') { return '\\\\'; }
            if (c === '\n') { return '\\n'; }
            if (c === '\r') { return '\\r'; }
            if (c === '\t') { return '\\t'; }
            var h = c.charCodeAt(0).toString(16);
            return '\\u' + '0000'.substr(h.length) + h;
        }) + '"';
    }

    function toJson(v) {
        var i, parts, k;
        if (v === null || v === undefined) { return 'null'; }
        if (typeof v === 'number') { return isFinite(v) ? String(v) : 'null'; }
        if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
        if (typeof v === 'string') { return quote(v); }
        if (isArray(v)) {
            parts = [];
            for (i = 0; i < v.length; i++) { parts.push(toJson(v[i])); }
            return '[' + parts.join(',') + ']';
        }
        parts = [];
        for (k in v) {
            if (v.hasOwnProperty(k) && typeof v[k] !== 'function') { parts.push(quote(k) + ':' + toJson(v[k])); }
        }
        return '{' + parts.join(',') + '}';
    }

    // ------------------------------------------------------------ erreurs
    function UserError(message) { this.message = message; this.isUserError = true; }

    function fail(message) { throw new UserError(message); }

    function run(impl, args) {
        try {
            return toJson({ ok: true, data: impl(args || {}) });
        } catch (e) {
            var msg;
            if (e && e.isUserError) {
                msg = e.message;
            } else {
                msg = 'Erreur renvoy\u00e9e par Premiere Pro : ' + (e && e.message ? e.message : String(e)) +
                    (e && e.line ? ' (ligne ' + e.line + ' du script h\u00f4te)' : '');
            }
            return toJson({ ok: false, error: msg });
        }
    }

    // ------------------------------------------------------------ utilitaires
    function contains(arr, v) {
        for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return true; } }
        return false;
    }

    function num(v, label) {
        var n = Number(v);
        if (isNaN(n) || !isFinite(n)) { fail('Valeur num\u00e9rique invalide : ' + label + '.'); }
        return n;
    }

    // createSubClip attend des objets Time (cf. exemple officiel PProPanel), pas des cha\u00eenes de ticks.
    function timeAt(seconds) {
        var t = new Time();
        t.ticks = String(Math.round(seconds * TICKS_PER_SECOND));
        return t;
    }

    function requireProject() {
        if (!app.project) { fail('Aucun projet Premiere Pro n\u2019est ouvert.'); }
        return app.project;
    }

    function activeSequence(expectedId) {
        var seq = requireProject().activeSequence;
        if (!seq) { fail('Aucune s\u00e9quence active. Ouvrez une s\u00e9quence dans le panneau Montage, cliquez dedans, puis r\u00e9essayez.'); }
        if (expectedId && String(seq.sequenceID) !== String(expectedId)) {
            fail('La s\u00e9quence active a chang\u00e9 depuis l\u2019analyse (\u00ab ' + seq.name + ' \u00bb). Rien n\u2019a \u00e9t\u00e9 modifi\u00e9 : relancez l\u2019op\u00e9ration.');
        }
        return seq;
    }

    function countClips(seq) {
        var n = 0, i;
        for (i = 0; i < seq.videoTracks.numTracks; i++) { n += seq.videoTracks[i].clips.numItems; }
        for (i = 0; i < seq.audioTracks.numTracks; i++) { n += seq.audioTracks[i].clips.numItems; }
        return n;
    }

    function locateTrackItem(seq, item) {
        var kinds = [['video', seq.videoTracks], ['audio', seq.audioTracks]], k, t, c, clips;
        for (k = 0; k < kinds.length; k++) {
            for (t = 0; t < kinds[k][1].numTracks; t++) {
                clips = kinds[k][1][t].clips;
                for (c = 0; c < clips.numItems; c++) {
                    if (clips[c].nodeId === item.nodeId) { return { type: kinds[k][0], trackIndex: t, clipIndex: c }; }
                }
            }
        }
        return null;
    }

    function trackItemAt(seq, pos) {
        var tracks = pos.type === 'video' ? seq.videoTracks : seq.audioTracks;
        return tracks[pos.trackIndex].clips[pos.clipIndex];
    }

    function findProjectItem(bin, nodeId) {
        var i, child, found;
        for (i = 0; i < bin.children.numItems; i++) {
            child = bin.children[i];
            if (child.nodeId === nodeId) { return child; }
            if (child.type === ProjectItemType.BIN) {
                found = findProjectItem(child, nodeId);
                if (found) { return found; }
            }
        }
        return null;
    }

    function getOrCreateBin(name) {
        var root = app.project.rootItem, i;
        for (i = 0; i < root.children.numItems; i++) {
            if (root.children[i].type === ProjectItemType.BIN && root.children[i].name === name) { return root.children[i]; }
        }
        root.createBin(name);
        for (i = 0; i < root.children.numItems; i++) {
            if (root.children[i].type === ProjectItemType.BIN && root.children[i].name === name) { return root.children[i]; }
        }
        fail('Impossible de cr\u00e9er le chutier \u00ab ' + name + ' \u00bb.');
    }

    function normPath(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }

    function findByMediaPath(bin, path) {
        var target = normPath(path), i, child;
        for (i = 0; i < bin.children.numItems; i++) {
            child = bin.children[i];
            try {
                if (child.type !== ProjectItemType.BIN && normPath(child.getMediaPath()) === target) { return child; }
            } catch (e) { /* \u00e9l\u00e9ment sans chemin m\u00e9dia */ }
        }
        return null;
    }

    function extensionOf(path) {
        var m = /\.([^.\\\/]+)$/.exec(String(path));
        return m ? m[1].toLowerCase() : '';
    }

    function formatTimecode(seq, seconds) {
        var t = new Time();
        t.seconds = seconds;
        return t.getFormatted(seq.getSettings().videoFrameRate, seq.videoDisplayFormat);
    }

    // ------------------------------------------------------------ fonctions
    function ping() {
        var seq = app.project ? app.project.activeSequence : null;
        return {
            hostScript: VERSION,
            appVersion: app.version,
            build: app.build,
            projectName: app.project ? app.project.name : null,
            projectPath: app.project ? app.project.path : null,
            sequence: seq ? { name: seq.name, id: String(seq.sequenceID), markers: seq.markers.numMarkers } : null
        };
    }

    function getSelectedClip() {
        var seq = activeSequence(), sel = seq.getSelection(), item = null, i;
        if (!sel || sel.length === 0) {
            fail('Aucun clip s\u00e9lectionn\u00e9. Cliquez sur un clip (audio ou vid\u00e9o avec son) dans la s\u00e9quence \u00ab ' + seq.name + ' \u00bb.');
        }
        for (i = 0; i < sel.length; i++) { if (sel[i].mediaType === 'Audio') { item = sel[i]; break; } }
        if (!item) { item = sel[0]; }
        var pi = item.projectItem;
        if (!pi) { fail('Le clip s\u00e9lectionn\u00e9 n\u2019a pas de m\u00e9dia source (titre, calque d\u2019effets, s\u00e9quence imbriqu\u00e9e\u2026).'); }
        var path = '';
        try { path = pi.getMediaPath(); } catch (e) { path = ''; }
        if (!path) { fail('Impossible d\u2019obtenir le fichier du clip \u00ab ' + item.name + ' \u00bb (m\u00e9dia hors ligne, s\u00e9quence imbriqu\u00e9e ou \u00e9l\u00e9ment g\u00e9n\u00e9r\u00e9).'); }
        var reversed = false;
        try { reversed = !!item.isSpeedReversed(); } catch (e2) { reversed = false; }
        return {
            name: item.name,
            mediaPath: path,
            mediaType: item.mediaType,
            start: item.start.seconds,
            end: item.end.seconds,
            inPoint: item.inPoint.seconds,
            outPoint: item.outPoint.seconds,
            speed: item.getSpeed(),
            reversed: reversed,
            nodeId: item.nodeId,
            projectItemNodeId: pi.nodeId,
            position: locateTrackItem(seq, item),
            selectionCount: sel.length,
            sequence: { name: seq.name, id: String(seq.sequenceID) }
        };
    }

    function countMarkers() {
        var seq = activeSequence();
        return { sequence: seq.name, sequenceId: String(seq.sequenceID), count: seq.markers.numMarkers };
    }

    function addMarkers(a) {
        var seq = activeSequence(a.sequenceId), list = a.markers || [], before = seq.markers.numMarkers, created = 0, i, m, t;
        if (!isArray(list) || list.length === 0) { fail('Aucun marqueur \u00e0 ajouter.'); }
        if (list.length > 2000) { fail('Trop de marqueurs (' + list.length + ') : 2000 au maximum par op\u00e9ration.'); }
        for (i = 0; i < list.length; i++) {
            t = num(list[i].time, 'temps du marqueur');
            if (t < 0) { continue; }
            m = seq.markers.createMarker(t);
            if (!m) { continue; }
            m.name = String(list[i].name || 'Cadence');
            if (list[i].comment) { m.comments = String(list[i].comment); }
            if (list[i].end !== undefined && num(list[i].end, 'fin du marqueur') > t) { m.end = num(list[i].end, 'fin du marqueur'); }
            created++;
        }
        return { created: created, before: before, after: seq.markers.numMarkers, sequence: seq.name };
    }

    function clearMarkers(a) {
        var seq = activeSequence(a.sequenceId), markers = seq.markers, before = markers.numMarkers, guard = 0, m;
        while (markers.numMarkers > 0 && guard < 100000) {
            m = markers.getFirstMarker();
            if (!m) { break; }
            markers.deleteMarker(m);
            guard++;
        }
        return { sequence: seq.name, before: before, deleted: before - markers.numMarkers, remaining: markers.numMarkers };
    }

    /** API officielle : cr\u00e9e une NOUVELLE s\u00e9quence faite des segments conserv\u00e9s (la s\u00e9quence d'origine n'est pas touch\u00e9e). */
    function createCutSequence(a) {
        requireProject();
        var segs = a.segments || [], i;
        if (!isArray(segs) || segs.length === 0) { fail('Aucun segment \u00e0 conserver.'); }
        if (segs.length > 500) { fail('Trop de segments (' + segs.length + ') : 500 au maximum.'); }
        var pi = findProjectItem(app.project.rootItem, a.projectItemNodeId);
        if (!pi) { fail('Le m\u00e9dia source n\u2019a pas \u00e9t\u00e9 retrouv\u00e9 dans le projet (supprim\u00e9 ou d\u00e9plac\u00e9 ?).'); }
        var base = String(a.name || pi.name), bin = getOrCreateBin('Cadence \u2013 Voice Cut'), subs = [];
        for (i = 0; i < segs.length; i++) {
            var s = num(segs[i].start, 'd\u00e9but de segment'), e = num(segs[i].end, 'fin de segment');
            if (e <= s) { continue; }
            var sub = pi.createSubClip(base + ' \u2013 ' + (i + 1), timeAt(s), timeAt(e), 1, 1, 1);
            if (!sub) { fail('Cr\u00e9ation du sous-\u00e9l\u00e9ment ' + (i + 1) + ' impossible.'); }
            try { sub.moveBin(bin); } catch (err) { /* le sous-\u00e9l\u00e9ment reste \u00e0 la racine */ }
            subs.push(sub);
        }
        var seqName = base + ' \u2013 sans silences';
        app.project.createNewSequenceFromClips(seqName, subs, bin);
        var found = false;
        for (i = 0; i < app.project.sequences.numSequences; i++) {
            if (app.project.sequences[i].name === seqName) { found = true; }
        }
        if (!found) { fail('Premiere n\u2019a pas cr\u00e9\u00e9 la s\u00e9quence \u00ab ' + seqName + ' \u00bb. Les sous-\u00e9l\u00e9ments sont dans le chutier \u00ab Cadence \u2013 Voice Cut \u00bb.'); }
        return { sequenceName: seqName, segments: subs.length, bin: 'Cadence \u2013 Voice Cut' };
    }

    function chooseFiles() {
        var filter = Folder.fs === 'Windows'
            ? 'M\u00e9dias:*.' + IMPORT_EXTENSIONS.join(';*.') + ',Tous les fichiers:*.*'
            : null;
        var files = File.openDialog('Importer des m\u00e9dias dans le projet', filter, true), out = [], i;
        if (!files) { return { paths: [] }; }
        if (!isArray(files) && files.length === undefined) { files = [files]; }
        for (i = 0; i < files.length; i++) { out.push(files[i].fsName); }
        return { paths: out };
    }

    function importFiles(a) {
        requireProject();
        var paths = a.paths || [], ok = [], rejected = [], i, f;
        for (i = 0; i < paths.length; i++) {
            f = new File(paths[i]);
            if (!f.exists) { rejected.push({ path: paths[i], reason: 'fichier introuvable' }); }
            else if (!contains(IMPORT_EXTENSIONS, extensionOf(paths[i]))) { rejected.push({ path: paths[i], reason: 'extension .' + extensionOf(paths[i]) + ' non prise en charge par ce panneau' }); }
            else { ok.push(f.fsName); }
        }
        if (ok.length === 0) { return { imported: 0, rejected: rejected }; }
        var bin = app.project.getInsertionBin ? app.project.getInsertionBin() : app.project.rootItem;
        var before = bin.children.numItems;
        var result = app.project.importFiles(ok, true, bin, false);
        return { requested: ok.length, imported: bin.children.numItems - before, result: !!result, rejected: rejected, bin: bin.name };
    }

    /** Importe un fichier rendu par le panneau et, sur demande, le place sur une piste audio libre. */
    function importRendered(a) {
        requireProject();
        var path = String(a.path || '');
        if (!path || !(new File(path)).exists) { fail('Fichier rendu introuvable : ' + path); }
        var bin = getOrCreateBin('Cadence \u2013 rendus');
        app.project.importFiles([path], true, bin, false);
        var item = findByMediaPath(bin, path);
        if (!item) { fail('Premiere n\u2019a pas import\u00e9 le fichier : ' + path); }
        var res = { imported: true, name: item.name, bin: bin.name, placed: false };
        if (!a.place) { return res; }
        var seq = activeSequence(a.sequenceId), t0 = num(a.time, 'position'), t1 = t0 + num(a.duration, 'dur\u00e9e'), i, c;
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            var track = seq.audioTracks[i], free = true;
            for (c = 0; c < track.clips.numItems; c++) {
                if (track.clips[c].start.seconds < t1 && track.clips[c].end.seconds > t0) { free = false; break; }
            }
            if (free) {
                track.overwriteClip(item, t0);
                res.placed = true;
                res.track = 'A' + (i + 1);
                return res;
            }
        }
        res.placeError = 'Aucune piste audio libre sur cette plage : le fichier est import\u00e9 dans le chutier \u00ab ' + bin.name + ' \u00bb mais n\u2019a pas \u00e9t\u00e9 plac\u00e9. Ajoutez une piste audio puis glissez-le.';
        return res;
    }

    /** QE (non document\u00e9) : change la vitesse des clips s\u00e9lectionn\u00e9s, puis v\u00e9rifie avec getSpeed(). */
    function setClipSpeed(a) {
        var seq = activeSequence(a.sequenceId), speed = num(a.speed, 'vitesse'), sel = seq.getSelection(), results = [], i, j;
        if (speed < 0.1 || speed > 10) { fail('Vitesse hors limites (\u00d70,1 \u00e0 \u00d710).'); }
        if (!sel || sel.length === 0) { fail('Aucun clip s\u00e9lectionn\u00e9 dans la s\u00e9quence.'); }
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        if (!qs) { fail('Le DOM QE ne trouve pas la s\u00e9quence active.'); }
        for (i = 0; i < sel.length; i++) {
            var item = sel[i], pos = locateTrackItem(seq, item), oldSpeed = item.getSpeed();
            if (!pos) { continue; }
            var qTrack = pos.type === 'video' ? qs.getVideoTrackAt(pos.trackIndex) : qs.getAudioTrackAt(pos.trackIndex);
            var qItem = null, n = -1;
            for (j = 0; j < qTrack.numItems; j++) {
                var it = qTrack.getItemAt(j);
                if (it.type === 'Empty') { continue; }
                n++;
                if (n === pos.clipIndex) { qItem = it; break; }
            }
            if (!qItem || qItem.name !== item.name) {
                results.push({ name: item.name, ok: false, error: 'clip introuvable dans le DOM QE' });
                continue;
            }
            var newDur = (item.end.seconds - item.start.seconds) * oldSpeed / speed;
            try {
                qItem.setSpeed(speed, formatTimecode(seq, newDur), false, false, true);
            } catch (e) {
                results.push({ name: item.name, ok: false, before: oldSpeed, error: String(e.message || e) });
                continue;
            }
            var after = trackItemAt(seq, pos).getSpeed();
            results.push({ name: item.name, before: oldSpeed, after: after, ok: Math.abs(after - speed) < 0.01 });
        }
        return { requested: speed, results: results };
    }

    // ------------------------------------------------------------ Beat Cut multicam
    function sequenceNames() {
        var out = [], s = app.project.sequences, i;
        for (i = 0; i < s.numSequences; i++) { out.push(s[i].name); }
        return out;
    }

    function newSequenceName(before) {
        var now = sequenceNames(), i;
        for (i = 0; i < now.length; i++) { if (!contains(before, now[i])) { return now[i]; } }
        return now.length > before.length ? now[now.length - 1] : null;
    }

    function frameSeconds(seq) {
        var f = seq.getSettings().videoFrameRate;
        return f && f.seconds > 0 ? f.seconds : 1 / 25;
    }

    function clipInfo(item, trackIndex) {
        var path = '';
        try { path = item.projectItem ? item.projectItem.getMediaPath() : ''; } catch (e) { path = ''; }
        return {
            name: item.name, mediaPath: path, mediaType: item.mediaType, trackIndex: trackIndex,
            start: item.start.seconds, end: item.end.seconds, inPoint: item.inPoint.seconds, outPoint: item.outPoint.seconds,
            speed: item.getSpeed(), projectItemNodeId: item.projectItem ? item.projectItem.nodeId : null
        };
    }

    /** Rushes = clips vid\u00e9o s\u00e9lectionn\u00e9s (au moins 2 pistes). Musique = clip audio le plus pr\u00e9sent sous les rushes. */
    function getBeatCutContext() {
        var seq = activeSequence(), sel = seq.getSelection() || [], byTrack = {}, rushIds = {}, i, t, c, pos;
        var r0 = Infinity, r1 = -Infinity, nRush = 0;
        for (i = 0; i < sel.length; i++) {
            if (sel[i].mediaType !== 'Video') { continue; }
            pos = locateTrackItem(seq, sel[i]);
            if (!pos) { continue; }
            if (!byTrack[pos.trackIndex]) { byTrack[pos.trackIndex] = { index: pos.trackIndex, name: 'V' + (pos.trackIndex + 1), ranges: [], clips: [] }; }
            byTrack[pos.trackIndex].ranges.push({ start: sel[i].start.seconds, end: sel[i].end.seconds });
            byTrack[pos.trackIndex].clips.push(sel[i].name);
            if (sel[i].projectItem) { rushIds[sel[i].projectItem.nodeId] = true; }
            r0 = Math.min(r0, sel[i].start.seconds);
            r1 = Math.max(r1, sel[i].end.seconds);
            nRush++;
        }
        var tracks = [];
        for (t in byTrack) { if (byTrack.hasOwnProperty(t)) { tracks.push(byTrack[t]); } }
        tracks.sort(function (a, b) { return a.index - b.index; });
        if (nRush === 0) {
            fail('Aucun rush s\u00e9lectionn\u00e9 sur la timeline. Empilez vos rushes sur V1, V2, V3\u2026, placez la musique sur une piste audio, puis s\u00e9lectionnez les rushes.');
        }
        if (tracks.length < 2) {
            fail('Beat Cut multicam : s\u00e9lectionnez des rushes sur au moins 2 pistes vid\u00e9o diff\u00e9rentes (ex. V1, V2, V3). ' + nRush + ' rush(s) s\u00e9lectionn\u00e9(s) sur une seule piste.');
        }
        // Choix de la musique, par priorit\u00e9 : clip audio s\u00e9lectionn\u00e9, puis m\u00e9dia distinct des rushes,
        // puis plus long recouvrement. Le son d'un rush n'est retenu qu'en dernier recours.
        var best = null, bestScore = null, seen = [];
        for (t = 0; t < seq.audioTracks.numTracks; t++) {
            var clips = seq.audioTracks[t].clips, onTrack = 0;
            for (c = 0; c < clips.numItems; c++) {
                var it = clips[c];
                onTrack++;
                var ov = Math.min(it.end.seconds, r1) - Math.max(it.start.seconds, r0);
                if (ov <= 0) { continue; }
                var selected = false, fromRush = false;
                try { selected = !!it.isSelected(); } catch (e) { selected = false; }
                try { fromRush = !!(it.projectItem && rushIds[it.projectItem.nodeId]); } catch (e2) { fromRush = false; }
                var score = [selected ? 1 : 0, fromRush ? 0 : 1, ov];
                if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] &&
                        (score[1] > bestScore[1] || (score[1] === bestScore[1] && score[2] > bestScore[2])))) {
                    best = { item: it, track: t, fromRush: fromRush, selected: selected }; bestScore = score;
                }
            }
            seen.push('A' + (t + 1) + ' : ' + onTrack + ' clip(s)');
        }
        if (!best) {
            fail('Aucun clip audio en face des rushes (de ' + formatTimecode(seq, r0) + ' \u00e0 ' + formatTimecode(seq, r1) + '). ' +
                'Pistes audio de \u00ab ' + seq.name + ' \u00bb : ' + (seen.length ? seen.join(', ') : 'aucune') + '. ' +
                'Placez la musique sur une piste audio sous les rushes, ou s\u00e9lectionnez-la avec les rushes.');
        }
        var music = clipInfo(best.item, best.track);
        if (!music.mediaPath) { fail('Le fichier de la musique \u00ab ' + music.name + ' \u00bb est introuvable (hors ligne ?).'); }
        var note = null;
        if (best.fromRush) {
            for (i = 0; i < tracks.length; i++) {
                for (c = 0; c < seq.videoTracks[tracks[i].index].clips.numItems; c++) {
                    var v = seq.videoTracks[tracks[i].index].clips[c];
                    if (v.projectItem && best.item.projectItem && v.projectItem.nodeId === best.item.projectItem.nodeId) { note = tracks[i].name; }
                }
            }
            note = 'Musique = son de \u00ab ' + music.name + ' \u00bb (A' + (best.track + 1) + ')' +
                (note ? ', dont l\u2019image est aussi un angle (' + note + ') : d\u00e9s\u00e9lectionnez-la si ce n\u2019est pas un rush.' : '.');
        }
        return {
            sequence: { name: seq.name, id: String(seq.sequenceID) },
            frame: frameSeconds(seq), tracks: tracks, rushCount: nRush,
            range: { start: r0, end: r1 }, music: music, musicNote: note
        };
    }

    /**
     * Ex\u00e9cute un plan Beat Cut : sauvegarde, coupe (QE razor) des pistes vid\u00e9o des rushes aux temps donn\u00e9s,
     * puis retire (API officielle) les morceaux des pistes situ\u00e9es au-dessus de l'angle choisi.
     * S\u00e9curit\u00e9 : un morceau n'est retir\u00e9 que s'il tient enti\u00e8rement dans son segment (donc si la coupe a eu lieu).
     */
    function beatCutMulticam(a) {
        var seq = activeSequence(a.sequenceId), id = String(seq.sequenceID);
        var tracks = a.tracks || [], cuts = a.cuts || [], segs = a.segments || [], i, k, t, c;
        if (!isArray(tracks) || tracks.length < 2) { fail('Au moins 2 pistes vid\u00e9o sont n\u00e9cessaires.'); }
        if (!isArray(cuts) || cuts.length === 0) { fail('Aucune coupe \u00e0 effectuer.'); }
        if (cuts.length > 1000) { fail('Trop de coupes (' + cuts.length + ') : 1000 au maximum.'); }
        for (i = 0; i < tracks.length; i++) {
            if (tracks[i] < 0 || tracks[i] >= seq.videoTracks.numTracks) { fail('Piste vid\u00e9o V' + (tracks[i] + 1) + ' introuvable.'); }
        }
        var backup = false, backupName = null;
        if (a.backup !== false) {
            var namesBefore = sequenceNames();
            backup = !!seq.clone();
            if (!backup) { fail('La copie de sauvegarde de la s\u00e9quence a \u00e9chou\u00e9 : rien n\'a \u00e9t\u00e9 modifi\u00e9.'); }
            backupName = newSequenceName(namesBefore);
            // Premiere peut activer la copie juste apr\u00e8s clone() : on rouvre la s\u00e9quence d'origine (API officielle).
            if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== id) {
                app.project.openSequence(id);
            }
            if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== id) {
                fail('Copie de sauvegarde cr\u00e9\u00e9e' + (backupName ? ' (\u00ab ' + backupName + ' \u00bb)' : '') +
                    ', mais Premiere n\'a pas pu rouvrir la s\u00e9quence \u00ab ' + seq.name + ' \u00bb : rien n\'a \u00e9t\u00e9 coup\u00e9. ' +
                    'Ouvrez-la, s\u00e9lectionnez les rushes et relancez.');
            }
            seq = app.project.activeSequence;
        }
        var half = frameSeconds(seq) / 2, before = countClips(seq), razored = 0, expected = [];
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        if (!qs) { fail('Le DOM QE ne trouve pas la s\u00e9quence active (copie de sauvegarde cr\u00e9\u00e9e, rien coup\u00e9).'); }
        for (i = 0; i < tracks.length; i++) {
            t = tracks[i];
            for (k = 0; k < cuts.length; k++) {
                var ct = num(cuts[k], 'temps de coupe'), clips = seq.videoTracks[t].clips, inside = false;
                for (c = 0; c < clips.numItems; c++) {
                    if (clips[c].start.seconds < ct - half && clips[c].end.seconds > ct + half) { inside = true; break; }
                }
                if (inside) { qs.getVideoTrackAt(t).razor(formatTimecode(seq, ct)); razored++; expected.push({ t: t, at: ct }); }
            }
        }
        // V\u00e9rification par l'API officielle : chaque coupe demand\u00e9e doit avoir cr\u00e9\u00e9 une jonction.
        var missing = 0;
        for (i = 0; i < expected.length; i++) {
            var cs = seq.videoTracks[expected[i].t].clips, found = false;
            for (c = 0; c < cs.numItems; c++) {
                if (Math.abs(cs[c].start.seconds - expected[i].at) <= half) { found = true; break; }
            }
            if (!found) { missing++; }
        }
        // "all" (d\u00e9faut) : un seul plan visible par segment, retir\u00e9 de toutes les autres pistes.
        // "stack" : seules les pistes au-dessus de l'angle choisi sont vid\u00e9es (la piste du bas reste continue).
        var allTracks = a.layout !== 'stack', toRemove = [], skipped = 0;
        for (k = 0; k < segs.length && missing === 0; k++) {
            if (segs[k].keep === null || segs[k].keep === undefined) { continue; }
            var s0 = num(segs[k].start, 'd\u00e9but de segment'), s1 = num(segs[k].end, 'fin de segment');
            for (i = 0; i < tracks.length; i++) {
                t = tracks[i];
                if (t === segs[k].keep || (!allTracks && t < segs[k].keep)) { continue; }
                var cl = seq.videoTracks[t].clips;
                for (c = 0; c < cl.numItems; c++) {
                    var st = cl[c].start.seconds, en = cl[c].end.seconds, mid = (st + en) / 2;
                    if (mid <= s0 || mid >= s1) { continue; }
                    if (st >= s0 - half && en <= s1 + half) { toRemove.push(cl[c]); } else { skipped++; }
                }
            }
        }
        for (i = 0; i < toRemove.length; i++) { toRemove[i].remove(false, false); }
        var markers = 0;
        if (a.markers) {
            for (k = 0; k < cuts.length; k++) {
                var m = seq.markers.createMarker(num(cuts[k], 'marqueur'));
                if (m) { m.name = 'Beat'; m.comments = 'Cadence \u2013 Beat Cut'; markers++; }
            }
        }
        var perTrack = [], lo = segs.length ? num(segs[0].start, 'd\u00e9but') : 0, hi = segs.length ? num(segs[segs.length - 1].end, 'fin') : 0;
        for (i = 0; i < tracks.length; i++) {
            var nCuts = 0, pieces = 0, tc2 = seq.videoTracks[tracks[i]].clips;
            for (k = 0; k < expected.length; k++) { if (expected[k].t === tracks[i]) { nCuts++; } }
            for (c = 0; c < tc2.numItems; c++) {
                var m2 = (tc2[c].start.seconds + tc2[c].end.seconds) / 2;
                if (m2 > lo && m2 < hi) { pieces++; }
            }
            perTrack.push({ name: 'V' + (tracks[i] + 1), cuts: nCuts, pieces: pieces });
        }
        return {
            backup: backup, backupName: backupName, razored: razored, missing: missing, removed: toRemove.length, skipped: skipped, markers: markers,
            clipsBefore: before, clipsAfter: countClips(seq), sequence: seq.name, layout: allTracks ? 'all' : 'stack', perTrack: perTrack
        };
    }

    function wrap(fn) { return function (a) { return run(fn, a); }; }

    return {
        version: VERSION,
        toJson: toJson,
        ping: wrap(ping),
        getSelectedClip: wrap(getSelectedClip),
        countMarkers: wrap(countMarkers),
        addMarkers: wrap(addMarkers),
        clearMarkers: wrap(clearMarkers),
        createCutSequence: wrap(createCutSequence),
        chooseFiles: wrap(chooseFiles),
        importFiles: wrap(importFiles),
        importRendered: wrap(importRendered),
        setClipSpeed: wrap(setClipSpeed),
        getBeatCutContext: wrap(getBeatCutContext),
        beatCutMulticam: wrap(beatCutMulticam)
    };
}());
