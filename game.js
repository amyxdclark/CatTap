(function () {
  "use strict";

  /* ===== DOM References ===== */
  var canvas = document.getElementById("gameCanvas");
  var ctx = canvas.getContext("2d");
  var scoreDisplay = document.getElementById("scoreDisplay");
  var timerDisplay = document.getElementById("timerDisplay");
  var modeIndicator = document.getElementById("modeIndicator");
  var settingsBtn = document.getElementById("settingsBtn");
  var settingsModal = document.getElementById("settingsModal");
  var closeSettingsBtn = document.getElementById("closeSettings");
  var gameOverOverlay = document.getElementById("gameOver");
  var finalScoreEl = document.getElementById("finalScore");
  var playAgainBtn = document.getElementById("playAgainBtn");

  /* ===== Settings Controls ===== */
  var settingMode = document.getElementById("settingMode");
  var settingDifficulty = document.getElementById("settingDifficulty");
  var settingTrail = document.getElementById("settingTrail");
  var settingBackground = document.getElementById("settingBackground");
  var settingSize = document.getElementById("settingSize");
  var settingSound = document.getElementById("settingSound");
  var settingVibration = document.getElementById("settingVibration");
  var settingTimer = document.getElementById("settingTimer");

  /* ===== Game State ===== */
  var W = 0;
  var H = 0;
  var score = 0;
  var uiLocked = true;
  var settingsOpen = false;
  var gameRunning = true;
  var timerActive = false;
  var timeLeft = 60;
  var timerInterval = null;
  var userHasInteracted = false;
  var animationId = null;

  /* ===== Settings State ===== */
  var settings = {
    mode: "laser",
    difficulty: "medium",
    trail: "medium",
    background: "dark",
    targetSize: "large",
    sound: false,
    vibration: false,
    timer: false
  };

  /* ===== Constants ===== */
  var MAX_FRAME_TIME = 0.05;
  var JITTER_FREQUENCY = 0.003;
  var JITTER_AMPLITUDE = 30;

  /* ===== Difficulty Speed Map ===== */
  var speedMap = { slow: 1.5, medium: 3, fast: 5 };
  var trailMap = { low: 5, medium: 12, high: 24 };

  /* ===== Prey State ===== */
  var prey = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    targetX: 0,
    targetY: 0,
    radius: 18,
    hitRadius: 60,
    color: "#ff0033",
    phase: "moving",     /* moving, pausing, hiding */
    phaseTimer: 0,
    hideTarget: null,
    legAngle: 0
  };

  /* ===== Trail Particles ===== */
  var trail = [];

  /* ===== Burst Particles ===== */
  var bursts = [];

  /* ===== Obstacle (hide-and-peek shape) ===== */
  var obstacle = {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    visible: false
  };

  /* ===== Audio Context (lazy init) ===== */
  var audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    return audioCtx;
  }

  function playPing() {
    if (!settings.sound || !userHasInteracted) return;
    var ac = getAudioContext();
    if (!ac) return;
    if (ac.state === "suspended") {
      ac.resume();
    }
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ac.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.15);
  }

  function vibrate() {
    if (settings.vibration && navigator.vibrate) {
      navigator.vibrate(30);
    }
  }

  /* ===== Canvas Sizing ===== */
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();

  /* ===== Theme Application ===== */
  function applyTheme() {
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.classList.add("theme-" + settings.background);
  }

  /* ===== Prey Initialization ===== */
  function initPrey() {
    prey.x = W * 0.5;
    prey.y = H * 0.5;
    prey.vx = 0;
    prey.vy = 0;
    pickNewTarget();
    prey.radius = settings.targetSize === "xlarge" ? 26 : 18;
    prey.hitRadius = settings.targetSize === "xlarge" ? 80 : 60;
    prey.phase = "moving";
    prey.phaseTimer = 0;

    if (settings.mode === "laser") {
      prey.color = "#ff0033";
    } else {
      prey.color = randomBugColor();
    }

    modeIndicator.textContent = settings.mode === "laser" ? "🔴 Laser" : "🐛 Bug";
    modeIndicator.classList.remove("hidden");
  }

  function randomBugColor() {
    var hue = Math.floor(Math.random() * 360);
    return "hsl(" + hue + ", 90%, 55%)";
  }

  function pickNewTarget() {
    var margin = 60;
    prey.targetX = margin + Math.random() * (W - margin * 2);
    prey.targetY = margin + Math.random() * (H - margin * 2);
  }

  /* ===== Obstacle ===== */
  function placeObstacle() {
    var margin = 120;
    obstacle.x = margin + Math.random() * (W - margin * 2 - obstacle.w);
    obstacle.y = margin + Math.random() * (H - margin * 2 - obstacle.h);
    obstacle.visible = true;
  }

  /* ===== Movement Logic ===== */
  var lastTime = 0;

  function updatePrey(dt, timestamp) {
    if (!gameRunning) return;

    var speed = speedMap[settings.difficulty];
    prey.phaseTimer -= dt;

    if (prey.phase === "pausing") {
      /* Slight jitter while pausing */
      prey.x += (Math.random() - 0.5) * 0.5;
      prey.y += (Math.random() - 0.5) * 0.5;
      if (prey.phaseTimer <= 0) {
        prey.phase = "moving";
        pickNewTarget();
        prey.phaseTimer = 2 + Math.random() * 4;
        /* Occasional hide phase */
        if (Math.random() < 0.15 && obstacle.visible) {
          prey.phase = "hiding";
          prey.targetX = obstacle.x + obstacle.w / 2;
          prey.targetY = obstacle.y + obstacle.h / 2;
          prey.phaseTimer = 1.5 + Math.random() * 2;
        }
      }
      return;
    }

    if (prey.phase === "hiding") {
      /* Move toward obstacle center */
      var hdx = prey.targetX - prey.x;
      var hdy = prey.targetY - prey.y;
      var hd = Math.sqrt(hdx * hdx + hdy * hdy);
      if (hd > 2) {
        prey.x += (hdx / hd) * speed * 80 * dt;
        prey.y += (hdy / hd) * speed * 80 * dt;
      }
      if (prey.phaseTimer <= 0) {
        prey.phase = "moving";
        pickNewTarget();
        prey.phaseTimer = 2 + Math.random() * 3;
      }
      return;
    }

    /* Moving phase */
    var dx = prey.targetX - prey.x;
    var dy = prey.targetY - prey.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 20) {
      /* Reached target: pause or pick new target */
      if (Math.random() < 0.35) {
        prey.phase = "pausing";
        prey.phaseTimer = 0.5 + Math.random() * 1.5;
      } else {
        pickNewTarget();
        prey.phaseTimer = 2 + Math.random() * 4;
      }
      return;
    }

    /* Smooth steering with curve arcs */
    var accel = speed * 120;
    var ax = (dx / dist) * accel;
    var ay = (dy / dist) * accel;

    /* Add perpendicular jitter for curves */
    var jitter = Math.sin(timestamp * JITTER_FREQUENCY) * speed * JITTER_AMPLITUDE;
    ax += (-dy / dist) * jitter;
    ay += (dx / dist) * jitter;

    prey.vx += ax * dt;
    prey.vy += ay * dt;

    /* Damping */
    var maxSpeed = speed * 200;
    var currentSpeed = Math.sqrt(prey.vx * prey.vx + prey.vy * prey.vy);
    if (currentSpeed > maxSpeed) {
      prey.vx = (prey.vx / currentSpeed) * maxSpeed;
      prey.vy = (prey.vy / currentSpeed) * maxSpeed;
    }

    prey.vx *= 0.96;
    prey.vy *= 0.96;

    prey.x += prey.vx * dt;
    prey.y += prey.vy * dt;

    /* Keep in bounds */
    var m = prey.radius + 10;
    if (prey.x < m) { prey.x = m; prey.vx = Math.abs(prey.vx); }
    if (prey.x > W - m) { prey.x = W - m; prey.vx = -Math.abs(prey.vx); }
    if (prey.y < m) { prey.y = m; prey.vy = Math.abs(prey.vy); }
    if (prey.y > H - m) { prey.y = H - m; prey.vy = -Math.abs(prey.vy); }

    /* Occasional burst of speed */
    if (prey.phaseTimer <= 0 && Math.random() < 0.01) {
      prey.vx += (Math.random() - 0.5) * speed * 300;
      prey.vy += (Math.random() - 0.5) * speed * 300;
      pickNewTarget();
      prey.phaseTimer = 2 + Math.random() * 3;
    }

    /* Bug mode: animate legs */
    if (settings.mode === "bug") {
      prey.legAngle += dt * 15;
    }
  }

  /* ===== Trail Update ===== */
  function updateTrail() {
    if (!gameRunning) return;
    var maxTrail = trailMap[settings.trail];
    trail.push({ x: prey.x, y: prey.y, life: 1, color: prey.color });
    if (trail.length > maxTrail * 3) {
      trail.splice(0, trail.length - maxTrail * 3);
    }
    for (var i = trail.length - 1; i >= 0; i--) {
      trail[i].life -= 0.03;
      if (trail[i].life <= 0) {
        trail.splice(i, 1);
      }
    }
  }

  /* ===== Burst Update ===== */
  function updateBursts(dt) {
    for (var i = bursts.length - 1; i >= 0; i--) {
      var b = bursts[i];
      b.life -= dt * 2;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 200 * dt; /* gravity */
      if (b.life <= 0) {
        bursts.splice(i, 1);
      }
    }
  }

  function spawnBurst(x, y, color) {
    for (var i = 0; i < 12; i++) {
      var angle = (Math.PI * 2 * i) / 12;
      var spd = 100 + Math.random() * 200;
      bursts.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1,
        color: color,
        radius: 3 + Math.random() * 5
      });
    }
  }

  /* ===== Drawing ===== */
  function drawBackground() {
    if (settings.background === "dark") {
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, W, H);
      /* Subtle carpet texture */
      ctx.fillStyle = "rgba(255,255,255,0.015)";
      for (var gx = 0; gx < W; gx += 20) {
        for (var gy = 0; gy < H; gy += 20) {
          if ((gx + gy) % 40 === 0) {
            ctx.fillRect(gx, gy, 10, 10);
          }
        }
      }
    } else {
      ctx.fillStyle = "#e8e0d4";
      ctx.fillRect(0, 0, W, H);
      /* Tile pattern */
      ctx.strokeStyle = "rgba(0,0,0,0.06)";
      ctx.lineWidth = 1;
      for (var tx = 0; tx < W; tx += 60) {
        ctx.beginPath();
        ctx.moveTo(tx, 0);
        ctx.lineTo(tx, H);
        ctx.stroke();
      }
      for (var ty = 0; ty < H; ty += 60) {
        ctx.beginPath();
        ctx.moveTo(0, ty);
        ctx.lineTo(W, ty);
        ctx.stroke();
      }
    }
  }

  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawObstacle() {
    if (!obstacle.visible) return;
    var c = settings.background === "dark" ? "rgba(40,40,70,0.8)" : "rgba(180,170,155,0.8)";
    ctx.fillStyle = c;
    drawRoundRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h, 12);
    ctx.fill();
  }

  function drawTrail() {
    for (var i = 0; i < trail.length; i++) {
      var t = trail[i];
      ctx.globalAlpha = t.life * 0.6;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, prey.radius * 0.4 * t.life, 0, Math.PI * 2);
      ctx.fill();

      /* Sparkle */
      if (Math.random() < 0.3) {
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = t.life * 0.8;
        var sx = t.x + (Math.random() - 0.5) * 12;
        var sy = t.y + (Math.random() - 0.5) * 12;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPrey() {
    /* When hiding, only show the part of the prey outside the obstacle */
    if (prey.phase === "hiding" && obstacle.visible) {
      ctx.save();
      ctx.beginPath();
      /* Clip to everything except the obstacle interior */
      ctx.rect(0, 0, W, obstacle.y);
      ctx.rect(0, obstacle.y, obstacle.x, obstacle.h);
      ctx.rect(obstacle.x + obstacle.w, obstacle.y, W - obstacle.x - obstacle.w, obstacle.h);
      ctx.rect(0, obstacle.y + obstacle.h, W, H - obstacle.y - obstacle.h);
      ctx.clip();
    }

    /* Glow */
    var glowSize = prey.radius * 3;
    var gradient = ctx.createRadialGradient(prey.x, prey.y, 0, prey.x, prey.y, glowSize);
    gradient.addColorStop(0, prey.color);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(prey.x, prey.y, glowSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* Main body */
    ctx.fillStyle = prey.color;
    ctx.beginPath();
    ctx.arc(prey.x, prey.y, prey.radius, 0, Math.PI * 2);
    ctx.fill();

    /* Inner highlight */
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(prey.x - prey.radius * 0.25, prey.y - prey.radius * 0.25, prey.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    /* Bug mode: draw legs */
    if (settings.mode === "bug") {
      ctx.strokeStyle = prey.color;
      ctx.lineWidth = 2;
      for (var l = 0; l < 6; l++) {
        var baseAngle = (Math.PI * 2 * l) / 6;
        var wobble = Math.sin(prey.legAngle + l * 1.5) * 0.3;
        var lx = prey.x + Math.cos(baseAngle + wobble) * (prey.radius + 8);
        var ly = prey.y + Math.sin(baseAngle + wobble) * (prey.radius + 8);
        ctx.beginPath();
        ctx.moveTo(
          prey.x + Math.cos(baseAngle) * prey.radius,
          prey.y + Math.sin(baseAngle) * prey.radius
        );
        ctx.lineTo(lx, ly);
        ctx.stroke();
      }
    }

    /* Restore clipping if in hiding phase */
    if (prey.phase === "hiding" && obstacle.visible) {
      ctx.restore();
    }
  }

  function drawBursts() {
    for (var i = 0; i < bursts.length; i++) {
      var b = bursts[i];
      ctx.globalAlpha = b.life;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * b.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ===== Main Loop ===== */
  function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    var dt = Math.min((timestamp - lastTime) / 1000, MAX_FRAME_TIME);
    lastTime = timestamp;

    updatePrey(dt, timestamp);
    updateTrail();
    updateBursts(dt);

    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawObstacle();
    drawTrail();
    drawPrey();
    drawBursts();

    animationId = requestAnimationFrame(gameLoop);
  }

  /* ===== Tap / Touch Handling ===== */
  function handleTap(px, py) {
    if (!gameRunning) return;
    userHasInteracted = true;

    var dx = px - prey.x;
    var dy = py - prey.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < prey.hitRadius) {
      /* Catch! */
      score++;
      scoreDisplay.textContent = score;
      scoreDisplay.classList.add("bump");
      setTimeout(function () { scoreDisplay.classList.remove("bump"); }, 150);

      spawnBurst(prey.x, prey.y, prey.color);
      playPing();
      vibrate();

      /* Relocate prey */
      if (settings.mode === "bug") {
        prey.color = randomBugColor();
      }
      prey.x = 60 + Math.random() * (W - 120);
      prey.y = 60 + Math.random() * (H - 120);
      prey.vx = 0;
      prey.vy = 0;
      pickNewTarget();
      prey.phase = "moving";
      prey.phaseTimer = 1 + Math.random() * 2;

      /* Move obstacle occasionally */
      if (Math.random() < 0.3) {
        placeObstacle();
      }
    }
  }

  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    handleTap(e.clientX, e.clientY);
  });

  /* ===== 3-Finger Lock Toggle ===== */
  var threeFingerStart = 0;
  var threeFingerCheck = null;

  document.addEventListener("touchstart", function (e) {
    if (e.touches.length >= 3) {
      threeFingerStart = Date.now();
      threeFingerCheck = setTimeout(function () {
        uiLocked = !uiLocked;
        if (uiLocked) {
          settingsBtn.classList.add("hidden");
          if (settingsOpen) {
            settingsModal.classList.add("hidden");
            settingsOpen = false;
          }
        } else {
          settingsBtn.classList.remove("hidden");
        }
      }, 2000);
    }
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (e.touches.length < 3 && threeFingerCheck) {
      clearTimeout(threeFingerCheck);
      threeFingerCheck = null;
    }
  }, { passive: true });

  /* ===== Settings UI ===== */
  settingsBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    settingsModal.classList.remove("hidden");
    settingsOpen = true;
  });

  closeSettingsBtn.addEventListener("click", function () {
    applySettings();
    settingsModal.classList.add("hidden");
    settingsOpen = false;
  });

  /* Prevent taps inside modal from reaching game; close on backdrop click */
  settingsModal.addEventListener("pointerdown", function (e) {
    if (e.target === settingsModal) {
      applySettings();
      settingsModal.classList.add("hidden");
      settingsOpen = false;
    }
    e.stopPropagation();
  });
  settingsModal.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });

  function applySettings() {
    settings.mode = settingMode.value;
    settings.difficulty = settingDifficulty.value;
    settings.trail = settingTrail.value;
    settings.background = settingBackground.value;
    settings.targetSize = settingSize.value;
    settings.sound = settingSound.checked;
    settings.vibration = settingVibration.checked;
    settings.timer = settingTimer.checked;

    applyTheme();

    prey.radius = settings.targetSize === "xlarge" ? 26 : 18;
    prey.hitRadius = settings.targetSize === "xlarge" ? 80 : 60;

    if (settings.mode === "laser") {
      prey.color = "#ff0033";
    } else {
      prey.color = randomBugColor();
    }
    modeIndicator.textContent = settings.mode === "laser" ? "🔴 Laser" : "🐛 Bug";

    /* Timer management */
    if (settings.timer && !timerActive) {
      startTimer();
    } else if (!settings.timer && timerActive) {
      stopTimer();
    }

    saveSettings();
  }

  /* ===== Settings Persistence ===== */
  function saveSettings() {
    try {
      localStorage.setItem("cattap_settings", JSON.stringify(settings));
    } catch (e) { /* ignore storage errors */ }
  }

  function loadSettings() {
    try {
      var data = localStorage.getItem("cattap_settings");
      if (data) {
        var parsed = JSON.parse(data);
        for (var key in parsed) {
          if (Object.prototype.hasOwnProperty.call(settings, key)) {
            settings[key] = parsed[key];
          }
        }
      }
    } catch (e) { /* ignore storage errors */ }

    /* Sync UI controls with loaded settings */
    settingMode.value = settings.mode;
    settingDifficulty.value = settings.difficulty;
    settingTrail.value = settings.trail;
    settingBackground.value = settings.background;
    settingSize.value = settings.targetSize;
    settingSound.checked = settings.sound;
    settingVibration.checked = settings.vibration;
    settingTimer.checked = settings.timer;
  }

  /* ===== Timer ===== */
  function startTimer() {
    timerActive = true;
    timeLeft = 60;
    timerDisplay.textContent = timeLeft;
    timerDisplay.classList.remove("hidden", "warning");
    gameRunning = true;
    gameOverOverlay.classList.add("hidden");

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      timeLeft--;
      timerDisplay.textContent = timeLeft;
      if (timeLeft <= 10) {
        timerDisplay.classList.add("warning");
      }
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        timerActive = false;
        gameRunning = false;
        finalScoreEl.textContent = score;
        gameOverOverlay.classList.remove("hidden");
      }
    }, 1000);
  }

  function stopTimer() {
    timerActive = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerDisplay.classList.add("hidden");
    timerDisplay.classList.remove("warning");
    gameRunning = true;
    gameOverOverlay.classList.add("hidden");
  }

  playAgainBtn.addEventListener("click", function () {
    score = 0;
    scoreDisplay.textContent = "0";
    gameOverOverlay.classList.add("hidden");
    gameRunning = true;
    if (settings.timer) {
      startTimer();
    }
    initPrey();
  });

  /* ===== Initialization ===== */
  function init() {
    loadSettings();
    applyTheme();
    placeObstacle();
    initPrey();
    score = 0;
    scoreDisplay.textContent = "0";

    /* UI lock default: settings hidden */
    settingsBtn.classList.add("hidden");

    /* Start timer if setting was persisted */
    if (settings.timer) {
      startTimer();
    }

    lastTime = 0;
    animationId = requestAnimationFrame(gameLoop);
  }

  init();
})();
