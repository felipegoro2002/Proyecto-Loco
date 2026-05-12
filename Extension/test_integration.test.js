// Test de integración: simula un mínimo de DOM para verificar que
// _isSensitiveField, _formInfo y _findLabel se comportan como esperamos sobre
// elementos "reales".  No usa jsdom (sin dependencias externas) — solo objetos
// que implementan la interfaz que esas funciones tocan.
//
// Ejecutar:
//   node Extension/test_integration.test.js

const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

// ── Mini-DOM ────────────────────────────────────────────────────────────────
// Implementa exactamente lo que tocan las funciones bajo test.

class FakeElement {
  constructor({ tagName = 'DIV', id = '', name = '', type = '',
                attrs = {}, innerText = '', parent = null,
                children = [], className = '' } = {}) {
    this.tagName    = tagName;
    this.id         = id;
    this.name       = name;
    this.type       = type;
    this.innerText  = innerText;
    this.className  = className;
    this._attrs     = { ...attrs };
    this.parentElement = parent;
    this.parentNode    = parent;
    this.children   = children;
    this.attributes = Object.entries(this._attrs).map(([n, v]) => ({ name: n, value: v }));
    for (const c of children) c.parentElement = this, c.parentNode = this;
  }
  getAttribute(n)  { return n in this._attrs ? this._attrs[n] : null; }
  setAttribute(n, v) { this._attrs[n] = v; this.attributes = Object.entries(this._attrs).map(([nn, vv]) => ({ name: nn, value: vv })); }
  closest(selector) {
    // Soporta: 'form', '[role="form"]', 'form, [role="form"]', 'label'
    const sels = selector.split(',').map(s => s.trim());
    let cur = this;
    while (cur) {
      for (const s of sels) {
        if (s === 'form' && cur.tagName === 'FORM') return cur;
        if (s === 'label' && cur.tagName === 'LABEL') return cur;
        const roleMatch = s.match(/^\[role="([^"]+)"\]$/);
        if (roleMatch && cur.getAttribute('role') === roleMatch[1]) return cur;
        if (s === 'a' && cur.tagName === 'A') return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }
  querySelector() { return null; }   // sobrescrito por document global
}

// Document global con tabla de ids
const _byId = new Map();
global.document = {
  getElementById(id) { return _byId.get(id) || null; },
  querySelector(sel) {
    // Soporta solo `label[for="ID"]`
    const m = sel.match(/^label\[for="([^"]+)"\]$/);
    if (m) {
      for (const el of _byId.values()) {
        if (el.tagName === 'LABEL' && el.getAttribute('for') === m[1]) return el;
      }
    }
    return null;
  },
};
global.window = { location: { href: 'http://test.local/' } };
global.CSS    = { escape: (s) => s.replace(/(["\\])/g, '\\$1') };

function registerId(el) { if (el.id) _byId.set(el.id, el); for (const c of el.children) registerId(c); }

// ── Cargar las funciones que queremos testear desde content.js ──────────────
//
// Extraemos los bloques de definicion por marcador y los evaluamos.

function extractBlock(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  const b = SRC.indexOf(endMarker, a);
  if (a === -1 || b === -1) throw new Error(`No se encontraron markers ${startMarker} .. ${endMarker}`);
  return SRC.slice(a, b);
}

// Necesitamos getXPath, getCssPath, _isStableId, _AUTO_ID_RE, _NOISE_CLASS_RE
// para que elInfo funcione. Cargamos desde el comienzo del archivo hasta
// "function send(type, data)".
const helpersBlock = SRC.slice(0, SRC.indexOf('function send('));
eval(helpersBlock);

// ── Tests ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; failures.push({ name, e }); console.log(`  FAIL ${name}  ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg)     { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

// ── _isSensitiveField ──────────────────────────────────────────────────────
console.log('\n_isSensitiveField');

test('password input por type', () => {
  const el = new FakeElement({ tagName: 'INPUT', type: 'password', name: 'pw' });
  assert(_isSensitiveField(el));
});

test('credit card por autocomplete', () => {
  const el = new FakeElement({ tagName: 'INPUT', type: 'tel', attrs: { autocomplete: 'cc-number' } });
  assert(_isSensitiveField(el));
});

test('CVV por name', () => {
  const el = new FakeElement({ tagName: 'INPUT', type: 'tel', name: 'cvv' });
  assert(_isSensitiveField(el));
});

test('Password por aria-label aunque sea type=text', () => {
  const el = new FakeElement({ tagName: 'INPUT', type: 'text', attrs: { 'aria-label': 'Enter your password' } });
  assert(_isSensitiveField(el));
});

test('email NO es sensible', () => {
  const el = new FakeElement({ tagName: 'INPUT', type: 'email', name: 'email' });
  assert(!_isSensitiveField(el));
});

test('username NO es sensible', () => {
  const el = new FakeElement({ tagName: 'INPUT', type: 'text', name: 'username' });
  assert(!_isSensitiveField(el));
});

test('input vacio no crashea', () => {
  assert(!_isSensitiveField(null));
  assert(!_isSensitiveField({}));
});

// ── _formInfo ──────────────────────────────────────────────────────────────
console.log('\n_formInfo');

test('input dentro de <form id="X">', () => {
  const input = new FakeElement({ tagName: 'INPUT', name: 'email' });
  const form  = new FakeElement({ tagName: 'FORM', id: 'checkout-form',
                                  attrs: { name: 'checkout', action: '/api/pay' },
                                  children: [input] });
  const info = _formInfo(input);
  eq(info.form_id, 'checkout-form');
  eq(info.form_name, 'checkout');
  eq(info.form_action, '/api/pay');
});

test('input dentro de [role="form"]', () => {
  const input = new FakeElement({ tagName: 'INPUT' });
  const div   = new FakeElement({ tagName: 'DIV', attrs: { role: 'form', name: 'spa-form' },
                                  children: [input] });
  const info = _formInfo(input);
  assert(info !== null);
  eq(info.form_name, 'spa-form');
});

test('input fuera de cualquier form devuelve null', () => {
  const input = new FakeElement({ tagName: 'INPUT' });
  eq(_formInfo(input), null);
});

test('form sin id ni name ni action devuelve null', () => {
  const input = new FakeElement({ tagName: 'INPUT' });
  new FakeElement({ tagName: 'FORM', children: [input] });
  eq(_formInfo(input), null);
});

// ── _findLabel ────────────────────────────────────────────────────────────
console.log('\n_findLabel');

test('label por <label for>', () => {
  _byId.clear();
  const input = new FakeElement({ tagName: 'INPUT', id: 'email-field' });
  const label = new FakeElement({ tagName: 'LABEL', attrs: { for: 'email-field' }, innerText: 'Email address' });
  _byId.set('email-field', input);
  _byId.set('lbl1', label);  // necesario para que querySelector lo encuentre
  // override querySelector temporalmente
  global.document.querySelector = (sel) => {
    const m = sel.match(/^label\[for="([^"]+)"\]$/);
    if (m) return label.getAttribute('for') === m[1] ? label : null;
    return null;
  };
  eq(_findLabel(input), 'Email address');
});

test('label por aria-labelledby', () => {
  _byId.clear();
  const labelDiv = new FakeElement({ tagName: 'DIV', id: 'lbl-tax', innerText: 'Tax ID' });
  const input    = new FakeElement({ tagName: 'INPUT', attrs: { 'aria-labelledby': 'lbl-tax' } });
  _byId.set('lbl-tax', labelDiv);
  eq(_findLabel(input), 'Tax ID');
});

test('label envolvente <label><input/></label>', () => {
  _byId.clear();
  const input = new FakeElement({ tagName: 'INPUT' });
  const label = new FakeElement({ tagName: 'LABEL', innerText: 'Username', children: [input] });
  eq(_findLabel(input), 'Username');
});

test('sin label devuelve ""', () => {
  _byId.clear();
  const input = new FakeElement({ tagName: 'INPUT' });
  eq(_findLabel(input), '');
});

// ── _redactedValue ────────────────────────────────────────────────────────
console.log('\n_redactedValue');

test('redacta string normal', () => {
  const r = _redactedValue('secret123');
  eq(r.value, '[REDACTED]');
  eq(r.value_length, 9);
  eq(r.redacted, true);
});

test('redacta valor vacio con length 0', () => {
  const r = _redactedValue('');
  eq(r.value_length, 0);
  eq(r.redacted, true);
});

test('redacta null/undefined', () => {
  const r = _redactedValue(null);
  eq(r.value_length, 0);
});

// ── Resumen ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.e.message}`);
  process.exit(1);
}
