/* =================================================================
   LITTLE DRUIDS — magic.js
   Phase 2 interactive features
   Loaded with defer after the main inline script.
   NEVER redefines: restoreFey, startRoaming, stopRoaming, initCarousel
   ================================================================= */
(function () {
  "use strict";

  /* ----------------------------------------------------------------
     0. CONSTANTS & GUARDS
  ---------------------------------------------------------------- */
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------------------------------------------
     1. feyState — localStorage persistence, safe fallback
  ---------------------------------------------------------------- */
  var feyState = (function () {
    var KEY = "ld_feystate";
    var DEFAULTS = {
      v: 1,
      night: null,
      belief: 0,
      beliefLog: {
        feySightFirst: false,
        riddleSolved: false,
        trueNameFirst: false,
        fittoniaWatered: false,
        venusTapped: false,
        companionTapped: false,
        hiddenSparks: 0
      },
      riddleSolved: false,
      riddleAttempts: 0,
      trueNameInput: "",
      trueNameResult: null,
      lastSurge: 0,
      lastCompanionTap: 0
    };

    function deepMerge(target, source) {
      var out = {};
      Object.keys(target).forEach(function (k) {
        if (source && source[k] !== undefined) {
          if (typeof target[k] === "object" && target[k] !== null && !Array.isArray(target[k])) {
            out[k] = deepMerge(target[k], source[k]);
          } else {
            out[k] = source[k];
          }
        } else {
          out[k] = target[k];
        }
      });
      return out;
    }

    var _state = deepMerge(DEFAULTS, {});

    function load() {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) _state = deepMerge(DEFAULTS, JSON.parse(raw));
      } catch (e) { /* silently ignore */ }
    }

    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(_state)); } catch (e) { /* silently ignore */ }
    }

    function get(k) { return _state[k]; }

    function set(k, v) { _state[k] = v; save(); }

    load();
    return { get: get, set: set, save: save };
  })();

  /* ----------------------------------------------------------------
     2. PARTICLE ENGINE — single shared feyCanvas
  ---------------------------------------------------------------- */
  var canvas = document.getElementById("feyCanvas");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var particles = new Array(150).fill(null);
  var nextSlot = 0;
  var rafId = null;
  var lastTs = 0;
  var gravityFlip = false;
  var _nightActive = false; // set by day/night module

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });

  function needsContinuousRender() {
    return _nightActive;
  }

  function spawnParticle(opts) {
    if (!ctx || reducedMotion) return;
    var p = {
      x: opts.x || 0, y: opts.y || 0,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life: 1.0,
      decay: opts.decay || 0.003,
      size: opts.size || 8,
      type: opts.type || "spark",
      color: opts.color || "#D4A5B8",
      rotation: opts.rotation || 0,
      rotSpeed: opts.rotSpeed || 0,
      alpha: 1.0,
      data: opts.data || {},
      spawnTs: performance.now()
    };
    var start = nextSlot;
    do {
      if (particles[nextSlot] === null) {
        particles[nextSlot] = p;
        nextSlot = (nextSlot + 1) % particles.length;
        ensureRafRunning();
        return;
      }
      nextSlot = (nextSlot + 1) % particles.length;
    } while (nextSlot !== start);
    // pool full: evict
    particles[nextSlot] = p;
    nextSlot = (nextSlot + 1) % particles.length;
    ensureRafRunning();
  }

  function renderParticle(p) {
    var alpha = Math.min(1, p.life * 2) * p.alpha;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    if (p.rotation) ctx.rotate(p.rotation);

    switch (p.type) {
      case "spark":
        ctx.fillStyle = p.color;
        ctx.font = p.size + "px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("✧", 0, 0);
        break;

      case "petal":
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.5, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "leaf":
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 0.6);
        ctx.quadraticCurveTo(p.size * 0.5, 0, 0, p.size * 0.6);
        ctx.quadraticCurveTo(-p.size * 0.5, 0, 0, -p.size * 0.6);
        ctx.stroke();
        break;

      case "moss":
        ctx.fillStyle = p.color;
        for (var m = 0; m < 3; m++) {
          ctx.beginPath();
          ctx.arc(
            (m - 1) * p.size * 0.5,
            m === 1 ? -p.size * 0.3 : 0,
            p.size * 0.28, 0, Math.PI * 2
          );
          ctx.fill();
        }
        break;

      case "flower":
        ctx.fillStyle = p.color;
        for (var f = 0; f < 5; f++) {
          var fa = (f / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(
            Math.cos(fa) * p.size * 0.4,
            Math.sin(fa) * p.size * 0.4,
            p.size * 0.28, p.size * 0.18, fa, 0, Math.PI * 2
          );
          ctx.fill();
        }
        ctx.fillStyle = "#d4b069";
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "firefly":
        var ffGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size * 1.2);
        ffGrad.addColorStop(0, "rgba(230,210,120,0.9)");
        ffGrad.addColorStop(0.5, "rgba(200,180,80,0.4)");
        ffGrad.addColorStop(1, "rgba(180,150,50,0)");
        ctx.fillStyle = ffGrad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 1.2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "wisp-trail":
        var wGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        wGrad.addColorStop(0, "rgba(180,220,255,0.7)");
        wGrad.addColorStop(1, "rgba(180,220,255,0)");
        ctx.fillStyle = wGrad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "sigil":
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.font = "bold " + p.size + "px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = p.color;
        ctx.fillText("✦", 0, 0);
        break;
    }
    ctx.restore();
  }

  function tickParticles(ts) {
    var dt = Math.min(ts - lastTs, 64);
    lastTs = ts;

    if (document.hidden) { rafId = null; return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var activeCount = 0;

    var gy = gravityFlip ? -0.00004 : 0.00004;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (!p) continue;
      p.life -= p.decay * dt;
      if (p.life <= 0) { particles[i] = null; continue; }
      p.x += p.vx * dt;
      p.y += (p.vy + gy) * dt;
      p.rotation += p.rotSpeed * dt;
      // firefly: add sine wobble
      if (p.type === "firefly" && p.data.wobble !== undefined) {
        p.data.wobble += 0.002 * dt;
        p.y += Math.sin(p.data.wobble) * 0.3;
      }
      renderParticle(p);
      activeCount++;
    }

    if (activeCount === 0 && !needsContinuousRender()) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tickParticles);
  }

  function ensureRafRunning() {
    if (!ctx) return;
    if (!rafId) {
      lastTs = performance.now();
      rafId = requestAnimationFrame(tickParticles);
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && needsContinuousRender()) ensureRafRunning();
  });

  // Convenience: spawn a burst of sparks at x,y
  function spawnBurst(x, y, count, type, color) {
    for (var i = 0; i < count; i++) {
      var angle = (i / count) * Math.PI * 2;
      var speed = 0.04 + Math.random() * 0.06;
      spawnParticle({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.04,
        decay: 0.002 + Math.random() * 0.002,
        size: 6 + Math.random() * 6,
        type: type || "spark",
        color: color || ["#D4A5B8","#b97f94","#d4b069","#4A5D23"][Math.floor(Math.random()*4)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.005
      });
    }
  }

  /* ----------------------------------------------------------------
     3. DAY / NIGHT (Feature 3)
  ---------------------------------------------------------------- */
  var fireflyInterval = null;

  function startFireflies() {
    if (reducedMotion || fireflyInterval) return;
    _nightActive = true;
    ensureRafRunning();
    fireflyInterval = setInterval(function () {
      if (!_nightActive) return;
      var count = Math.floor(Math.random() * 2) + 1;
      for (var i = 0; i < count; i++) {
        spawnParticle({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          vx: (Math.random() - 0.5) * 0.015,
          vy: (Math.random() - 0.5) * 0.008,
          decay: 0.0004 + Math.random() * 0.0003,
          size: 3 + Math.random() * 3,
          type: "firefly",
          data: { wobble: Math.random() * Math.PI * 2 }
        });
      }
    }, 500);
  }

  function stopFireflies() {
    _nightActive = false;
    if (fireflyInterval) { clearInterval(fireflyInterval); fireflyInterval = null; }
  }

  function applyNightMode(on) {
    document.documentElement.classList.toggle("ld-night", on);
    var btn = document.getElementById("dayNightBtn");
    if (btn) {
      btn.textContent = on ? "[ \u2600 Day ]" : "[ \u263D Night ]";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (on) startFireflies(); else stopFireflies();
  }

  function initDayNight() {
    var castBar = document.querySelector(".cast-bar");
    if (!castBar) return;
    var btn = document.createElement("button");
    btn.className = "cast-btn";
    btn.id = "dayNightBtn";
    btn.type = "button";
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "[ \u263D Night ]";
    castBar.appendChild(btn);

    var hour = new Date().getHours();
    var autoNight = hour < 6 || hour >= 18;
    var stored = feyState.get("night");
    var isNight = stored !== null ? stored : autoNight;
    applyNightMode(isNight);

    btn.addEventListener("click", function () {
      var next = !document.documentElement.classList.contains("ld-night");
      feyState.set("night", next);
      applyNightMode(next);
    });
  }

  /* ----------------------------------------------------------------
     4. DRUIDCRAFT TRAILS (Feature 1)
  ---------------------------------------------------------------- */
  var _trailBlocked = false;
  var _lastTrailX = 0, _lastTrailY = 0;
  var TRAIL_MIN_DIST = 18;
  var MOUSE_TRAIL_DIST = 60;
  var _lastMouseX = 0, _lastMouseY = 0;

  var TRAIL_COLORS = ["#D4A5B8","#b97f94","#4A5D23","#6b8a35","#d4b069"];
  var TRAIL_TYPES = ["spark","petal","leaf","moss","flower"];

  function isInsideCarousel(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.classList && (
        node.classList.contains("bazaar-carousel") ||
        node.classList.contains("codex-carousel")
      )) return true;
      node = node.parentElement;
    }
    return false;
  }

  function spawnTrailBurst(x, y) {
    var count = 2 + Math.floor(Math.random() * 3);
    for (var i = 0; i < count; i++) {
      var type = TRAIL_TYPES[Math.floor(Math.random() * TRAIL_TYPES.length)];
      var color = TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)];
      spawnParticle({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 0.04,
        vy: -0.06 - Math.random() * 0.04,
        decay: 0.0025 + Math.random() * 0.002,
        size: 7 + Math.random() * 7,
        type: type,
        color: color,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.003
      });
    }
  }

  function initTrails() {
    document.addEventListener("touchstart", function (e) {
      _trailBlocked = isInsideCarousel(e.target);
      if (!_trailBlocked) {
        _lastTrailX = e.touches[0].clientX;
        _lastTrailY = e.touches[0].clientY;
      }
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (_trailBlocked || reducedMotion) return;
      var tx = e.touches[0].clientX, ty = e.touches[0].clientY;
      var dx = tx - _lastTrailX, dy = ty - _lastTrailY;
      if (dx * dx + dy * dy < TRAIL_MIN_DIST * TRAIL_MIN_DIST) return;
      _lastTrailX = tx; _lastTrailY = ty;
      spawnTrailBurst(tx, ty);
    }, { passive: true });

    document.addEventListener("touchend", function () { _trailBlocked = false; }, { passive: true });
    document.addEventListener("touchcancel", function () { _trailBlocked = false; }, { passive: true });

    // Desktop sparse trail
    document.addEventListener("mousemove", function (e) {
      if (reducedMotion) return;
      var dx = e.clientX - _lastMouseX, dy = e.clientY - _lastMouseY;
      if (dx * dx + dy * dy < MOUSE_TRAIL_DIST * MOUSE_TRAIL_DIST) return;
      _lastMouseX = e.clientX; _lastMouseY = e.clientY;
      var type = TRAIL_TYPES[Math.floor(Math.random() * TRAIL_TYPES.length)];
      spawnParticle({
        x: e.clientX, y: e.clientY,
        vx: (Math.random() - 0.5) * 0.02,
        vy: -0.03 - Math.random() * 0.02,
        decay: 0.003,
        size: 6 + Math.random() * 5,
        type: type,
        color: TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.003
      });
    }, { passive: true });
  }

  /* ----------------------------------------------------------------
     5. WILD MAGIC SURGES (Feature 2)
  ---------------------------------------------------------------- */
  var SURGE_EXCLUDED = ".cast-btn, .carousel-btn, .carousel-dot";
  var SURGE_CHANCE = 0.08;
  var SURGE_COOLDOWN = 10000;

  function showSurgeToast(name) {
    var t = document.createElement("div");
    t.className = "surge-toast";
    t.textContent = "\u2727 " + name + " \u2727";
    document.body.appendChild(t);
    t.addEventListener("animationend", function () { t.remove(); });
  }

  var SURGES = [
    {
      name: "Mushroom Ring Summons",
      run: function (x, y) {
        var n = 12;
        for (var i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2;
          spawnParticle({
            x: x + Math.cos(a) * 80, y: y + Math.sin(a) * 80,
            vx: 0, vy: 0,
            decay: 0.0008,
            size: 11,
            type: "moss",
            color: "#4A5D23"
          });
        }
      }
    },
    {
      name: "Petal Rain",
      run: function () {
        for (var i = 0; i < 30; i++) {
          spawnParticle({
            x: Math.random() * window.innerWidth,
            y: -10,
            vx: (Math.random() - 0.5) * 0.03,
            vy: 0.04 + Math.random() * 0.06,
            decay: 0.001,
            size: 8 + Math.random() * 6,
            type: "petal",
            color: ["#D4A5B8","#b97f94","#e8b8d0"][Math.floor(Math.random()*3)],
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.004
          });
        }
      }
    },
    {
      name: "Ancient Tongue Glimpsed",
      run: function () {
        var els = document.querySelectorAll(".card-title, .section-title");
        els.forEach(function (el) {
          el.classList.add("surge-glyph");
          setTimeout(function () { el.classList.remove("surge-glyph"); }, 2500);
        });
      }
    },
    {
      name: "A Frog of Great Import",
      run: function (x, y) {
        for (var i = 0; i < 5; i++) {
          spawnParticle({
            x: x + (Math.random()-0.5)*30, y: y + (Math.random()-0.5)*30,
            vx: (Math.random()-0.5)*0.06, vy: -0.06 - Math.random()*0.04,
            decay: 0.003, size: 8, type: "spark", color: "#2d8a50"
          });
        }
      }
    },
    {
      name: "Antler Sigil Revealed",
      run: function () {
        spawnParticle({
          x: window.innerWidth * 0.5, y: window.innerHeight * 0.4,
          vx: 0, vy: 0,
          decay: 0.0006,
          size: 60,
          type: "sigil",
          color: "rgba(74,93,35,0.6)"
        });
      }
    },
    {
      name: "Gravity Inverted",
      run: function (x, y) {
        gravityFlip = true;
        spawnBurst(x, y, 16, "spark");
        setTimeout(function () { gravityFlip = false; }, 3000);
      }
    },
    {
      name: "Sparkles Drift Upward",
      run: function (x, y) {
        for (var i = 0; i < 20; i++) {
          spawnParticle({
            x: x + (Math.random()-0.5)*120, y: y + (Math.random()-0.5)*120,
            vx: (Math.random()-0.5)*0.02,
            vy: -0.08 - Math.random()*0.05,
            decay: 0.0015, size: 7+Math.random()*7,
            type: "spark",
            color: TRAIL_COLORS[Math.floor(Math.random()*TRAIL_COLORS.length)]
          });
        }
      }
    },
    {
      name: "Will-o\u2019-Wisp Drawn Near",
      run: function (x, y) {
        for (var i = 0; i < 5; i++) {
          var phase = (i / 5) * Math.PI * 2;
          spawnParticle({
            x: x, y: y,
            vx: Math.cos(phase) * 0.02, vy: Math.sin(phase) * 0.02,
            decay: 0.0007,
            size: 10 + Math.random() * 8,
            type: "firefly",
            data: { wobble: phase }
          });
        }
      }
    }
  ];

  // Special "Frog Ribbit" toast replaces toast for surge index 3
  var _origSurge3Run = SURGES[3].run;
  SURGES[3].run = function (x, y) {
    _origSurge3Run(x, y);
    // Override toast by calling it manually after a brief pause
  };

  function pickSurge() {
    return SURGES[Math.floor(Math.random() * SURGES.length)];
  }

  function maybeWildMagic(target, x, y) {
    if (target && target.closest && target.closest(SURGE_EXCLUDED)) return;
    var now = Date.now();
    if (now - feyState.get("lastSurge") < SURGE_COOLDOWN) return;
    if (Math.random() > SURGE_CHANCE) return;
    feyState.set("lastSurge", now);
    var surge = pickSurge();
    surge.run(x || window.innerWidth / 2, y || window.innerHeight / 2);
    var toastName = surge.name;
    if (surge.name === "A Frog of Great Import") {
      toastName = "\uD83D\uDC38 A frog of great import arrived. It said: ribbit.";
    }
    showSurgeToast(toastName);
  }

  function initSurges() {
    document.addEventListener("click", function (e) {
      maybeWildMagic(e.target, e.clientX, e.clientY);
    });
  }

  /* ----------------------------------------------------------------
     6. WITHERED WOOD (Feature 8)
  ---------------------------------------------------------------- */
  var BELIEF_LINES = [
    "the Wood is still\u2026",
    "a single thread of belief woven",
    "the Wood remembers\u2026 {n} threads of belief woven",
    "the roots stir with {n} threads of belief",
    "the old boughs wake\u2026 {n} threads of belief woven",
    "\u2727 full bloom \u2014 belief has restored the Withered Wood \u2727"
  ];

  function grantBelief(eventKey) {
    var log = feyState.get("beliefLog");
    if (eventKey === "hiddenSparks") {
      if (log.hiddenSparks >= 3) return;
      log.hiddenSparks++;
      feyState.set("beliefLog", log);
      if (log.hiddenSparks < 3) return; // only grant when all 3 found
    } else {
      if (log[eventKey]) return;
      log[eventKey] = true;
      feyState.set("beliefLog", log);
    }
    var newBelief = Math.min(5, feyState.get("belief") + 1);
    feyState.set("belief", newBelief);
    updateGrove(newBelief);
    broadcastBeliefToGlobal(newBelief);
  }

  function updateGrove(n) {
    var svg = document.getElementById("groveTree");
    if (!svg) return;
    for (var i = 0; i <= 4; i++) svg.classList.toggle("stage-" + i, n >= i + 1);
    var line = document.getElementById("woodProgressLine");
    if (line) {
      var text = BELIEF_LINES[Math.min(n, BELIEF_LINES.length - 1)];
      line.textContent = text.replace("{n}", n);
    }
  }

  function broadcastBeliefToGlobal(level) {
    // STUB: replace with fetch() when a global endpoint is available
    // fetch('/api/belief', { method:'POST', body:JSON.stringify({level:level}) });
    console.debug("[LD] belief stub \u2014 level", level);
  }

  var GROVE_SVG = '<svg id="groveTree" viewBox="0 0 200 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:200px;height:180px">' +
    '<g stroke="#4A5D23" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    // Trunk
    '<path d="M100 160 L100 90" stroke-width="2.5"/>' +
    '<path d="M100 130 L85 115" stroke-width="1.8"/>' +
    '<path d="M100 120 L118 100" stroke-width="1.8"/>' +
    '<path d="M100 105 L80 85" stroke-width="1.5"/>' +
    '<path d="M100 100 L122 82" stroke-width="1.5"/>' +
    '<path d="M100 92 L95 72" stroke-width="1.3"/>' +
    '<path d="M100 90 L108 68" stroke-width="1.3"/>' +
    // Mushrooms base
    '<path d="M55 158 Q55 148 65 148 Q75 148 75 158" fill="rgba(74,93,35,0.15)"/>' +
    '<path d="M125 160 Q125 150 133 150 Q141 150 141 160" fill="rgba(74,93,35,0.15)"/>' +
    '<line x1="65" y1="148" x2="65" y2="160"/>' +
    '<line x1="133" y1="150" x2="133" y2="162"/>' +
    // Undergrowth
    '<path d="M40 165 Q50 155 60 165"/>' +
    '<path d="M140 163 Q150 153 160 163"/>' +
    '<path d="M70 168 Q80 160 90 168"/>' +
    '<path d="M110 167 Q120 159 130 167"/>' +
    '</g>' +
    // Stage: buds
    '<g class="stage-bud" fill="#b97f94" stroke="#b97f94" stroke-width="0.8">' +
    '<circle cx="85" cy="113" r="3"/>' +
    '<circle cx="118" cy="98" r="3"/>' +
    '<circle cx="80" cy="83" r="2.5"/>' +
    '<circle cx="96" cy="70" r="2.5"/>' +
    '<circle cx="109" cy="66" r="2.5"/>' +
    '</g>' +
    // Stage: leaves
    '<g class="stage-leaf" fill="rgba(74,93,35,0.45)" stroke="#4A5D23" stroke-width="0.7">' +
    '<ellipse cx="83" cy="110" rx="7" ry="4" transform="rotate(-30 83 110)"/>' +
    '<ellipse cx="120" cy="95" rx="7" ry="4" transform="rotate(20 120 95)"/>' +
    '<ellipse cx="78" cy="80" rx="6" ry="3.5" transform="rotate(-40 78 80)"/>' +
    '<ellipse cx="123" cy="78" rx="6" ry="3.5" transform="rotate(15 123 78)"/>' +
    '<ellipse cx="94" cy="67" rx="5" ry="3" transform="rotate(-20 94 67)"/>' +
    '<ellipse cx="110" cy="63" rx="5" ry="3" transform="rotate(25 110 63)"/>' +
    '</g>' +
    // Stage: blossoms
    '<g class="stage-bloom">' +
    '<circle cx="85" cy="110" r="5" fill="rgba(212,165,184,0.7)" stroke="#D4A5B8" stroke-width="0.8"/>' +
    '<circle cx="120" cy="95" r="5" fill="rgba(212,165,184,0.7)" stroke="#D4A5B8" stroke-width="0.8"/>' +
    '<circle cx="78" cy="80" r="4" fill="rgba(212,165,184,0.6)" stroke="#D4A5B8" stroke-width="0.7"/>' +
    '<circle cx="94" cy="67" r="4" fill="rgba(212,165,184,0.6)" stroke="#D4A5B8" stroke-width="0.7"/>' +
    '<circle cx="110" cy="63" r="4" fill="rgba(212,165,184,0.6)" stroke="#D4A5B8" stroke-width="0.7"/>' +
    '</g>' +
    // Stage: fey glow dots
    '<g class="stage-glow" fill="#d4b069">' +
    '<circle cx="88" cy="107" r="2"/>' +
    '<circle cx="116" cy="92" r="2"/>' +
    '<circle cx="80" cy="77" r="1.8"/>' +
    '<circle cx="97" cy="64" r="1.8"/>' +
    '<circle cx="112" cy="60" r="1.8"/>' +
    '</g>' +
    '</svg>';

  function initWitheredWood() {
    // Insert section after ministry (so "Where to Find Us" stays right after the Codex)
    var ministrySection = document.querySelector('[aria-labelledby="ministry-title"]');
    if (!ministrySection) return;

    var section = document.createElement("section");
    section.className = "section";
    section.id = "witherWoodSection";
    section.setAttribute("aria-labelledby", "wood-title");
    section.innerHTML =
      '<div class="druid-sigil" aria-hidden="true"></div>' +
      '<div class="section-head"><h2 class="section-title" id="wood-title">The Withered Wood</h2></div>' +
      '<p class="section-sub">tend the forest with your belief</p>' +
      '<div class="grove-wrap">' +
        GROVE_SVG +
      '</div>' +
      '<p class="grove-progress" id="woodProgressLine">the Wood is still\u2026</p>';

    ministrySection.parentNode.insertBefore(section, ministrySection.nextSibling);

    var belief = feyState.get("belief");
    updateGrove(belief);

    // Hidden sparks
    document.querySelectorAll("[data-hidden-spark]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        if (el.dataset.hiddenSparkFound) return;
        el.dataset.hiddenSparkFound = "1";
        var rect = el.getBoundingClientRect();
        spawnBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 8, "spark", "#d4b069");
        grantBelief("hiddenSparks");
        var count = feyState.get("beliefLog").hiddenSparks;
        var sparkMsg = count >= 3
          ? "\u2727 a thread of belief found \u2727"
          : "\u2727 a hidden spark\u2026 " + count + " of 3 \u2727";
        showSurgeToast(sparkMsg);
      });
    });

    // Grant belief on first fey sight cast
    var feySightBtn = document.getElementById("feySightBtn");
    if (feySightBtn) {
      feySightBtn.addEventListener("click", function () {
        if (document.body.classList.contains("fey-sight")) {
          grantBelief("feySightFirst");
        }
      });
    }
  }

  /* ----------------------------------------------------------------
     7. RIDDLE DOOR (Feature 4)
  ---------------------------------------------------------------- */
  var RIDDLE_ANSWERS = ["moss", "the moss", "it is moss"];
  var RIDDLE_HINTS = [
    null,
    null,
    "\u2727 It is humble, and green, and it covers the bones of old trees\u2026",
    null,
    "\u2727 The fey rest upon it. It grows where light is gentle and water is near\u2026"
  ];

  var DOOR_SVG =
    '<svg viewBox="0 0 160 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:160px;height:180px">' +
    '<g stroke="#4A5D23" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
    // Pillars
    '<rect x="10" y="20" width="28" height="155" rx="2" stroke-width="1.2" fill="rgba(74,93,35,0.06)"/>' +
    '<rect x="122" y="20" width="28" height="155" rx="2" stroke-width="1.2" fill="rgba(74,93,35,0.06)"/>' +
    // Lintel
    '<rect x="8" y="16" width="144" height="18" rx="3" fill="rgba(74,93,35,0.09)"/>' +
    // Door arch
    '<path d="M38 175 L38 80 Q38 35 80 35 Q122 35 122 80 L122 175 Z" stroke-width="1.5" fill="rgba(74,93,35,0.04)"/>' +
    // Keystone
    '<path d="M72 35 Q80 28 88 35" stroke-width="1.8" fill="rgba(212,165,184,0.15)"/>' +
    // Ivy left
    '<path d="M10 60 Q0 55 5 45 Q15 40 20 55" fill="rgba(74,93,35,0.15)"/>' +
    '<path d="M10 80 Q-2 78 0 65 Q12 60 18 75" fill="rgba(74,93,35,0.12)"/>' +
    '<path d="M12 100 Q2 100 3 88 Q14 83 19 97" fill="rgba(74,93,35,0.10)"/>' +
    '<path d="M12 120 Q0 122 2 108 Q14 105 18 117" fill="rgba(74,93,35,0.10)"/>' +
    // Ivy right
    '<path d="M150 60 Q162 55 157 45 Q147 40 142 55" fill="rgba(74,93,35,0.15)"/>' +
    '<path d="M150 80 Q164 78 162 65 Q150 60 144 75" fill="rgba(74,93,35,0.12)"/>' +
    '<path d="M150 100 Q162 100 161 88 Q150 83 145 97" fill="rgba(74,93,35,0.10)"/>' +
    // Moss tufts at base
    '<circle cx="25" cy="172" r="6" fill="rgba(74,93,35,0.2)" stroke-width="0.8"/>' +
    '<circle cx="33" cy="174" r="4" fill="rgba(74,93,35,0.15)" stroke-width="0.8"/>' +
    '<circle cx="130" cy="172" r="5" fill="rgba(74,93,35,0.2)" stroke-width="0.8"/>' +
    '<circle cx="138" cy="174" r="4" fill="rgba(74,93,35,0.15)" stroke-width="0.8"/>' +
    // Door handle
    '<circle cx="110" cy="108" r="4" stroke-width="1.5"/>' +
    '<path d="M110 112 L110 118" stroke-width="1.5"/>' +
    '</g>' +
    '</svg>';

  function initRiddleDoor() {
    var footer = document.querySelector(".footer");
    if (!footer) return;

    var wrap = document.createElement("div");
    wrap.className = "riddle-door-wrap riddle-door-section";
    wrap.setAttribute("aria-live", "polite");
    wrap.id = "riddleDoorWrap";

    var isSolved = feyState.get("riddleSolved");
    var attempts = feyState.get("riddleAttempts") || 0;

    if (isSolved) {
      wrap.innerHTML = riddleSolvedHTML();
    } else {
      wrap.innerHTML =
        '<p class="riddle-door-inscription">speak, friend, and enter</p>' +
        '<div class="riddle-door-svg-wrap">' +
          '<div class="riddle-door-svg-inner" id="riddleDoorSvg">' + DOOR_SVG + '</div>' +
        '</div>' +
        '<div id="riddlePhaseReveal" hidden>' +
          '<p class="riddle-question">\u201cI have no flower, yet I bloom in patience. I grow where stone meets shadow, and faeries sleep within my softness. Ancient forests wear me like a cloak. What am I?\u201d</p>' +
          '<form class="riddle-form" id="riddleForm" autocomplete="off">' +
            '<input class="riddle-input" id="riddleInput" type="text" spellcheck="false" autocomplete="off" placeholder="speak, friend, and enter\u2026" />' +
            '<button class="cast-btn" type="submit">[ Speak ]</button>' +
          '</form>' +
          '<p class="riddle-hint" id="riddleHint" aria-live="polite"></p>' +
        '</div>' +
        '<div id="riddleSolvedPanel" hidden>' + riddleSolvedHTML() + '</div>' +
        '<button class="cast-btn" id="riddleRevealBtn" type="button">[ Knock Upon the Stone Door ]</button>';
    }

    footer.parentNode.insertBefore(wrap, footer);

    if (isSolved) return;

    document.getElementById("riddleRevealBtn").addEventListener("click", function () {
      document.getElementById("riddleRevealBtn").hidden = true;
      document.getElementById("riddlePhaseReveal").hidden = false;
      document.getElementById("riddleInput").focus();
    });

    document.getElementById("riddleForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var val = document.getElementById("riddleInput").value;
      var norm = val.trim().toLowerCase().replace(/[^a-z\s]/g, "").trim();
      if (RIDDLE_ANSWERS.indexOf(norm) !== -1) {
        solveRiddle();
      } else {
        attempts++;
        feyState.set("riddleAttempts", attempts);
        var hint = RIDDLE_HINTS[Math.min(attempts, RIDDLE_HINTS.length - 1)];
        var hintEl = document.getElementById("riddleHint");
        if (hint) hintEl.textContent = hint;
        var inp = document.getElementById("riddleInput");
        inp.classList.add("shake");
        inp.addEventListener("animationend", function () { inp.classList.remove("shake"); }, { once: true });
        inp.value = "";
      }
    });
  }

  function riddleSolvedHTML() {
    return '<div class="riddle-reward">' +
      '<p>\u2727 the door yields \u2727</p>' +
      '<p>Be it known that you have spoken the old tongue.</p>' +
      '<p>Whisper <strong class="riddle-secret-word">elpis</strong> at the Ministry booth<br>and receive a small gift from the fey.</p>' +
      '</div>';
  }

  function solveRiddle() {
    feyState.set("riddleSolved", true);
    grantBelief("riddleSolved");
    var svgInner = document.getElementById("riddleDoorSvg");
    if (svgInner) svgInner.classList.add("open-door");
    setTimeout(function () {
      var phaseReveal = document.getElementById("riddlePhaseReveal");
      var solvedPanel = document.getElementById("riddleSolvedPanel");
      if (phaseReveal) phaseReveal.hidden = true;
      if (solvedPanel) solvedPanel.hidden = false;
      spawnBurst(window.innerWidth / 2, window.innerHeight * 0.6, 20, "petal", "#D4A5B8");
    }, 950);
  }

  /* ----------------------------------------------------------------
     8. TRUE NAMES — THE NAMING POOL (Feature 5)
  ---------------------------------------------------------------- */
  var FEY_PREFIX = ["Aer","Bri","Cal","Dael","Eil","Fae","Gal","Hael","Ith","Jael",
                    "Kael","Lith","Mora","Nael","Oss","Pael","Quel","Rael","Syl","Tae",
                    "Uin","Vel","Wren","Xael","Yss"];
  var FEY_SUFFIX = ["adra","bris","dalla","eni","fael","gora","hiel","irae","jora","kael",
                    "lira","mira","nael","oris","pela","quel","riel","sira","thel","uin",
                    "vel","wys","xir","yra","zel"];
  var COURTS = ["Seelie (Summer)", "Unseelie (Gloaming)"];
  var ELEMENTS = [
    { name:"Water",       title:"River Nymph",   color:"#5b9bd5", weight:22,
      flavor:"Born of the in-between, called by current and tide." },
    { name:"Fire",        title:"Cinder Sprite",  color:"#e87c3e", weight:22,
      flavor:"Kindled in forgotten hearths, kept alive by memory." },
    { name:"Earth",       title:"Moss Gnome",     color:"#4A5D23", weight:22,
      flavor:"Rooted where stone meets patience, older than the hill." },
    { name:"Air",         title:"Zephyr Pixie",   color:"#7ab8d5", weight:22,
      flavor:"Untethered, untamed, a rumour the wind tells itself." },
    { name:"Twilight",    title:"Shadow Fey",     color:"#6b4fa8", weight:6,
      flavor:"Neither court claims you. Both courts watch you." },
    { name:"Wild Growth", title:"Green Fey",      color:"#2d8a50", weight:6,
      flavor:"You are what grows when no one is tending." }
  ];

  function hashName(str) {
    var s = str.toLowerCase();
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h = h & 0x7FFFFFFF;
    }
    return Math.abs(h);
  }

  function weightedPick(arr, seed) {
    var total = 0;
    arr.forEach(function (e) { total += e.weight; });
    var val = seed % total;
    var cum = 0;
    for (var i = 0; i < arr.length; i++) {
      cum += arr[i].weight;
      if (val < cum) return arr[i];
    }
    return arr[arr.length - 1];
  }

  function generateSigilSVG(element, h) {
    var petals = 5 + (h % 3);
    var col = element.color;
    var paths = "";
    for (var i = 0; i < petals; i++) {
      var a = (i / petals) * Math.PI * 2 - Math.PI / 2;
      var px = Math.cos(a) * 22;
      var py = Math.sin(a) * 22;
      var cpx1 = Math.cos(a - 0.6) * 30;
      var cpy1 = Math.sin(a - 0.6) * 30;
      var cpx2 = Math.cos(a + 0.6) * 30;
      var cpy2 = Math.sin(a + 0.6) * 30;
      paths += '<path d="M0 0 C' + cpx1.toFixed(1) + " " + cpy1.toFixed(1) +
               " " + cpx2.toFixed(1) + " " + cpy2.toFixed(1) +
               " " + px.toFixed(1) + " " + py.toFixed(1) + ' Z" fill="' +
               col + '" opacity="0.7"/>';
    }
    // Stem
    var stemLen = 18 + (h % 8);
    return '<svg viewBox="-40 -45 80 90" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<g stroke="' + col + '" stroke-width="1">' + paths + '</g>' +
      '<circle cx="0" cy="0" r="5" fill="' + col + '" opacity="0.9"/>' +
      '<line x1="0" y1="0" x2="0" y2="' + stemLen + '" stroke="#4A5D23" stroke-width="1.5"/>' +
      '<path d="M0 ' + (stemLen - 6) + ' Q6 ' + (stemLen - 10) + ' 4 ' + (stemLen - 14) + '"' +
             ' fill="rgba(74,93,35,0.6)" stroke="#4A5D23" stroke-width="0.8"/>' +
      '</svg>';
  }

  function generateFeyIdentity(mortalName) {
    var h = hashName(mortalName);
    var prefix = FEY_PREFIX[h % FEY_PREFIX.length];
    var suffix = FEY_SUFFIX[Math.floor(h / FEY_PREFIX.length) % FEY_SUFFIX.length];
    var feyName = prefix + suffix;
    var court = COURTS[h % 2];
    var element = weightedPick(ELEMENTS, (h >> 4));
    var sigil = generateSigilSVG(element, h);
    return { feyName: feyName, court: court, element: element, sigil: sigil };
  }

  function renderNamingResult(identity) {
    return '<div class="naming-ledger">' +
      '<div class="naming-sigil">' + identity.sigil + '</div>' +
      '<div class="naming-text">' +
        '<p class="naming-decree">\u2727 Be it known to both Courts\u2026 \u2727</p>' +
        '<p class="naming-feyname">' + identity.feyName + '</p>' +
        '<p class="naming-court">Court: ' + identity.court + '</p>' +
        '<p class="naming-element">Element: ' + identity.element.name + ' \u00B7 ' + identity.element.title + '</p>' +
        '<p class="naming-verse">\u2727 ' + identity.element.flavor + ' \u2727</p>' +
        '<button class="cast-btn" id="namingCopyBtn" type="button">[ Copy to Grimoire ]</button>' +
        '<span class="naming-copy-feedback" id="namingCopyFeedback" aria-live="polite"></span>' +
      '</div>' +
    '</div>';
  }

  function initNamingPool() {
    var ministrySection = document.querySelector('[aria-labelledby="ministry-title"]');
    if (!ministrySection) return;

    var section = document.createElement("section");
    section.className = "section";
    section.id = "namingPoolSection";
    section.setAttribute("aria-labelledby", "naming-title");
    section.innerHTML =
      '<div class="druid-sigil" aria-hidden="true"></div>' +
      '<div class="section-head"><h2 class="section-title" id="naming-title">The Naming Pool</h2></div>' +
      '<p class="section-sub">speak your mortal name into the water\u2026</p>' +
      '<div class="naming-input-wrap">' +
        '<input class="naming-input" id="namingInput" type="text" placeholder="your mortal name\u2026" autocomplete="off" />' +
        '<button class="cast-btn" id="namingBtn" type="button">[ Seek Your Name ]</button>' +
      '</div>' +
      '<div id="namingResult" aria-live="polite"></div>';

    var wwEl = document.getElementById("witherWoodSection");
    var npAnchor = wwEl || ministrySection;
    npAnchor.parentNode.insertBefore(section, npAnchor.nextSibling);

    // Restore previous result
    var saved = feyState.get("trueNameInput");
    if (saved) {
      var savedResult = feyState.get("trueNameResult");
      if (savedResult) {
        document.getElementById("namingInput").value = saved;
        var identity = generateFeyIdentity(saved);
        document.getElementById("namingResult").innerHTML = renderNamingResult(identity);
        attachCopyHandler(identity);
      }
    }

    document.getElementById("namingBtn").addEventListener("click", function () {
      var val = document.getElementById("namingInput").value.trim();
      if (!val) return;
      var isFirst = !feyState.get("trueNameInput");
      feyState.set("trueNameInput", val);
      var identity = generateFeyIdentity(val);
      feyState.set("trueNameResult", { feyName: identity.feyName, court: identity.court });
      document.getElementById("namingResult").innerHTML = renderNamingResult(identity);
      attachCopyHandler(identity);
      if (isFirst) grantBelief("trueNameFirst");
      spawnBurst(window.innerWidth / 2, window.innerHeight / 2, 14, "spark");
    });

    document.getElementById("namingInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("namingBtn").click();
      }
    });
  }

  function attachCopyHandler(identity) {
    var btn = document.getElementById("namingCopyBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var text = "\u2727 Be it known to both Courts\u2026 \u2727\n" +
        "Fey Name: " + identity.feyName + "\n" +
        "Court: " + identity.court + "\n" +
        "Element: " + identity.element.name + " \u00B7 " + identity.element.title + "\n" +
        "\u2727 " + identity.element.flavor + " \u2727\n" +
        "\nLittle Druids \u2014 Ministry of Moss & Mushrooms";
      var feedback = document.getElementById("namingCopyFeedback");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          feedback.textContent = "copied!";
          setTimeout(function () { feedback.textContent = ""; }, 2000);
        }).catch(function () { fallbackCopy(text, feedback); });
      } else {
        fallbackCopy(text, feedback);
      }
    });
  }

  function fallbackCopy(text, feedback) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      if (feedback) { feedback.textContent = "copied!"; setTimeout(function () { feedback.textContent = ""; }, 2000); }
    } catch (e) { /* silently ignore */ }
    document.body.removeChild(ta);
  }

  /* ----------------------------------------------------------------
     9. LIVING CODEX (Feature 6)
  ---------------------------------------------------------------- */
  // Venus Flytrap SVG widget
  var VENUS_WIDGET_SVG =
    '<svg class="venus-trap" viewBox="0 0 60 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:60px;height:80px;cursor:pointer" aria-label="Venus flytrap — tap to close" role="button" tabindex="0">' +
    '<g stroke="#4A5D23" stroke-width="1.2" stroke-linecap="round">' +
    // Stem
    '<line x1="30" y1="80" x2="30" y2="42" stroke-width="1.8"/>' +
    '<path d="M30 65 Q18 62 15 52" stroke-width="1"/>' +
    '<path d="M30 60 Q42 56 45 48" stroke-width="1"/>' +
    // Trap body
    '<g class="trap-body">' +
      // Bottom jaw
      '<path d="M12 48 Q30 55 48 48 L30 42 Z" fill="rgba(45,138,80,0.35)" stroke-width="1.3"/>' +
      // Top jaw (the snapping part)
      '<path class="trap-jaw-top" d="M12 48 Q30 40 48 48 L30 42 Z" fill="rgba(45,138,80,0.45)" stroke-width="1.3"/>' +
      // Teeth
      '<path d="M15 47 L13 44 M19 48.5 L18 45 M24 49.5 L23 46 M29 50 L28 46.5 M34 50 L33 46.5 M39 49.5 L38 46 M44 48.5 L43 45 M47 47 L46 44" stroke-width="0.9"/>' +
    '</g>' +
    '</g>' +
    '</svg>';

  // Fittonia companion SVG
  function fittoniaCompanionSVG() {
    return '<svg class="fittonia-svg wilted" viewBox="0 0 70 60" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:70px;height:60px" aria-hidden="true">' +
      '<g stroke="#b97f94" stroke-width="1.2" stroke-linecap="round">' +
      '<line x1="35" y1="58" x2="35" y2="35" stroke="#4A5D23" stroke-width="1.6"/>' +
      // Left leaf
      '<path class="leaf" d="M35 42 Q18 36 14 24 Q22 20 30 30 Q33 35 35 42" fill="rgba(212,165,184,0.3)" stroke="#b97f94"/>' +
      // Right leaf
      '<path class="leaf" d="M35 42 Q52 36 56 24 Q48 20 40 30 Q37 35 35 42" fill="rgba(212,165,184,0.3)" stroke="#b97f94"/>' +
      // Veins
      '<path d="M20 27 Q25 30 29 35" stroke-width="0.8" opacity="0.7"/>' +
      '<path d="M50 27 Q45 30 41 35" stroke-width="0.8" opacity="0.7"/>' +
      '</g>' +
      '</svg>';
  }

  function initLivingCodex() {
    var cards = document.querySelectorAll(".codex-card[data-magic]");
    if (!cards.length) return;

    cards.forEach(function (card) {
      var magic = card.dataset.magic;
      var trigger = card.querySelector(".codex-trigger");
      var careDiv = card.querySelector(".codex-care");
      var photoDiv = card.querySelector(".codex-photo");

      switch (magic) {
        case "venus":
          setupVenusCard(card, careDiv, trigger);
          break;
        case "fittonia":
          setupFittoniaCard(card, careDiv, trigger);
          break;
        case "sun-shimmer":
          setupSunShimmer(card, photoDiv, trigger);
          break;
        case "leaf-sway":
          setupLeafSway(card, photoDiv, trigger);
          break;
        case "moonglow":
          setupMoonglow(card, photoDiv, trigger);
          break;
      }
    });
  }

  function setupVenusCard(card, careDiv, trigger) {
    if (!careDiv) return;
    var widget = document.createElement("div");
    widget.className = "venus-widget";
    widget.innerHTML = VENUS_WIDGET_SVG;
    careDiv.appendChild(widget);

    var trapEl = widget.querySelector(".venus-trap");
    var trapJaw = widget.querySelector(".trap-jaw-top");

    function snapTrap() {
      if (trapEl.classList.contains("snapping")) return;
      trapEl.classList.add("snapping");
      // Flash the rule
      var ruleRow = card.querySelector(".care-row.rule");
      if (ruleRow) {
        ruleRow.classList.add("scold");
        setTimeout(function () { ruleRow.classList.remove("scold"); }, 2000);
      }
      grantBelief("venusTapped");
      setTimeout(function () { trapEl.classList.remove("snapping"); }, 1200);
    }

    trapEl.addEventListener("click", snapTrap);
    trapEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); snapTrap(); }
    });

    // IntersectionObserver to enable/disable breathing animation class
    if (!reducedMotion && "IntersectionObserver" in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var trapBody = widget.querySelector(".trap-body");
          if (trapBody) {
            trapBody.style.animationPlayState = entry.isIntersecting && card.classList.contains("open") ? "running" : "paused";
          }
        });
      }, { threshold: 0.3 });
      obs.observe(card);
    }
  }

  function setupFittoniaCard(card, careDiv, trigger) {
    if (!careDiv) return;
    var companion = document.createElement("div");
    companion.className = "fittonia-companion";
    companion.innerHTML = fittoniaCompanionSVG() +
      '<button class="cast-btn fittonia-water-btn" type="button">[ \uD83D\uDCA7 Give it a drink ]</button>';
    careDiv.appendChild(companion);

    var svg = companion.querySelector(".fittonia-svg");
    var btn = companion.querySelector(".fittonia-water-btn");

    btn.addEventListener("click", function () {
      if (svg.classList.contains("perked")) return;
      svg.classList.remove("wilted");
      svg.classList.add("perked");
      var rect = svg.getBoundingClientRect();
      spawnBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 8, "spark", "#D4A5B8");
      grantBelief("fittoniaWatered");
    });

    // Wilt again when card closes
    if (trigger) {
      trigger.addEventListener("click", function () {
        if (!card.classList.contains("open")) {
          // card just closed
          setTimeout(function () {
            svg.classList.remove("perked");
            svg.classList.add("wilted");
          }, 400);
        }
      });
    }
  }

  function setupSunShimmer(card, photoDiv, trigger) {
    if (!photoDiv || reducedMotion) return;
    function enable() { if (card.classList.contains("open")) photoDiv.classList.add("sun-shimmer-active"); }
    function disable() { photoDiv.classList.remove("sun-shimmer-active"); }
    if (trigger) trigger.addEventListener("click", function () {
      card.classList.contains("open") ? disable() : enable();
    });
    if (card.classList.contains("open")) enable();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? enable() : disable();
      }, { threshold: 0.2 }).observe(card);
    }
  }

  function setupLeafSway(card, photoDiv, trigger) {
    if (!photoDiv || reducedMotion) return;
    function enable() { if (card.classList.contains("open")) photoDiv.classList.add("leaf-sway-active"); }
    function disable() { photoDiv.classList.remove("leaf-sway-active"); }
    if (trigger) trigger.addEventListener("click", function () {
      card.classList.contains("open") ? disable() : enable();
    });
    if (card.classList.contains("open")) enable();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? enable() : disable();
      }, { threshold: 0.2 }).observe(card);
    }
  }

  function setupMoonglow(card, photoDiv, trigger) {
    if (!photoDiv) return;
    // Make sure photoDiv is positioned
    photoDiv.style.position = "relative";
    var overlay = document.createElement("div");
    overlay.className = "moonglow-overlay";
    photoDiv.appendChild(overlay);
    function enable() { if (!reducedMotion && card.classList.contains("open")) overlay.classList.add("active"); }
    function disable() { overlay.classList.remove("active"); }
    if (trigger) trigger.addEventListener("click", function () {
      card.classList.contains("open") ? disable() : enable();
    });
    if (card.classList.contains("open")) enable();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? enable() : disable();
      }, { threshold: 0.2 }).observe(card);
    }
  }

  /* ----------------------------------------------------------------
     10. WILDSHAPE COMPANION (Feature 7)
  ---------------------------------------------------------------- */
  var BUTTERFLY_SVG =
    '<svg viewBox="0 0 64 78" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<g stroke="#b97f94" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
    // Upper wings
    '<path d="M32 38 C16 18 2 22 5 36 C8 48 24 44 32 38 Z" fill="rgba(212,165,184,0.4)"/>' +
    '<path d="M32 38 C48 18 62 22 59 36 C56 48 40 44 32 38 Z" fill="rgba(212,165,184,0.4)"/>' +
    // Lower wings
    '<path d="M32 42 C18 54 8 58 10 66 C16 72 28 54 32 42 Z" fill="rgba(212,165,184,0.28)"/>' +
    '<path d="M32 42 C46 54 56 58 54 66 C48 72 36 54 32 42 Z" fill="rgba(212,165,184,0.28)"/>' +
    // Body
    '<line x1="32" y1="30" x2="32" y2="55" stroke-width="1.8"/>' +
    // Antennae
    '<path d="M32 30 L26 18 M26 18 L24 14"/>' +
    '<path d="M32 30 L38 18 M38 18 L40 14"/>' +
    '<circle cx="24" cy="13" r="2" fill="#b97f94"/>' +
    '<circle cx="40" cy="13" r="2" fill="#b97f94"/>' +
    '</g>' +
    '</svg>';

  var WISP_SVG =
    '<svg viewBox="0 0 64 78" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="32" cy="36" r="14" fill="rgba(180,220,255,0.35)" stroke="rgba(140,190,230,0.7)" stroke-width="1.2"/>' +
    '<circle cx="32" cy="36" r="8" fill="rgba(200,230,255,0.5)"/>' +
    '<circle cx="32" cy="36" r="3" fill="rgba(220,240,255,0.9)"/>' +
    '<path d="M32 50 Q28 58 32 68 Q36 58 32 50" fill="rgba(180,220,255,0.25)" stroke="rgba(140,190,230,0.5)" stroke-width="0.8"/>' +
    '</svg>';

  var STAG_SVG =
    '<svg viewBox="0 0 64 78" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<g stroke="#4A5D23" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    // Body
    '<ellipse cx="32" cy="50" rx="14" ry="9" fill="rgba(74,93,35,0.15)"/>' +
    // Neck + head
    '<path d="M26 44 L24 34"/>' +
    '<ellipse cx="22" cy="30" rx="6" ry="5" fill="rgba(74,93,35,0.15)"/>' +
    // Antlers
    '<path d="M20 26 L16 16 M16 16 L12 12 M16 16 L14 10"/>' +
    '<path d="M24 26 L26 16 M26 16 L30 12 M26 16 L28 10"/>' +
    // Legs
    '<path d="M24 58 L22 70 M28 59 L27 71 M36 59 L37 71 M40 58 L42 70"/>' +
    // Tail
    '<path d="M46 46 Q52 42 50 38" stroke-width="1"/>' +
    '</g>' +
    '</svg>';

  var FROG_SVG =
    '<svg viewBox="0 0 64 78" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<g stroke="#2d8a50" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    // Body
    '<ellipse cx="32" cy="50" rx="16" ry="12" fill="rgba(45,138,80,0.2)"/>' +
    // Head
    '<ellipse cx="32" cy="36" rx="13" ry="10" fill="rgba(45,138,80,0.2)"/>' +
    // Eyes
    '<circle cx="24" cy="30" r="5" fill="rgba(45,138,80,0.3)"/>' +
    '<circle cx="40" cy="30" r="5" fill="rgba(45,138,80,0.3)"/>' +
    '<circle cx="24" cy="30" r="2.5" fill="#2d8a50"/>' +
    '<circle cx="40" cy="30" r="2.5" fill="#2d8a50"/>' +
    // Smile
    '<path d="M24 44 Q32 48 40 44" stroke-width="1"/>' +
    // Front legs
    '<path d="M16 54 Q8 58 6 64 M16 56 Q10 62 8 66"/>' +
    '<path d="M48 54 Q56 58 58 64 M48 56 Q54 62 56 66"/>' +
    // Back legs
    '<path d="M20 60 Q12 68 8 72 M24 62 Q18 70 14 74"/>' +
    '<path d="M44 60 Q52 68 56 72 M40 62 Q46 70 50 74"/>' +
    '</g>' +
    '</svg>';

  var SHAPES = [
    { id:"butterfly", svg: BUTTERFLY_SVG },
    { id:"wisp",      svg: WISP_SVG },
    { id:"stag",      svg: STAG_SVG },
    { id:"frog",      svg: FROG_SVG }
  ];

  var _currentForm = "fairy";
  var _wildshapeTimer = null;
  var _wildshapeRevertTimer = null;
  var _fairy = document.querySelector(".fey-fairy");
  var _fairyFlip = _fairy ? _fairy.querySelector(".fairy-flip") : null;
  var _wildshapeOverlay = null;

  function createWildshapeOverlay() {
    if (!_fairy) return;
    _wildshapeOverlay = document.createElement("div");
    _wildshapeOverlay.id = "wildshapeOverlay";
    _wildshapeOverlay.hidden = true;
    _fairy.appendChild(_wildshapeOverlay);
    _fairy.addEventListener("click", function () {
      if (!document.body.classList.contains("fey-sight")) return;
      var now = Date.now();
      if (now - feyState.get("lastCompanionTap") < 60000) return;
      feyState.set("lastCompanionTap", now);
      doWildshape(true);
      grantBelief("companionTapped");
    });
  }

  function getNextForm() {
    var others = SHAPES.filter(function (s) { return s.id !== _currentForm; });
    return others[Math.floor(Math.random() * others.length)];
  }

  function doWildshape(immediate) {
    if (!_fairy) return;
    var rect = _fairy.getBoundingClientRect();
    spawnBurst(rect.left + rect.width / 2, rect.top + rect.height / 2,
      immediate ? 16 : 10, "spark");

    if (_currentForm === "fairy") {
      var next = getNextForm();
      _currentForm = next.id;
      if (_fairyFlip) _fairyFlip.hidden = true;
      if (_wildshapeOverlay) {
        _wildshapeOverlay.innerHTML = next.svg;
        _wildshapeOverlay.hidden = false;
      }
      var revertDelay = 8000 + Math.random() * 4000;
      _wildshapeRevertTimer = setTimeout(function () {
        _wildshapeRevertTimer = null;
        if (_currentForm !== "fairy") doWildshape(false);
      }, revertDelay);
    } else {
      // Return to fairy
      if (_wildshapeRevertTimer) { clearTimeout(_wildshapeRevertTimer); _wildshapeRevertTimer = null; }
      _currentForm = "fairy";
      if (_fairyFlip) _fairyFlip.hidden = false;
      if (_wildshapeOverlay) {
        _wildshapeOverlay.innerHTML = "";
        _wildshapeOverlay.hidden = true;
      }
    }
  }

  function scheduleWildshape() {
    if (_wildshapeTimer) clearTimeout(_wildshapeTimer);
    if (!document.body.classList.contains("fey-sight")) return;
    var delay = 30000 + Math.random() * 30000;
    _wildshapeTimer = setTimeout(function () {
      if (_currentForm === "fairy") doWildshape(false);
      scheduleWildshape();
    }, delay);
  }

  function returnToFairyForm() {
    if (_currentForm !== "fairy") {
      _currentForm = "fairy";
      if (_fairyFlip) _fairyFlip.hidden = false;
      if (_wildshapeOverlay) { _wildshapeOverlay.innerHTML = ""; _wildshapeOverlay.hidden = true; }
    }
    if (_wildshapeRevertTimer) { clearTimeout(_wildshapeRevertTimer); _wildshapeRevertTimer = null; }
    if (_wildshapeTimer) { clearTimeout(_wildshapeTimer); _wildshapeTimer = null; }
  }

  function initWildshape() {
    if (!_fairy || reducedMotion) return;
    createWildshapeOverlay();

    // Watch fey-sight class changes
    var bodyObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === "class") {
          if (document.body.classList.contains("fey-sight")) {
            scheduleWildshape();
          } else {
            returnToFairyForm();
          }
        }
      });
    });
    bodyObs.observe(document.body, { attributes: true });

    // If fey sight is already active on load
    if (document.body.classList.contains("fey-sight")) scheduleWildshape();
  }

  /* ----------------------------------------------------------------
     11. SCRYING POOL (Feature 9)
  ---------------------------------------------------------------- */
  var PROPHECIES = [
    "A bloom chosen in haste still blooms in earnest. The forest does not regret.",
    "The moss grows where it will. So, too, does belief.",
    "Three seeds buried in grief became the garden.",
    "You carry something that once grew wild. It remembers.",
    "The mushroom ring is not a warning \u2014 it is an invitation.",
    "Something you lost in autumn has been tended by the roots all winter.",
    "The fey do not forget a kind word. Neither does the earth.",
    "Your name was once spoken by a river. The river has not forgotten.",
    "There are faeries behind this word: \u2727. They are watching you read.",
    "The drought of belief ends one thread at a time. You have already begun."
  ];

  function ScryPool(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    var isMobile = window.innerWidth < 600;
    this.bW = isMobile ? canvas.width >> 1 : canvas.width;
    this.bH = isMobile ? canvas.height >> 1 : canvas.height;
    this.buf0 = new Float32Array(this.bW * this.bH);
    this.buf1 = new Float32Array(this.bW * this.bH);
    this.DAMP = 0.97;
    this.poolImageData = null;
    this.rafId = null;
    this.stillTimer = null;
    this._running = false;
    this.buildBaseImage();
  }

  ScryPool.prototype.buildBaseImage = function () {
    var ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    // Draw base pool texture
    ctx.clearRect(0, 0, W, H);
    var grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    grad.addColorStop(0, "rgba(25,38,52,0.95)");
    grad.addColorStop(0.5, "rgba(35,52,40,0.85)");
    grad.addColorStop(1, "rgba(50,65,35,0.7)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Lily pads
    ctx.strokeStyle = "rgba(74,93,35,0.5)";
    ctx.fillStyle = "rgba(74,93,35,0.2)";
    ctx.lineWidth = 1;
    [[W * 0.3, H * 0.35, 18], [W * 0.7, H * 0.6, 14], [W * 0.55, H * 0.25, 10]].forEach(function (pad) {
      ctx.beginPath();
      ctx.arc(pad[0], pad[1], pad[2], 0.2, Math.PI * 1.8);
      ctx.lineTo(pad[0], pad[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    // Faint antler sigil reflection
    ctx.strokeStyle = "rgba(184,150,90,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2, H * 0.7);
    ctx.lineTo(W / 2, H * 0.4);
    ctx.stroke();
    ctx.restore();
    this.poolImageData = ctx.getImageData(0, 0, W, H);
    this.renderImageData = ctx.createImageData(W, H);
  };

  ScryPool.prototype.addRipple = function (bx, by, strength) {
    strength = strength || 600;
    var idx = (by | 0) * this.bW + (bx | 0);
    if (idx >= 0 && idx < this.buf0.length) this.buf0[idx] = strength;
    var self = this;
    clearTimeout(this.stillTimer);
    this.stillTimer = setTimeout(function () { self.onStill(); }, 2000);
    this.ensureRunning();
  };

  ScryPool.prototype.step = function () {
    var b0 = this.buf0, b1 = this.buf1, bW = this.bW, bH = this.bH, D = this.DAMP;
    for (var y = 1; y < bH - 1; y++) {
      for (var x = 1; x < bW - 1; x++) {
        var i = y * bW + x;
        b1[i] = ((b0[i - 1] + b0[i + 1] + b0[i - bW] + b0[i + bW]) * 0.5 - b1[i]) * D;
      }
    }
    var tmp = this.buf0; this.buf0 = this.buf1; this.buf1 = tmp;
  };

  ScryPool.prototype.render = function () {
    var ctx = this.ctx;
    var W = this.canvas.width, H = this.canvas.height;
    var bW = this.bW, bH = this.bH;
    var pool = this.poolImageData;
    var buf = this.buf0;
    var scale = W / bW;

    var imgData = this.renderImageData;
    var pix = imgData.data;
    var src = pool.data;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var bx = (x / scale) | 0;
        var by = (y / scale) | 0;
        var bi = by * bW + bx;
        var dx = (buf[bi] - buf[Math.max(0, bi - 1)]) * 2.5;
        var dy = (buf[bi] - buf[Math.max(0, bi - bW)]) * 2.5;
        var sx = Math.min(W - 1, Math.max(0, (x + dx) | 0));
        var sy = Math.min(H - 1, Math.max(0, (y + dy) | 0));
        var si = (sy * W + sx) * 4;
        var di = (y * W + x) * 4;
        pix[di]     = src[si];
        pix[di + 1] = src[si + 1];
        pix[di + 2] = src[si + 2];
        pix[di + 3] = src[si + 3];
      }
    }
    ctx.putImageData(imgData, 0, 0);
  };

  ScryPool.prototype.tick = function () {
    this.step();
    this.render();
    var maxVal = 0;
    for (var i = 0; i < this.buf0.length; i++) {
      var v = Math.abs(this.buf0[i]);
      if (v > maxVal) maxVal = v;
      if (maxVal > 0.5) break;
    }
    if (maxVal < 0.5) { this.rafId = null; return; }
    var self = this;
    this.rafId = requestAnimationFrame(function (ts) { self.tick(ts); });
  };

  ScryPool.prototype.ensureRunning = function () {
    if (!this.rafId) {
      var self = this;
      this.rafId = requestAnimationFrame(function (ts) { self.tick(ts); });
    }
  };

  ScryPool.prototype.onStill = function () {
    var visionEl = document.getElementById("scryVision");
    if (!visionEl || visionEl.textContent) return;
    visionEl.style.opacity = "0";
    var text = pickVision();
    var self = this;
    setTimeout(function () {
      visionEl.textContent = "\u2727 " + text + " \u2727";
      visionEl.style.opacity = "1";
    }, 300);
  };

  function pickVision() {
    var roll = Math.random();
    if (roll < 0.5 || !window.ldSpecimens) {
      return PROPHECIES[Math.floor(Math.random() * PROPHECIES.length)];
    } else if (roll < 0.8) {
      // Product spotlight
      var titles = document.querySelectorAll(".card-title");
      if (!titles.length) return PROPHECIES[0];
      var t = titles[Math.floor(Math.random() * titles.length)];
      return "The pool turns to: " + t.textContent.replace(/✧/g, "").trim();
    } else {
      // Care tip
      var s = window.ldSpecimens[Math.floor(Math.random() * window.ldSpecimens.length)];
      return "\u201c" + s.name + "\u201d whispers: " + s.water;
    }
  }

  function initScryingPool() {
    var ministrySection = document.querySelector('[aria-labelledby="ministry-title"]');
    if (!ministrySection) return;

    var section = document.createElement("section");
    section.className = "section";
    section.id = "scrySection";
    section.setAttribute("aria-labelledby", "scry-title");

    if (reducedMotion) {
      section.innerHTML =
        '<div class="druid-sigil" aria-hidden="true"></div>' +
        '<div class="section-head"><h2 class="section-title" id="scry-title">The Scrying Pool</h2></div>' +
        '<p class="section-sub">gaze into the water and let the Feywild speak\u2026</p>' +
        '<div class="scry-pool-wrap">' +
          '<p class="scry-static">\u2727 ' + PROPHECIES[Math.floor(Math.random() * PROPHECIES.length)] + ' \u2727</p>' +
        '</div>';
    } else {
      section.innerHTML =
        '<div class="druid-sigil" aria-hidden="true"></div>' +
        '<div class="section-head"><h2 class="section-title" id="scry-title">The Scrying Pool</h2></div>' +
        '<p class="section-sub">gaze into the water and let the Feywild speak\u2026</p>' +
        '<div class="scry-pool-wrap">' +
          '<canvas id="scryCanvas" width="320" height="180" aria-label="Scrying pool \u2014 touch to send ripples"></canvas>' +
          '<p class="scry-vision" id="scryVision"></p>' +
          '<button class="cast-btn" id="scryAgainBtn" type="button">[ Scry Again \u2727 ]</button>' +
        '</div>';
    }

    var npEl = document.getElementById("namingPoolSection");
    var scryAnchor = npEl || document.getElementById("witherWoodSection") || ministrySection;
    scryAnchor.parentNode.insertBefore(section, scryAnchor.nextSibling);

    if (reducedMotion) return;

    var scryCanvas = document.getElementById("scryCanvas");
    var pool = new ScryPool(scryCanvas);

    // Ripple on pointer interaction
    scryCanvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var rect = scryCanvas.getBoundingClientRect();
      pool.addRipple(
        (e.clientX - rect.left) / rect.width * pool.bW,
        (e.clientY - rect.top) / rect.height * pool.bH
      );
      var visionEl = document.getElementById("scryVision");
      if (visionEl) visionEl.textContent = "";
    });

    scryCanvas.addEventListener("pointermove", function (e) {
      if (!(e.buttons & 1) && e.pointerType !== "touch") return;
      e.preventDefault();
      var rect = scryCanvas.getBoundingClientRect();
      pool.addRipple(
        (e.clientX - rect.left) / rect.width * pool.bW,
        (e.clientY - rect.top) / rect.height * pool.bH,
        300
      );
    });

    // Scry Again
    document.getElementById("scryAgainBtn").addEventListener("click", function () {
      var visionEl = document.getElementById("scryVision");
      if (visionEl) visionEl.textContent = "";
      pool.addRipple(pool.bW / 2, pool.bH / 2, 1200);
    });

    // Pause when off-screen
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          pool.ensureRunning();
        } else {
          if (pool.rafId) { cancelAnimationFrame(pool.rafId); pool.rafId = null; }
        }
      }).observe(scryCanvas);
    }
  }

  /* ----------------------------------------------------------------
     12. LIGHTBOX
  ---------------------------------------------------------------- */
  function initLightbox() {
    // Build overlay
    var lb = document.createElement("div");
    lb.id = "feyLightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Image viewer");
    lb.innerHTML =
      '<button id="feyLightboxClose" type="button" aria-label="Close">\u00d7 close</button>' +
      '<img id="feyLightboxImg" alt="" />';
    document.body.appendChild(lb);

    var img = document.getElementById("feyLightboxImg");

    function openLightbox(src, alt) {
      img.src = src;
      img.alt = alt || "";
      lb.classList.add("open");
      document.addEventListener("keydown", onKey);
    }

    function closeLightbox() {
      lb.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      // Clear src after transition so old image doesn't flash next open
      setTimeout(function () { if (!lb.classList.contains("open")) img.src = ""; }, 260);
    }

    function onKey(e) { if (e.key === "Escape") closeLightbox(); }

    // Close on backdrop click (not on the image itself)
    lb.addEventListener("click", function (e) {
      if (e.target === lb) closeLightbox();
    });
    document.getElementById("feyLightboxClose").addEventListener("click", closeLightbox);

    // Attach to all qualifying images — use event delegation on document
    // so it also catches carousel images loaded dynamically
    var touchMoved = false;
    document.addEventListener("touchstart", function () { touchMoved = false; }, { passive: true });
    document.addEventListener("touchmove",  function () { touchMoved = true;  }, { passive: true });

    document.addEventListener("click", function (e) {
      if (touchMoved) return; // was a swipe, not a tap
      var target = e.target;
      if (target.tagName !== "IMG") return;
      // Only images inside image frames or carousels
      var inFrame    = target.closest(".image-frame");
      var inCarousel = target.closest(".carousel-track");
      if (!inFrame && !inCarousel) return;
      // Don't open if it's the broken-image fallback (no src)
      if (!target.src || target.classList.contains("broken")) return;
      e.stopPropagation(); // don't let carousel swipe logic misfire
      openLightbox(target.src, target.alt);
    });
  }

  /* ----------------------------------------------------------------
     INIT — lazy via DOMContentLoaded (magic.js is deferred so DOM ready)
  ---------------------------------------------------------------- */
  function init() {
    initDayNight();
    initTrails();
    initSurges();
    initWitheredWood();
    initRiddleDoor();
    initNamingPool();
    initLivingCodex();
    initWildshape();
    initScryingPool();
    initLightbox();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
