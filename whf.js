'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const SPACING      = 22;            // px, model token centre-to-centre
const MODEL_R      = 10;            // model circle radius px
const BOARD_W      = 1200;
const BOARD_H      = 900;
const NS           = 'http://www.w3.org/2000/svg';
const INCHES_TO_PX = 1200 / 72;    // 16.67px per inch
const WHEEL_DEG    = 10;            // degrees per arrow-key press during wheel

// Known RAW deviation: frontCorners() uses model slot centres as pivot points,
// not outer model edges. Arc distance is underestimated by ~MODEL_R (~0.6" on
// a 5-wide unit). Accepted simplification — noted in WHF_DEVLOG.md WHF-2 section.

function inchesToPx(inches) { return inches * INCHES_TO_PX; }

// ── Core geometry ──────────────────────────────────────────────────────────
//
// modelPosition converts a formation slot (row, col) to absolute SVG coords.
// unit.position = SVG coords of front-left slot (row=0, col=0)
// unit.facing   = degrees CW from north: 0=north, 90=east, 270=west
// row=0 = front rank; col=0 = left flank from unit's perspective

function modelPosition(unit, row, col) {
  const lx  = col * SPACING;
  const ly  = row * SPACING;
  const rad = (unit.facing * Math.PI) / 180;
  return {
    x: unit.position.x + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: unit.position.y + lx * Math.sin(rad) + ly * Math.cos(rad),
  };
}

// ── Geometry self-test ─────────────────────────────────────────────────────
(function testModelPosition() {
  const near = (a, b) => Math.abs(a - b) < 0.001;
  const u0   = { position: { x: 100, y: 100 }, facing: 0   };
  const u90  = { position: { x: 100, y: 100 }, facing: 90  };
  const u45  = { position: { x: 100, y: 100 }, facing: 45  };
  const s45  = Math.sin(Math.PI / 4);

  const cases = [
    [u0,  0, 0,  100,                 100,                '0° origin'],
    [u0,  0, 1,  100 + SPACING,       100,                '0° col→+X'],
    [u0,  1, 0,  100,                 100 + SPACING,      '0° row→+Y'],
    [u90, 0, 1,  100,                 100 + SPACING,      '90° col→+Y'],
    [u90, 1, 0,  100 - SPACING,       100,                '90° row→−X'],
    [u45, 0, 1,  100 + SPACING * s45, 100 + SPACING * s45, '45° col'],
    [u45, 1, 0,  100 - SPACING * s45, 100 + SPACING * s45, '45° row'],
  ];

  let ok = true;
  cases.forEach(([unit, row, col, ex, ey, label]) => {
    const p = modelPosition(unit, row, col);
    if (!near(p.x, ex) || !near(p.y, ey)) {
      console.error(`[WHF] modelPosition FAIL — ${label}:`,
        `got (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`,
        `expected (${ex.toFixed(3)}, ${ey.toFixed(3)})`);
      ok = false;
    }
  });
  if (ok) console.log('[WHF] modelPosition OK — 7 cases passed');
})();

// ── Movement geometry ──────────────────────────────────────────────────────

