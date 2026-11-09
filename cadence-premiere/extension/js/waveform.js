/* Cadence – forme d’onde avec superposition des propositions (temps, silences). */
(function (root) {
  'use strict';

  function Waveform(canvas) {
    this.canvas = canvas;
    this.peaks = null; this.peaks2 = null; this.duration = 0;
    this.beats = []; this.regions = []; this.playhead = null;
    this.onRegionClick = null;
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(canvas);
    canvas.addEventListener('click', function (ev) {
      if (!self.duration || !self.regions.length || !self.onRegionClick) return;
      var r = canvas.getBoundingClientRect(), t = (ev.clientX - r.left) / r.width * self.duration;
      for (var i = 0; i < self.regions.length; i++) {
        if (t >= self.regions[i].start && t <= self.regions[i].end) { self.onRegionClick(i); return; }
      }
    });
  }

  Waveform.prototype.setAudio = function (mono, sampleRate) {
    this.mono = mono; this.duration = mono.length / sampleRate; this.peaks = null; this.peaks2 = null; this.draw();
  };
  Waveform.prototype.setOverlay = function (mono2) { this.mono2 = mono2; this.peaks2 = null; this.draw(); };

  Waveform.prototype.draw = function () {
    var c = this.canvas, dpr = root.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.peaks = null; this.peaks2 = null; }
    var g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!this.mono) return;
    var D = root.CadenceDSP, mid = h / 2, x;
    if (!this.peaks) this.peaks = D.computePeaks(this.mono, w);
    if (this.mono2 && !this.peaks2) this.peaks2 = D.computePeaks(this.mono2, w);
    var css = getComputedStyle(document.documentElement), dur = this.duration;
    var X = function (t) { return t / dur * w; };

    this.regions.forEach(function (r) {
      g.fillStyle = r.enabled === false ? 'rgba(150,150,150,0.18)' : 'rgba(224,100,92,0.32)';
      g.fillRect(X(r.start), 0, Math.max(1, X(r.end) - X(r.start)), h);
    });
    function bars(p, color) {
      g.fillStyle = color;
      for (x = 0; x < w; x++) {
        var top = mid - p.max[x] * mid * 0.95, bot = mid - p.min[x] * mid * 0.95;
        g.fillRect(x, top, 1, Math.max(1, bot - top));
      }
    }
    bars(this.peaks, this.peaks2 ? 'rgba(154,154,160,0.55)' : css.getPropertyValue('--accent').trim() || '#4fb3a9');
    if (this.peaks2) bars(this.peaks2, 'rgba(79,179,169,0.85)');

    g.fillStyle = css.getPropertyValue('--accent2').trim() || '#f2b44c';
    this.beats.forEach(function (b) {
      g.globalAlpha = 0.35 + 0.65 * (b.strength == null ? 1 : b.strength);
      g.fillRect(Math.round(X(b.time)), 0, Math.max(1, dpr), h);
    });
    g.globalAlpha = 1;
    if (this.playhead != null) { g.fillStyle = '#fff'; g.fillRect(Math.round(X(this.playhead)), 0, Math.max(1, dpr), h); }
  };

  root.CadenceWaveform = Waveform;
}(window));
