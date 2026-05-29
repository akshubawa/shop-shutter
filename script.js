/**
 * ═══════════════════════════════════════════════════════════
 *  AKSHAY'S STORE — MacBook Shutter Animation
 *  script.js  |  Pure JS, no frameworks
 *
 *  Architecture:
 *    ShutterBuilder  — DOM construction (strips)
 *    ShutterPhysics  — animation timeline engine
 *    LightEngine     — brightness / shadow / bloom
 *    AudioEngine     — sound stub (plug in shutter.mp3)
 *    InputController — keyboard + visibility events
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ──────────────────────────────────────────────────────────
   CONFIGURATION  (tweak freely)
────────────────────────────────────────────────────────── */
const CONFIG = {
  STRIP_HEIGHT_PX:   28,     // px — keep in sync with CSS --strip-h
  TOTAL_STRIPS:      null,   // auto-calculated from viewport height
  ANIMATION_DELAY:   500,    // ms before motor starts
  MOTOR_SHAKE_MS:    600,    // duration of initial shake phase
  OPEN_DURATION_MS:  3200,   // total shutter travel time
  BOUNCE_DURATION_MS:380,    // final overshoot bounce
  BOUNCE_OVERSHOOT:  14,     // px of overshoot past full-open
  IDLE_VIBRATE_MS:   2200,   // vibration loop interval when closed
  HINT_SHOW_DELAY:   4500,   // ms after open to show keyboard hints
};

/* ──────────────────────────────────────────────────────────
   AUDIO ENGINE  (placeholder — swap in your shutter.mp3)
────────────────────────────────────────────────────────── */
const AudioEngine = (() => {
  // Replace '' with './shutter.mp3' once you have the file
  const shutterSound = new Audio('');
  shutterSound.loop    = false;
  shutterSound.volume  = 0.65;
  shutterSound.preload = 'auto';

  // Separate click/clunk for motor start
  const motorSound = new Audio('');
  motorSound.volume = 0.5;

  return {
    playShutter() {
      if (!shutterSound.src) return;
      shutterSound.currentTime = 0;
      shutterSound.play().catch(() => { /* autoplay policy — ignore */ });
    },
    playMotorStart() {
      if (!motorSound.src) return;
      motorSound.currentTime = 0;
      motorSound.play().catch(() => {});
    },
    stop() {
      shutterSound.pause();
      shutterSound.currentTime = 0;
    },
  };
})();