function facingVector(unit) {
  const rad = (unit.facing * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

// World-space positions of the two front-corner model slots.
function frontCorners(unit) {
  return {
    left:  modelPosition(unit, 0, 0),
    right: modelPosition(unit, 0, unit.rankWidth - 1),
  };
}

// Returns a new unit moved forward by `inches`. Does NOT handle backward
// tracking — caller is responsible for backwardInches.
function moveUnitForward(unit, inches) {
  const d = inchesToPx(inches);
  const v = facingVector(unit);
  return {
    ...unit,
    position: { x: unit.position.x + v.x * d, y: unit.position.y + v.y * d },
    movementUsed: unit.movementUsed + inches,
  };
}

// When pivoting around the right front corner, compute new unit.position
// (front-left corner) so that the right corner stays fixed.
function calculateNewPositionFromRightPivot(unit, rightPivot, newFacingDeg) {
  const width = (unit.rankWidth - 1) * SPACING;
  const rad   = (newFacingDeg * Math.PI) / 180;
  return {
    x: rightPivot.x - width * Math.cos(rad),
    y: rightPivot.y - width * Math.sin(rad),
  };
}

// Pivot the unit around one front corner by angleDeltaDeg.
// Returns a new unit object, or null if M allowance exceeded.
function wheelUnit(unit, pivotSide, angleDeltaDeg) {
  const corners    = frontCorners(unit);
  const pivot      = corners[pivotSide];
  const newFacing  = ((unit.facing + angleDeltaDeg) % 360 + 360) % 360;

  const outerCorner = corners[pivotSide === 'left' ? 'right' : 'left'];
  const dx = outerCorner.x - pivot.x;
  const dy = outerCorner.y - pivot.y;
  const radius    = Math.sqrt(dx * dx + dy * dy);
  const arcPx     = Math.abs(angleDeltaDeg * Math.PI / 180) * radius;
  const arcInches = arcPx / INCHES_TO_PX;

  if (unit.movementUsed + arcInches > parseFloat(unit.stats.M)) return null;

  const newPosition = pivotSide === 'left'
    ? pivot
    : calculateNewPositionFromRightPivot(unit, pivot, newFacing);

  return {
    ...unit,
    facing:       newFacing,
    position:     newPosition,
    movementUsed: unit.movementUsed + arcInches,
  };
}

// Rebuild model row/col assignments for current rankWidth.
function reassignModels(unit) {
  return {
    ...unit,
    models: unit.models.map((m, i) => ({
      ...m,
      row: Math.floor(i / unit.rankWidth),
      col: i % unit.rankWidth,
    })),
  };
}

// Redress formation in place: keep front-centre fixed, change rankWidth.
// Costs full movement.
function reformUnit(unit, newRankWidth) {
  const oldCentreOffset = (unit.rankWidth - 1) / 2 * SPACING;
  const newCentreOffset = (newRankWidth  - 1) / 2 * SPACING;
  const delta = oldCentreOffset - newCentreOffset;
  const rad   = (unit.facing * Math.PI) / 180;
  return reassignModels({
    ...unit,
    rankWidth:    newRankWidth,
    position: {
      x: unit.position.x + delta * Math.cos(rad),
      y: unit.position.y + delta * Math.sin(rad),
    },
    movementUsed: parseFloat(unit.stats.M),
    hasReformed:  true,
  });
}

// Returns true if any alive model in movingUnit is within 1" (edge-to-edge)
// of any alive enemy model. threshold = 1" in px + 2 model radii.
function violates1InchRule(movingUnit, allUnits) {
  const threshold = inchesToPx(1) + 2 * MODEL_R;
  const enemies = allUnits.filter(
    u => u.instanceId !== movingUnit.instanceId && u.factionId !== movingUnit.factionId
  );
  for (const enemy of enemies) {
    for (const mm of movingUnit.models.filter(m => m.alive)) {
      const mp = modelPosition(movingUnit, mm.row, mm.col);
      for (const em of enemy.models.filter(m => m.alive)) {
        const ep = modelPosition(enemy, em.row, em.col);
        const dx = mp.x - ep.x;
        const dy = mp.y - ep.y;
        if (Math.sqrt(dx * dx + dy * dy) < threshold) return true;
      }
    }
  }
  return false;
}

// ── Game state ─────────────────────────────────────────────────────────────
const state = {
  units:                 [],
  selected:              null,
  phase:                 'movement',
  activePlayer:          'player1',
  movementPhaseComplete: false,
};

// ── Movement interaction state ─────────────────────────────────────────────
let moveGhost      = null; // { unit, type:"move"|"wheel"|"reform" }
let moveMode       = null; // null|"move"|"wheel-pick"|"wheel"|"reform"
let wheelPivotSide = null;
let reformRankWidth = 0;

// ── Faction palettes ───────────────────────────────────────────────────────
const PALETTES = {
  empire: {
    fill:      'var(--empire-red)',
    champFill: '#a82020',
    stroke:    '#5a0e0e',
    arrow:     'var(--empire-gold)',
  },
  bretonnia: {
    fill:      'var(--bretonnia-blue)',
    champFill: '#2a4d8f',
    stroke:    '#0e2040',
    arrow:     'var(--bretonnia-gold)',
  },
};

// ── Test unit construction ─────────────────────────────────────────────────
function buildModels(instanceId, count, rankWidth) {
  return Array.from({ length: count }, (_, i) => ({
    modelId:          `${instanceId}-m${i}`,
    row:              Math.floor(i / rankWidth),
    col:              i % rankWidth,
    alive:            true,
    wounds:           1,
    maxWounds:        1,
    weapons:          [],
    isChampion:       i === 0,
    isMusician:       false,
    isStandardBearer: false,
  }));
}

function movementDefaults() {
  return { movementUsed: 0, backwardInches: 0, hasReformed: false, hasMoved: false, phaseDone: false };
}

function initTestUnits() {
  state.units.push({
    instanceId:   'unit-001',
    unitId:       'state-troops',
    factionId:    'the-empire',
    name:         'Halberdiers',
    factionLabel: 'The Empire',
    category:     'Core Infantry',
    position:     { x: 460, y: 376 },
    facing:       90,
    rankWidth:    5,
    palette:      'empire',
    stats: { M: '4"', WS: '3', BS: '3', S: '3', T: '3', W: '1', I: '3', A: '1', Ld: '7', Sv: '5+' },
    weapons: [
      { name: 'Halberd',     type: 'melee', desc: 'S+1' },
      { name: 'Hand weapon', type: 'melee', desc: '' },
    ],
    abilities: [],
    models: buildModels('unit-001', 20, 5),
    ...movementDefaults(),
  });

  // Sv 2+ is the army book default for KotR (full plate + shield).
  // The 1+ achievable with barding + magic item is handled by the roster system.
  state.units.push({
    instanceId:   'unit-002',
    unitId:       'knights-of-the-realm',
    factionId:    'bretonnia',
    name:         'Knights of the Realm',
    factionLabel: 'Bretonnia',
    category:     'Core Cavalry',
    position:     { x: 740, y: 442 },
    facing:       270,
    rankWidth:    3,
    palette:      'bretonnia',
    stats: { M: '7"', WS: '4', BS: '3', S: '4', T: '3', W: '1', I: '4', A: '1', Ld: '8', Sv: '2+' },
    weapons: [
      { name: 'Lance',       type: 'melee', desc: '+2S on charge, Lance Formation' },
      { name: 'Hand weapon', type: 'melee', desc: '' },
    ],
    abilities: ['Blessing of the Lady', 'Knightly Vow', 'Lance Formation'],
    models: buildModels('unit-002', 9, 3),
    ...movementDefaults(),
  });
}

// ── SVG helpers ────────────────────────────────────────────────────────────
function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Phase tracker ──────────────────────────────────────────────────────────
function renderPhaseTracker() {
  document.querySelectorAll('.phase-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.phase === state.phase);
  });
}

// ── Grid ──────────────────────────────────────────────────────────────────
function renderGrid() {
  const layer = document.getElementById('grid-layer');
  const step  = 88;
  for (let x = step; x < BOARD_W; x += step) {
    layer.appendChild(svgEl('line', {
      x1: x, y1: 0, x2: x, y2: BOARD_H,
      stroke: 'var(--grid-line)', 'stroke-width': '0.8',
    }));
  }
  for (let y = step; y < BOARD_H; y += step) {
    layer.appendChild(svgEl('line', {
      x1: 0, y1: y, x2: BOARD_W, y2: y,
      stroke: 'var(--grid-line)', 'stroke-width': '0.8',
    }));
  }
}

// ── Render ────────────────────────────────────────────────────────────────
function renderBoard() {
  // Real units
  const layer = document.getElementById('units-layer');
  while (layer.firstChild) layer.removeChild(layer.firstChild);
  state.units.forEach(u => renderUnit(layer, u, false));

  // Ghost preview
  const ghostLayer = document.getElementById('ghost-layer');
  while (ghostLayer.firstChild) ghostLayer.removeChild(ghostLayer.firstChild);
  if (moveGhost) renderUnit(ghostLayer, moveGhost.unit, true);

  // Pivot diamonds overlay (wheel-pick mode only)
  const overlayLayer = document.getElementById('overlay-layer');
  while (overlayLayer.firstChild) overlayLayer.removeChild(overlayLayer.firstChild);
  if (moveMode === 'wheel-pick') {
    const sel = getSelectedUnit();
    if (sel) renderPivotDiamonds(overlayLayer, sel);
  }
}

function renderUnit(layer, unit, isGhost) {
  const isSelected = !isGhost && state.selected === unit.instanceId;
  const pal        = PALETTES[unit.palette] || PALETTES.empire;
  const numRanks   = Math.ceil(unit.models.length / unit.rankWidth);
  const frontCX    = (unit.rankWidth - 1) / 2;

  const g = svgEl('g', { class: isGhost ? 'unit ghost-unit' : 'unit', 'data-unit-id': unit.instanceId });

  if (isGhost) {
    g.setAttribute('opacity', '0.4');
  } else if (unit.phaseDone) {
    g.setAttribute('opacity', '0.5');
  }

  const modelsToRender = isGhost
    ? unit.models.filter(m => m.alive)
    : unit.models;

  modelsToRender.forEach(model => {
    const pos    = modelPosition(unit, model.row, model.col);
    const isDead = !model.alive;
    const fill   = isDead           ? 'var(--dead-model)'
                 : model.isChampion ? pal.champFill
                 : pal.fill;
    const stroke = isDead     ? 'var(--border-dark)'
                 : isSelected ? 'var(--selected-ring)'
                 : pal.stroke;

    g.appendChild(svgEl('circle', {
      class:           isDead ? 'model dead' : 'model',
      'data-model-id': model.modelId,
      'data-unit-id':  unit.instanceId,
      cx:              pos.x.toFixed(2),
      cy:              pos.y.toFixed(2),
      r:               MODEL_R,
      fill,
      stroke,
      'stroke-width':  isSelected && !isDead ? '2.5' : '1.5',
      opacity:         isDead ? '0.28' : '1',
      style:           isGhost ? '' : 'cursor:pointer',
    }));

    if (model.isChampion && !isDead) {
      g.appendChild(svgEl('circle', {
        cx: pos.x.toFixed(2), cy: pos.y.toFixed(2), r: '3',
        fill: 'var(--text-bright)', 'pointer-events': 'none',
      }));
    }
  });

  // Facing arrow — shown for both real and ghost units
  const arrowPos = modelPosition(unit, -1.0, frontCX);
  const ax = arrowPos.x, ay = arrowPos.y;
  const ah = 10, aw = 7;
  g.appendChild(svgEl('polygon', {
    class:   'facing-arrow',
    points:  `${ax},${ay - ah} ${ax - aw},${ay + ah * 0.5} ${ax + aw},${ay + ah * 0.5}`,
    fill:    pal.arrow,
    stroke:  pal.stroke,
    'stroke-width': '1',
    transform: `rotate(${unit.facing}, ${ax}, ${ay})`,
    'pointer-events': 'none',
  }));

  // Unit label — real units only, shows movement used if any
  if (!isGhost) {
    const aliveCount = unit.models.filter(m => m.alive).length;
    const usedStr    = unit.movementUsed > 0 ? ` [${unit.movementUsed.toFixed(1)}"]` : '';
    const labelPos   = modelPosition(unit, numRanks + 0.3, frontCX);
    const label = svgEl('text', {
      class: 'unit-label',
      x: labelPos.x.toFixed(2), y: labelPos.y.toFixed(2),
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'pointer-events': 'none',
    });
    label.textContent = `${unit.name} (${aliveCount})${usedStr}`;
    g.appendChild(label);
  }

  if (!isGhost) {
    g.addEventListener('click', e => { e.stopPropagation(); selectUnit(unit.instanceId); });
  }

  layer.appendChild(g);
}

// Clickable gold diamonds at front corners for pivot selection.
function renderPivotDiamonds(layer, unit) {
  const corners = frontCorners(unit);
  ['left', 'right'].forEach(side => {
    const pos  = corners[side];
    const size = 9;
    const diamond = svgEl('polygon', {
      'data-pivot-side': side,
      points: [
        `${pos.x},${pos.y - size}`,
        `${pos.x + size},${pos.y}`,
        `${pos.x},${pos.y + size}`,
        `${pos.x - size},${pos.y}`,
      ].join(' '),
      fill:    'var(--empire-gold)',
      stroke:  'var(--bg-dark)',
      'stroke-width': '2',
      style: 'cursor:pointer',
    });
    diamond.addEventListener('click', e => { e.stopPropagation(); pickWheelPivot(side); });
    layer.appendChild(diamond);
  });
}

// ── Ghost ──────────────────────────────────────────────────────────────────
function showGhost(ghostUnit, type) {
  moveGhost = { unit: ghostUnit, type };
  renderBoard();
}

function clearGhost() {
  moveGhost = null;
  renderBoard();
}

function flashGhostViolation() {
  const gl = document.getElementById('ghost-layer');
  gl.classList.remove('ghost-violation');
  void gl.offsetWidth; // force reflow to restart animation
  gl.classList.add('ghost-violation');
  setTimeout(() => gl.classList.remove('ghost-violation'), 600);
}

// ── Hint bar ───────────────────────────────────────────────────────────────
const HINT_DEFAULT = 'Click unit to inspect · Right-click model to remove · Esc to deselect';

function flashHint(msg, duration = 2000) {
  const bar = document.getElementById('hint-bar');
  bar.textContent = msg;
  setTimeout(() => { bar.textContent = HINT_DEFAULT; }, duration);
}

// ── Selection ──────────────────────────────────────────────────────────────
function getSelectedUnit() {
  return state.units.find(u => u.instanceId === state.selected) || null;
}

function selectUnit(instanceId) {
  if (moveGhost || moveMode) return; // block switching units during active action
  if (state.selected === instanceId) { deselectAll(); return; }
  state.selected = instanceId;
  renderBoard();
  const unit = getSelectedUnit();
  if (unit) showPanel(unit);
}

function deselectAll() {
  if (moveGhost || moveMode) cancelGhost();
  state.selected = null;
  renderBoard();
  hidePanel();
}

// ── Dead model toggle ──────────────────────────────────────────────────────
function toggleModelDead(unitId, modelId) {
  const unit  = state.units.find(u => u.instanceId === unitId);
  if (!unit) return;
  const model = unit.models.find(m => m.modelId === modelId);
  if (!model) return;
  model.alive = !model.alive;
  renderBoard();
  if (state.selected === unitId) showPanel(unit);
}

// ── Movement actions ───────────────────────────────────────────────────────
function enterMoveMode() {
  const unit = getSelectedUnit();
  if (!unit || unit.hasReformed || unit.phaseDone) return;
  moveMode = 'move';
  showGhost({ ...unit }, 'move');
  showPanel(unit);
}

function enterWheelPickMode() {
  const unit = getSelectedUnit();
  if (!unit || unit.hasReformed || unit.phaseDone) return;
  moveMode = 'wheel-pick';
  wheelPivotSide = null;
  renderBoard();
  showPanel(unit);
}

function pickWheelPivot(side) {
  const unit = getSelectedUnit();
  if (!unit) return;
  wheelPivotSide = side;
  moveMode = 'wheel';
  showGhost({ ...unit }, 'wheel');
  showPanel(unit);
}

function enterReformMode() {
  const unit = getSelectedUnit();
  if (!unit || unit.hasMoved || unit.hasReformed || unit.phaseDone) return;
  reformRankWidth = unit.rankWidth;
  moveMode = 'reform';
  showGhost(reformUnit(unit, reformRankWidth), 'reform');
  showPanel(unit);
}

function adjustReformWidth(unit, delta) {
  const newWidth = Math.max(1, Math.min(unit.models.length, reformRankWidth + delta));
  if (newWidth === reformRankWidth) return;
  reformRankWidth = newWidth;
  showGhost(reformUnit(unit, reformRankWidth), 'reform');
  showPanel(unit);
}

function commitGhost() {
  if (!moveGhost) return;
  const ghost = moveGhost.unit;
  const type  = moveGhost.type;

  if (violates1InchRule(ghost, state.units)) {
    flashGhostViolation();
    flashHint('Too close to enemy (1" rule) — move rejected', 2500);
    return;
  }

  const idx = state.units.findIndex(u => u.instanceId === state.selected);
  if (idx === -1) return;

  // Reform ghost already carries hasReformed:true; move/wheel need hasMoved:true
  state.units[idx] = type !== 'reform'
    ? { ...ghost, hasMoved: true }
    : ghost;

  clearGhost();
  moveMode = null;
  wheelPivotSide = null;
  showPanel(state.units[idx]);
}

function cancelGhost() {
  clearGhost();
  moveMode = null;
  wheelPivotSide = null;
  const unit = getSelectedUnit();
  if (unit) showPanel(unit);
}

function doneUnit() {
  const unit = getSelectedUnit();
  if (!unit) return;
  cancelGhost();
  const idx = state.units.findIndex(u => u.instanceId === state.selected);
  if (idx !== -1) state.units[idx] = { ...state.units[idx], phaseDone: true };
  deselectAll();
  updateEndPhaseButton();
}

function endMovementPhase() {
  state.phase = 'magic';
  renderPhaseTracker();
  document.getElementById('end-phase-bar').classList.remove('visible');
  state.units.forEach(u => Object.assign(u, movementDefaults()));
  renderBoard();
  flashHint('Magic phase — not yet implemented');
}

function updateEndPhaseButton() {
  const bar = document.getElementById('end-phase-bar');
  if (state.units.every(u => u.phaseDone)) bar.classList.add('visible');
}

// ── Arrow-key handlers ─────────────────────────────────────────────────────
function handleMoveKey(direction) {
  if (!moveGhost) return;
  const unit = getSelectedUnit();
  if (!unit) return;
  const ghost     = moveGhost.unit;
  const M         = parseFloat(unit.stats.M);
  const remaining = M - ghost.movementUsed;
  if (remaining <= 0) { flashHint('No movement remaining'); return; }

  let newGhost;
  if (direction > 0) {
    const step = Math.min(1, remaining);
    newGhost = moveUnitForward(ghost, step);
  } else {
    const halfM   = M / 2;
    const maxBack = Math.min(0.5, remaining, halfM - ghost.backwardInches);
    if (maxBack <= 0) { flashHint(`Backward limit reached (max ${halfM.toFixed(1)}")`); return; }
    const d = inchesToPx(maxBack);
    const v = facingVector(ghost);
    newGhost = {
      ...ghost,
      position: { x: ghost.position.x - v.x * d, y: ghost.position.y - v.y * d },
      movementUsed:   ghost.movementUsed   + maxBack,
      backwardInches: ghost.backwardInches + maxBack,
    };
  }

  showGhost(newGhost, 'move');
  showPanel(unit);
}

function handleWheelKey(angleDeltaDeg) {
  if (!moveGhost) return;
  const newGhost = wheelUnit(moveGhost.unit, wheelPivotSide, angleDeltaDeg);
  if (!newGhost) { flashHint('Wheel limit — M allowance exhausted'); return; }
  showGhost(newGhost, 'wheel');
  showPanel(getSelectedUnit());
}

// ── Movement panel HTML ─────────────────────────────────────────────────────
function buildMovementSection(unit) {
  if (state.phase !== 'movement') return '';
  const M    = parseFloat(unit.stats.M);
  const used = moveGhost ? moveGhost.unit.movementUsed : unit.movementUsed;

  if (unit.phaseDone) {
    return `<div class="panel-section">
      <div class="panel-section-title">Movement</div>
      <div class="panel-row panel-done">Movement complete (${unit.movementUsed.toFixed(1)}" used)</div>
    </div>`;
  }

  if (moveMode === null) {
    const canMove   = !unit.hasReformed;
    const canReform = !unit.hasMoved && !unit.hasReformed;
    const remaining = (M - unit.movementUsed).toFixed(1);
    const movedNote   = unit.hasMoved   ? '<div class="panel-row dim">Moved this turn — reform unavailable</div>' : '';
    const reformedNote = unit.hasReformed ? '<div class="panel-row dim">Reformed — no remaining move</div>' : '';
    return `<div class="panel-section">
      <div class="panel-section-title">Movement</div>
      <div class="panel-row">Allowance: ${M}" &nbsp;|&nbsp; Used: ${unit.movementUsed.toFixed(1)}" &nbsp;|&nbsp; Left: ${remaining}"</div>
      ${movedNote}${reformedNote}
      <div class="move-btns">
        <button class="move-btn" id="btn-move" ${canMove ? '' : 'disabled'}>Move</button>
        <button class="move-btn" id="btn-wheel" ${canMove ? '' : 'disabled'}>Wheel</button>
        <button class="move-btn" id="btn-reform" ${canReform ? '' : 'disabled'}>Reform</button>
      </div>
      <button class="move-btn done-btn" id="btn-done">Done — End unit move</button>
    </div>`;
  }

  const remaining = (M - used).toFixed(1);

  if (moveMode === 'move') {
    const backUsed = moveGhost ? moveGhost.unit.backwardInches.toFixed(1) : '0.0';
    const halfM    = (M / 2).toFixed(1);
    return `<div class="panel-section">
      <div class="panel-section-title">Moving</div>
      <div class="panel-row">↑ forward 1" per press &nbsp; ↓ backward 0.5" per press</div>
      <div class="panel-row">Remaining: ${remaining}" &nbsp;|&nbsp; Backward: ${backUsed}" / ${halfM}" max</div>
      <div class="move-btns">
        <button class="move-btn" id="btn-commit">Confirm (Enter)</button>
        <button class="move-btn" id="btn-cancel">Cancel (Esc)</button>
      </div>
    </div>`;
  }

  if (moveMode === 'wheel-pick') {
    return `<div class="panel-section">
      <div class="panel-section-title">Wheel — Select Pivot</div>
      <div class="panel-row">Click a gold diamond on the board</div>
      <div class="move-btns">
        <button class="move-btn" id="btn-cancel">Cancel (Esc)</button>
      </div>
    </div>`;
  }

  if (moveMode === 'wheel') {
    return `<div class="panel-section">
      <div class="panel-section-title">Wheeling (${wheelPivotSide} pivot)</div>
      <div class="panel-row">← / → to rotate (${WHEEL_DEG}° per press)</div>
      <div class="panel-row">Remaining: ${remaining}"</div>
      <div class="move-btns">
        <button class="move-btn" id="btn-commit">Confirm (Enter)</button>
        <button class="move-btn" id="btn-cancel">Cancel (Esc)</button>
      </div>
    </div>`;
  }

  if (moveMode === 'reform') {
    const max = unit.models.length;
    return `<div class="panel-section">
      <div class="panel-section-title">Reform (costs full move)</div>
      <div class="rw-control">
        <span class="rw-label">Rank width:</span>
        <button class="move-btn rw-btn" id="rw-minus">−</button>
        <span class="rw-value">${reformRankWidth}</span>
        <button class="move-btn rw-btn" id="rw-plus">+</button>
        <span class="rw-label">&nbsp;(1–${max})</span>
      </div>
      <div class="move-btns">
        <button class="move-btn" id="btn-commit">Confirm (Enter)</button>
        <button class="move-btn" id="btn-cancel">Cancel (Esc)</button>
      </div>
    </div>`;
  }

  return '';
}

function attachMovementListeners(unit) {
  const q = id => document.getElementById(id);
  q('btn-move')?.addEventListener('click', enterMoveMode);
  q('btn-wheel')?.addEventListener('click', enterWheelPickMode);
  q('btn-reform')?.addEventListener('click', enterReformMode);
  q('btn-done')?.addEventListener('click', doneUnit);
  q('btn-commit')?.addEventListener('click', commitGhost);
  q('btn-cancel')?.addEventListener('click', cancelGhost);
  q('rw-minus')?.addEventListener('click', () => adjustReformWidth(unit, -1));
  q('rw-plus')?.addEventListener('click',  () => adjustReformWidth(unit,  1));
}

// ── Stat panel ─────────────────────────────────────────────────────────────
function showPanel(unit) {
  const panel   = document.getElementById('stat-panel');
  const content = document.getElementById('panel-content');
  const alive    = unit.models.filter(m => m.alive).length;
  const total    = unit.models.length;
  const numRanks = Math.ceil(total / unit.rankWidth);
  const s        = unit.stats;

  const weaponItems = unit.weapons.map(w =>
    `<li>${escHtml(w.name)}${w.desc
      ? ` <span class="panel-sub">(${escHtml(w.type)}, ${escHtml(w.desc)})</span>`
      : ` <span class="panel-sub">(${escHtml(w.type)})</span>`}</li>`
  ).join('');

  const abilityItems = unit.abilities.length
    ? unit.abilities.map(a => `<li>${escHtml(a)}</li>`).join('')
    : '<li class="panel-none">None</li>';

  content.innerHTML = `
    <div class="panel-header">
      <div class="panel-name">${escHtml(unit.name)}</div>
      <div class="panel-faction">${escHtml(unit.factionLabel)} — ${escHtml(unit.category)}</div>
    </div>
    <div class="panel-section">
      <table class="stat-table">
        <tr>
          <th>M</th><th>WS</th><th>BS</th><th>S</th><th>T</th><th>W</th><th>I</th>
        </tr>
        <tr>
          <td>${escHtml(s.M)}</td><td>${escHtml(s.WS)}</td><td>${escHtml(s.BS)}</td>
          <td>${escHtml(s.S)}</td><td>${escHtml(s.T)}</td><td>${escHtml(s.W)}</td>
          <td>${escHtml(s.I)}</td>
        </tr>
        <tr class="stat-row-lower">
          <th>A</th><th>Ld</th><th>Sv</th><td colspan="4"></td>
        </tr>
        <tr>
          <td>${escHtml(s.A)}</td><td>${escHtml(s.Ld)}</td><td>${escHtml(s.Sv)}</td>
          <td colspan="4"></td>
        </tr>
      </table>
    </div>
    <div class="panel-section">
      <div class="panel-row">Models: <strong>${alive}</strong> alive / ${total} total</div>
      <div class="panel-row">Ranks: ${numRanks} × ${unit.rankWidth}</div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Weapons</div>
      <ul class="panel-list">${weaponItems}</ul>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">Special Rules</div>
      <ul class="panel-list">${abilityItems}</ul>
    </div>
    ${buildMovementSection(unit)}
  `;

  panel.classList.add('panel-open');

  if (state.phase === 'movement') attachMovementListeners(unit);
}

function hidePanel() {
  document.getElementById('stat-panel').classList.remove('panel-open');
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  initTestUnits();
  renderGrid();
  renderBoard();
  renderPhaseTracker();

  document.getElementById('btn-end-phase').addEventListener('click', endMovementPhase);

  document.getElementById('board').addEventListener('contextmenu', e => {
    e.preventDefault();
    const target = e.target.closest('[data-model-id]');
    if (!target) return;
    toggleModelDead(target.dataset.unitId, target.dataset.modelId);
  });

  document.getElementById('board').addEventListener('click', e => {
    if (e.target.id === 'board' || e.target.id === 'board-bg') deselectAll();
  });

  // Context-aware keyboard handling
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (moveGhost || moveMode) { cancelGhost(); return; }
      deselectAll();
      return;
    }

    if (e.key === 'Enter' && moveGhost) {
      e.preventDefault();
      commitGhost();
      return;
    }

    if (moveMode === 'move') {
      if (e.key === 'ArrowUp')   { e.preventDefault(); handleMoveKey(1);  return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); handleMoveKey(-1); return; }
    }

    if (moveMode === 'wheel') {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handleWheelKey(-WHEEL_DEG); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleWheelKey( WHEEL_DEG); return; }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
