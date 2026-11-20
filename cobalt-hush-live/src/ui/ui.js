import { PATTERNS, PATTERN_NAME, PATTERN_UNLOCK, SHADES } from '../core/state.js';
import { tier } from '../sim/trust.js';
import { lerp, clamp } from '../core/math.js';

const MATERIALS = ['solid', 'translucent', 'ghost'];
const MATERIAL_LABEL = { solid: 'Solid', translucent: 'Translucent', ghost: 'Ghost' };
const PACES = ['calm', 'normal', 'lively'];
const PACE_LABEL = { calm: 'Calm', normal: 'Normal', lively: 'Lively' };
const RING_R = 11;
const RING_C = 2 * Math.PI * RING_R;

const svg = (body) =>
  `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICONS = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  feed: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3.2"/>'),
  solid: svg('<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".85"/>'),
  translucent: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" fill-opacity=".5" stroke="none"/>'),
  ghost: svg('<circle cx="12" cy="12" r="8" stroke-dasharray="2.2 2.6"/>'),
  // Pace: one, two or three chevrons.
  calm: svg('<path d="M10 7l5 5-5 5"/>'),
  normal: svg('<path d="M7 7l5 5-5 5M12 7l5 5-5 5"/>'),
  lively: svg('<path d="M4.5 7l5 5-5 5M9.5 7l5 5-5 5M14.5 7l5 5-5 5"/>'),
  arrange: svg('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
  soundOn: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 10l4 4M20 10l-4 4"/>'),
  moult: svg('<path d="M12 3.5 19 8v8l-7 4.5L5 16V8z"/><path d="M12 9.5 15 11.3v3.4l-3 1.8-3-1.8v-3.4z"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

const NAVY = [11, 18, 53];
const WHITE = [255, 255, 255];
const mixRgb = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k))).join(',');

function el(tag, attrs = {}, html = '') {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (html) n.innerHTML = html;
  return n;
}

// A calm, centred message in place of the terrarium (e.g. no WebGL).
export function showNotice(root, text) {
  const note = el('p', { class: 'hush-notice', role: 'status' });
  note.textContent = text;
  root.append(note);
}

// onFeedKey: Enter or Space on the armed Feed button (a keyboard click) drops food instead of
// disarming; the UI disarms itself.
export function createUI(root, { state, onLights, onFeedArm, onFeedKey, onMaterial, onMove, onPace, onSound, onPattern } = {}) {
  const settings = { lights: 'on', material: 'translucent', move: 'lure', pace: 'normal', sound: 'off', ...(state?.settings ?? {}) };
  let feedArmed = false;
  let night = 0;
  let trust = state?.trust ?? 0;
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  // Trust ring (top-right).
  const ring = el('div', { class: 'hush-trust', role: 'img' });
  ring.innerHTML = `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle class="track" cx="14" cy="14" r="${RING_R}"/><circle class="arc" cx="14" cy="14" r="${RING_R}" stroke-dasharray="${RING_C}" transform="rotate(-90 14 14)"/></svg>`;
  const arc = ring.querySelector('.arc');

  // Toolbar.
  const bar = el('div', { class: 'hush-bar', role: 'toolbar', 'aria-label': 'Terrarium controls' });
  const btn = (cls, label, icon, text) =>
    el('button', { type: 'button', class: `hush-btn ${cls}`, 'aria-label': label }, `${icon}<span class="lbl">${text}</span>`);
  const lightsBtn = btn('lights', 'Lights', '<span class="ico-slot"></span>', 'Lights');
  const feedBtn = btn('feed', 'Feed', ICONS.feed, 'Feed');
  const matBtn = btn('material', '', '', '');
  const paceBtn = btn('pace', '', '', '');
  const soundBtn = btn('sound', 'Sound', '<span class="ico-slot"></span>', 'Sound');
  const seg = el('div', { class: 'hush-seg', role: 'group', 'aria-label': 'Move mode' });
  const lureBtn = el('button', { type: 'button', class: 'hush-btn seg-btn', 'data-move': 'lure' }, '<span class="lbl">Lure</span>');
  const steerBtn = el('button', { type: 'button', class: 'hush-btn seg-btn', 'data-move': 'steer' }, '<span class="lbl">Steer</span>');
  const arrangeBtn = el('button', { type: 'button', class: 'hush-btn seg-btn arrange', 'data-move': 'arrange', 'aria-label': 'Arrange: drag the hiding spots' }, `${ICONS.arrange}<span class="lbl">Arrange</span>`);
  seg.append(lureBtn, steerBtn, arrangeBtn);
  const moultBtn = el(
    'button',
    { type: 'button', class: 'hush-btn moults', 'aria-label': 'Moults', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
    `${ICONS.moult}<span class="lbl">Moults</span><span class="badge">0</span>`,
  );
  const badge = moultBtn.querySelector('.badge');
  bar.append(lightsBtn, feedBtn, matBtn, paceBtn, seg, soundBtn, moultBtn);

  // Moults panel.
  const panel = el('div', { class: 'hush-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'hush-moults-title', hidden: '' });
  const head = el('div', { class: 'hush-panel-head' }, '<h2 id="hush-moults-title">Moults</h2>');
  const closeBtn = el('button', { type: 'button', class: 'hush-btn hush-close', 'aria-label': 'Close moults' }, ICONS.close);
  head.append(closeBtn);
  const list = el('ul', { class: 'hush-list' });
  const empty = el('p', { class: 'hush-empty' }, 'No shells yet. Keep the deck calm and it will grow.');
  // Patterns: the ones unlocked can be worn; locked ones say how to find them.
  const patternHead = el('h3', { class: 'hush-sub' }, 'Patterns');
  const patternRow = el('div', { class: 'hush-patterns', role: 'group', 'aria-label': 'Abdomen pattern' });
  const patternBtns = PATTERNS.map((p) => {
    const b = el('button', { type: 'button', class: `hush-chip pat-${p}`, 'data-pattern': p });
    b.addEventListener('click', () => {
      if (b.disabled) return;
      onPattern?.(p);
      paintPatterns(unlocked, p);
    });
    patternRow.append(b);
    return b;
  });
  let unlocked = ['faint'];
  panel.append(head, patternHead, patternRow, list, empty);

  // A small, quiet notice (a new pattern, a moult).
  const toastEl = el('div', { class: 'hush-toast', role: 'status', 'aria-live': 'polite' });
  let toastTimer = null;

  // Intro title.
  const intro = el('div', { class: 'hush-intro', 'aria-hidden': 'true' }, '<span>COBALT HUSH</span>');

  root.append(ring, bar, panel, intro, toastEl);

  function paintPatterns(have, current) {
    unlocked = have;
    for (const b of patternBtns) {
      const p = b.dataset.pattern;
      const own = have.includes(p);
      const at = PATTERN_UNLOCK[p];
      b.disabled = !own;
      b.textContent = own ? PATTERN_NAME[p] : '?';
      b.setAttribute('aria-pressed', String(own && p === current));
      b.title = own ? `Wear ${PATTERN_NAME[p]}` : at === 'rare' ? 'A rare find: keep moulting' : `Unlocks at moult ${at}`;
      b.setAttribute('aria-label', b.title);
    }
  }

  function paintSettings() {
    lightsBtn.setAttribute('aria-pressed', String(settings.lights === 'on'));
    lightsBtn.querySelector('.ico-slot').innerHTML = settings.lights === 'on' ? ICONS.sun : ICONS.moon;
    const m = MATERIALS.includes(settings.material) ? settings.material : 'translucent';
    matBtn.innerHTML = `${ICONS[m]}<span class="lbl">${MATERIAL_LABEL[m]}</span>`;
    matBtn.setAttribute('aria-label', `Material: ${MATERIAL_LABEL[m]}. Change material`);
    const p = PACES.includes(settings.pace) ? settings.pace : 'normal';
    paceBtn.innerHTML = `${ICONS[p]}<span class="lbl">${PACE_LABEL[p]}</span>`;
    paceBtn.setAttribute('aria-label', `Walking pace: ${PACE_LABEL[p]}. Change pace`);
    soundBtn.setAttribute('aria-pressed', String(settings.sound === 'on'));
    soundBtn.querySelector('.ico-slot').innerHTML = settings.sound === 'on' ? ICONS.soundOn : ICONS.soundOff;
    // Hover tooltips, for when the toolbar is icon-only.
    for (const b of bar.querySelectorAll('button')) b.title = b.getAttribute('aria-label') || b.textContent.trim();
    for (const b of [lureBtn, steerBtn, arrangeBtn]) b.setAttribute('aria-pressed', String(b.dataset.move === settings.move));
  }
  function paintFeed() {
    feedBtn.setAttribute('aria-pressed', String(feedArmed));
  }

  function setTrust(t) {
    trust = Number.isFinite(t) ? clamp(t, 0, 100) : 0;
    arc.style.strokeDashoffset = String(RING_C * (1 - Math.max(0.04, trust / 100)));
    ring.setAttribute('aria-label', `Trust: ${tier(trust)}`);
  }

  function setNight(v) {
    night = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    const s = root.style;
    s.setProperty('--glass', `rgba(${mixRgb(WHITE, NAVY, night)},${lerp(0.55, 0.45, night).toFixed(3)})`);
    s.setProperty('--ink', `rgb(${mixRgb([17, 26, 74], [233, 255, 255], night)})`);
    s.setProperty('--edge', `rgba(${mixRgb(WHITE, [143, 176, 255], night)},${lerp(0.7, 0.22, night).toFixed(3)})`);
    s.setProperty('--shadow', `rgba(11,18,53,${lerp(0.14, 0.5, night).toFixed(3)})`);
    s.setProperty('--ring', `rgb(${mixRgb([35, 65, 184], [61, 245, 255], night)})`);
    s.setProperty('--accent', `rgb(${mixRgb([35, 65, 184], [61, 245, 255], night)})`);
    s.setProperty('--on-accent', night > 0.5 ? '#0B1235' : '#fff');
    s.setProperty('--accent-soft', `rgba(${mixRgb([35, 65, 184], [61, 245, 255], night)},${lerp(0.14, 0.18, night).toFixed(3)})`);
  }

  function setMoults(moults) {
    const items = Array.isArray(moults) ? moults : [];
    badge.textContent = String(items.length);
    moultBtn.setAttribute('aria-label', `Moults, ${items.length} collected`);
    list.replaceChildren(
      ...items.map((m) => {
        const shade = SHADES[m.shadeIndex] ?? SHADES[0];
        const li = el('li', { class: 'hush-item' });
        const sw = el('span', { class: 'swatch', 'aria-hidden': 'true' });
        sw.style.background = `linear-gradient(145deg, ${shade.highlight}, ${shade.body} 55%, ${shade.deep})`;
        li.append(sw, el('span', { class: 'name' }, shade.name));
        li.append(el('span', { class: 'size' }, `${Math.round((m.size ?? 1) * 100)}%`)); // how big it was
        const d = new Date(m.at);
        if (Number.isFinite(d.getTime())) li.append(el('time', { datetime: d.toISOString() }, dateFmt.format(d)));
        return li;
      }),
    );
    empty.hidden = items.length > 0;
  }

  function openPanel() {
    panel.hidden = false;
    moultBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => panel.classList.add('open'));
    closeBtn.focus();
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.classList.remove('open');
    panel.hidden = true;
    moultBtn.setAttribute('aria-expanded', 'false');
    moultBtn.focus();
  }

  lightsBtn.addEventListener('click', () => {
    settings.lights = settings.lights === 'on' ? 'off' : 'on';
    paintSettings();
    onLights?.(settings.lights);
  });
  feedBtn.addEventListener('click', (e) => {
    if (feedArmed && e.detail === 0 && onFeedKey) {
      // detail 0: activated from the keyboard, which can't tap the deck.
      feedArmed = false;
      paintFeed();
      onFeedKey();
      return;
    }
    feedArmed = !feedArmed;
    paintFeed();
    onFeedArm?.(feedArmed);
  });
  matBtn.addEventListener('click', () => {
    settings.material = MATERIALS[(MATERIALS.indexOf(settings.material) + 1) % MATERIALS.length];
    paintSettings();
    onMaterial?.(settings.material);
  });
  soundBtn.addEventListener('click', () => {
    settings.sound = settings.sound === 'on' ? 'off' : 'on';
    paintSettings();
    onSound?.(settings.sound);
  });
  paceBtn.addEventListener('click', () => {
    settings.pace = PACES[(PACES.indexOf(settings.pace) + 1) % PACES.length];
    paintSettings();
    onPace?.(settings.pace);
  });
  for (const b of [lureBtn, steerBtn, arrangeBtn]) {
    b.addEventListener('click', () => {
      if (settings.move === b.dataset.move) return;
      settings.move = b.dataset.move;
      paintSettings();
      onMove?.(settings.move);
    });
  }
  moultBtn.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  closeBtn.addEventListener('click', closePanel);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  setNight(0);
  setTrust(trust);
  paintSettings();
  paintFeed();
  setMoults(state?.moults ?? []);

  return {
    setTrust,
    setNight,
    setMoults,
    setFeedArmed(b) {
      feedArmed = !!b;
      paintFeed();
    },
    setPatterns(have, current) {
      paintPatterns(Array.isArray(have) ? have : ['faint'], current);
    },
    toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
    },
    setSettings(s) {
      Object.assign(settings, s);
      paintSettings();
    },
    showIntro() {
      intro.classList.remove('play');
      void intro.offsetWidth;
      intro.classList.add('play');
      intro.addEventListener('animationend', () => intro.classList.remove('play'), { once: true });
    },
  };
}