/* ──────────────────────────────────────────────────────────
   EASING LIBRARY  (no deps)
────────────────────────────────────────────────────────── */
const Ease = {
  /** Accelerates then slightly decelerates — shutter momentum */
  shutterCurve(t) {
    // Smooth cubic ease-in-out for realistic, continuous acceleration and deceleration
    return this.cubicInOut(t);
  },
  /** Smooth cubic in-out */
  cubicInOut(t) { return t < 0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; },
  /** Exponential ease-out */
  expOut(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
  /** Spring bounce for final settle */
  springBounce(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/* ──────────────────────────────────────────────────────────
   SHUTTER BUILDER  — constructs strip DOM elements
────────────────────────────────────────────────────────── */
const ShutterBuilder = (() => {
  let strips = [];

  function build() {
    const wrap = document.getElementById('shutter-strips-wrap');
    // Clear previous
    wrap.innerHTML = '';
    strips = [];

    // How many strips cover the 160vh shutter height?
    const totalH = Math.ceil(window.innerHeight * 1.6);
    const count  = Math.ceil(totalH / CONFIG.STRIP_HEIGHT_PX) + 4;
    CONFIG.TOTAL_STRIPS = count;
    wrap.style.height = `${count * CONFIG.STRIP_HEIGHT_PX}px`;

    for (let i = 0; i < count; i++) {
      const strip = document.createElement('div');
      strip.className = 'shutter-strip';

      // Tone variants for realism
      if (i % 5 === 0)       strip.classList.add('worn');
      else if (i % 2 === 0)  strip.classList.add('even');

      // Random micro-scratches via inline style variation
      const lightnessShift = (Math.random() * 6 - 3).toFixed(1);
      const baseBright = (1 + lightnessShift / 100).toFixed(3);
      strip.style.filter = `brightness(${baseBright})`;

      // Cache base brightness to prevent shimmer overwrite bugs
      strip.dataset.baseBrightness = baseBright;

      // Perspective transform seed — used during fold animation
      strip.dataset.index = i;

      wrap.appendChild(strip);
      strips.push(strip);
    }
  }

  return { build, getStrips: () => strips };
})();

/* ──────────────────────────────────────────────────────────
   LIGHT ENGINE — manages darkness overlay + edge shadow
────────────────────────────────────────────────────────── */
const LightEngine = (() => {
  const darkness  = document.getElementById('darkness-overlay');
  const spotlight = document.getElementById('spotlight');
  const shadow    = document.getElementById('shutter-edge-shadow');
  const rays      = document.getElementById('light-rays');
  const desktop   = document.getElementById('desktop');

  /** progress 0→1 as shutter opens */
  function update(progress) {
    // Darkness fades away
    darkness.style.opacity = Math.max(0, 1 - progress * 1.3);

    // Spotlight shrinks and dims
    spotlight.style.opacity = Math.max(0, 1 - progress * 2);

    // Desktop bloom starts at 20% progress
    const desktopProgress = Math.max(0, (progress - 0.20) / 0.80);
    desktop.style.filter =
      `brightness(${desktopProgress}) ` +
      `blur(${(1 - desktopProgress) * 4}px) ` +
      `saturate(${desktopProgress})`;

    // Light rays appear from 40% onwards
    if (progress > 0.40) {
      rays.style.opacity = ((progress - 0.40) / 0.60).toFixed(3);
    }
  }

  function positionEdgeShadow(shutterBottomY) {
    shadow.style.top = `${shutterBottomY}px`;
    const shouldShow = shutterBottomY > -10 && shutterBottomY < window.innerHeight;
    shadow.classList.toggle('visible', shouldShow);
  }

  function reset() {
    darkness.style.opacity    = '1';
    darkness.classList.remove('lifted');
    spotlight.style.opacity   = '1';
    spotlight.classList.remove('off');
    rays.style.opacity        = '0';
    rays.classList.remove('visible');
    shadow.classList.remove('visible');
    desktop.style.filter      = 'brightness(0) blur(6px) saturate(0)';
    desktop.classList.remove('revealed');
  }

  function finalReveal() {
    desktop.classList.add('revealed');
    rays.classList.add('visible');
    darkness.classList.add('lifted');
  }

  return { update, positionEdgeShadow, reset, finalReveal };
})();

/* ──────────────────────────────────────────────────────────
   SHUTTER PHYSICS  — core animation timeline
────────────────────────────────────────────────────────── */
const ShutterPhysics = (() => {
  const shutterEl = document.getElementById('shutter');
  const hintBar   = document.getElementById('hint-bar');
  const brand     = document.getElementById('shutter-brand');

  let rafId       = null;
  let phase       = 'closed';  // closed | shaking | opening | bouncing | open
  let phaseStart  = 0;
  let shutterY    = 0;         // current translateY (negative = moved up)
  let hintTimer   = null;

  // Full travel distance: the entire height of the shutter strips (160vh + extra)
  const fullTravel = () => (CONFIG.TOTAL_STRIPS * CONFIG.STRIP_HEIGHT_PX) + 20;

  /* ── Strip fold effect ─────────────────────────────── */
  function updateStripFolds(progress) {
    const strips  = ShutterBuilder.getStrips();
    // The "exposed" top strips fold as the shutter scrolls up
    const foldZone = 5; // how many top strips are mid-fold at once

    strips.forEach((strip, i) => {
      // Which screen-position is this strip at?
      const screenY = i * CONFIG.STRIP_HEIGHT_PX + shutterY;
      const baseBright = parseFloat(strip.dataset.baseBrightness) || 1.0;

      if (screenY < -CONFIG.STRIP_HEIGHT_PX) {
        // Fully past the top — fully folded away
        strip.style.transform    = 'scaleY(0) rotateX(-90deg)';
        strip.style.opacity      = '0';
        strip.style.transformOrigin = 'top center';
        return;
      }

      if (screenY > window.innerHeight) {
        // Below viewport — just visible on shutter
        strip.style.transform = '';
        strip.style.opacity   = '1';
        strip.style.filter    = `brightness(${baseBright.toFixed(3)})`;
        return;
      }

      let transformStr = '';
      let opacityStr = '1';
      let foldBrightnessMultiplier = 1.0;

      const distFromTop = screenY;
      if (distFromTop < foldZone * CONFIG.STRIP_HEIGHT_PX && distFromTop >= 0) {
        // Fold transition zone — top-most visible strips curl
        const foldT = 1 - (distFromTop / (foldZone * CONFIG.STRIP_HEIGHT_PX));
        const scaleY = 1 - foldT * 0.6;
        const rotX   = foldT * -45;
        transformStr = `scaleY(${scaleY.toFixed(3)}) rotateX(${rotX.toFixed(1)}deg)`;
        strip.style.transformOrigin = 'top center';
        opacityStr = (1 - foldT * 0.4).toFixed(3);
        // Darken as it folds
        foldBrightnessMultiplier = 1 - foldT * 0.3;
      } else {
        transformStr = '';
        opacityStr = '1';
      }

      strip.style.transform = transformStr;
      strip.style.opacity   = opacityStr;

      // Subtle brightness wave as shutter moves (light reflection)
      const reflectPos = (screenY / window.innerHeight);
      const shimmer    = 1 + Math.sin(reflectPos * Math.PI * 3 + progress * 6) * 0.04;
      const finalBrightness = baseBright * foldBrightnessMultiplier * shimmer;
      strip.style.filter = `brightness(${finalBrightness.toFixed(3)})`;
    });
  }

  /* ── Micro-vibration simulation ────────────────────── */
  function vibrationOffset(progress) {
    // Subtle mechanical vibration (1.2px max) simulating motor/track hum
    return Math.sin(progress * 120) * 1.2;
  }

  /* ── Branding panel tracks with shutter until half-open ─ */
  function updateBrandPanel(progress) {
    if (progress < 0.45) {
      brand.style.opacity   = '1';
      brand.style.transform = 'translate(-50%, -50%)';
    } else {
      const fadeOut = (progress - 0.45) / 0.15;
      brand.style.opacity   = Math.max(0, 1 - fadeOut).toFixed(3);
    }
  }

  /* ── Main animation loop ───────────────────────────── */
  function tick(now) {
    const elapsed = now - phaseStart;

    if (phase === 'shaking') {
      /* ─── Phase: Motor start shake ─────────────── */
      const t = Math.min(elapsed / CONFIG.MOTOR_SHAKE_MS, 1);
      // Random judder via sin superposition
      const shakeX = Math.sin(t * 40) * (1 - t) * 4;
      const shakeY = Math.cos(t * 35) * (1 - t) * 5;
      shutterEl.style.transform =
        `translateY(0px) translateX(${shakeX.toFixed(2)}px) translateY(${shakeY.toFixed(2)}px)`;

      if (t >= 1) {
        phase      = 'opening';
        phaseStart = now;
      }

    } else if (phase === 'opening') {
      /* ─── Phase: Shutter rising ─────────────── */
      const t   = Math.min(elapsed / CONFIG.OPEN_DURATION_MS, 1);
      const easedT = Ease.shutterCurve(t);
      const travel = fullTravel();
      const vibration = vibrationOffset(t);

      shutterY = -(easedT * travel) + vibration;

      shutterEl.style.transform = `translateY(${shutterY.toFixed(2)}px)`;

      // Update edge shadow position
      const shutterBottom = window.innerHeight + shutterY; // absolute Y of shutter's bottom
      LightEngine.positionEdgeShadow(shutterBottom);

      // Update lighting
      LightEngine.update(easedT);

      // Update strip folds
      updateStripFolds(easedT);

      // Update branding
      updateBrandPanel(easedT);

      if (t >= 1) {
        shutterY   = -travel;
        phase      = 'bouncing';
        phaseStart = now;
      }

    } else if (phase === 'bouncing') {
      /* ─── Phase: Bounce settle ─────────────── */
      const t = Math.min(elapsed / CONFIG.BOUNCE_DURATION_MS, 1);
      const travel = fullTravel();
      // Continuous decaying sine wave starting at 0 offset, peaking at BOUNCE_OVERSHOOT, and settling at 0.
      const bounceOffset = CONFIG.BOUNCE_OVERSHOOT * Math.sin(t * Math.PI * 2) * Math.exp(-3 * t);
      shutterY = -travel - bounceOffset;
      shutterEl.style.transform = `translateY(${shutterY.toFixed(2)}px)`;

      if (t >= 1) {
        shutterY = -travel;
        shutterEl.style.transform = `translateY(${shutterY.toFixed(2)}px)`;
        phase = 'open';
        LightEngine.finalReveal();
        LightEngine.positionEdgeShadow(-999); // hide shadow
        showHints();
        cancelAnimationFrame(rafId);
        return; // stop loop
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  /* ── Idle vibration on closed shutter ─────────────── */
  let idleRafId  = null;
  let idleStart  = 0;
  function idleTick(now) {
    if (phase !== 'closed') return;
    const t  = ((now - idleStart) % CONFIG.IDLE_VIBRATE_MS) / CONFIG.IDLE_VIBRATE_MS;
    const amp = 0.6;
    const dx  = Math.sin(t * Math.PI * 2 * 7)  * amp;
    const dy  = Math.cos(t * Math.PI * 2 * 5)  * amp;
    shutterEl.style.transform = `translateX(${dx.toFixed(3)}px) translateY(${dy.toFixed(3)}px)`;
    idleRafId = requestAnimationFrame(idleTick);
  }

  /* ── Hints ─────────────────────────────────────────── */
  function showHints() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      document.getElementById('hint-bar').classList.add('visible');
    }, CONFIG.HINT_SHOW_DELAY - CONFIG.OPEN_DURATION_MS - CONFIG.MOTOR_SHAKE_MS);
  }

  /* ── Public API ────────────────────────────────────── */
  function start() {
    if (phase === 'opening' || phase === 'bouncing') return; // already running

    // Cancel any idle vibration
    cancelAnimationFrame(idleRafId);
    clearTimeout(hintTimer);
    document.getElementById('hint-bar').classList.remove('visible');

    // Kick off: small delay then shake then open
    setTimeout(() => {
      AudioEngine.playMotorStart();
      phase      = 'shaking';
      phaseStart = performance.now();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);

      // Shutter sound overlaps
      setTimeout(() => AudioEngine.playShutter(), 200);
    }, CONFIG.ANIMATION_DELAY);
  }

  function reset() {
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(idleRafId);
    clearTimeout(hintTimer);
    AudioEngine.stop();

    phase    = 'closed';
    shutterY = 0;
    shutterEl.style.transform = 'translateY(0px)';
    brand.style.opacity       = '1';
    brand.style.transform     = 'translate(-50%, -50%)';
    LightEngine.reset();
    document.getElementById('hint-bar').classList.remove('visible');

    // Resume idle vibration
    idleStart = performance.now();
    idleRafId = requestAnimationFrame(idleTick);
  }

  function replay() {
    reset();
    // Small settle delay so reset visuals are visible
    setTimeout(start, 200);
  }

  function getPhase() { return phase; }

  // Start idle vibration immediately
  idleStart = performance.now();
  requestAnimationFrame(idleTick);

  return { start, reset, replay, getPhase };
})();

/* ──────────────────────────────────────────────────────────
   CLOCK  — live time in menu bar
────────────────────────────────────────────────────────── */
function updateClock() {
  const el  = document.getElementById('clock');
  const now = new Date();
  const h   = now.getHours().toString().padStart(2, '0');
  const m   = now.getMinutes().toString().padStart(2, '0');
  el.textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 15_000);

/* ──────────────────────────────────────────────────────────
   INPUT CONTROLLER — keyboard + visibility + resize
────────────────────────────────────────────────────────── */
const InputController = (() => {

  /* ── Keyboard shortcuts ─────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        ShutterPhysics.replay();
        break;
      case 'KeyR':
        ShutterPhysics.reset();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
    }
  });

  /* ── Fullscreen ─────────────────────────────────────── */
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.()
        .catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }

  /* ── Wake / visibility triggers ────────────────────── */
  // Fires when MacBook wakes from sleep / browser tab becomes active
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      ShutterPhysics.replay();
    }
  });

  window.addEventListener('focus', () => {
    if (ShutterPhysics.getPhase() === 'open') {
      ShutterPhysics.replay();
    }
  });

  /* ── Resize: rebuild strips ─────────────────────────── */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasOpen = ShutterPhysics.getPhase() === 'open';
      ShutterBuilder.build();
      if (!wasOpen) ShutterPhysics.reset();
    }, 250);
  });

  /* ── Touch: tap to replay ─────────────────────────── */
  document.addEventListener('touchend', (e) => {
    if (e.touches.length === 0 && ShutterPhysics.getPhase() === 'open') {
      ShutterPhysics.replay();
    }
  });

})();

/* ──────────────────────────────────────────────────────────
   BOOT SEQUENCE
────────────────────────────────────────────────────────── */
(function init() {
  // 1. Build shutter strips
  ShutterBuilder.build();

  // 2. Short cinematic pause, then start
  setTimeout(() => {
    ShutterPhysics.start();
  }, 800);
})();