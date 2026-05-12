// Tests de las heurísticas de redacción de content.js.
//
// Ejecutar:
//   node Extension/test_redaction.test.js
//
// El test extrae los regex literales de content.js para usar la misma fuente
// de verdad; si cambias los patrones allá, este test los toma en automático.
// No carga la lógica DOM-dependiente — solo verifica los regex de detección.

const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

function extractRegex(name) {
  // Match `const _NAME = /pattern/flags;` en una línea
  const re  = new RegExp(`const\\s+${name}\\s*=\\s*(/.+?/[gimsuy]*)\\s*;`);
  const m   = SRC.match(re);
  if (!m) throw new Error(`Regex ${name} no encontrado en content.js`);
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

const TYPE_RE = extractRegex('_SENSITIVE_TYPE_RE');
const AUTO_RE = extractRegex('_SENSITIVE_AUTOCOMPLETE_RE');
const NAME_RE = extractRegex('_SENSITIVE_NAME_RE');

// ── Mini harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; failures.push({ name, e }); console.log(`  FAIL ${name}  ${e.message}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

// ── _SENSITIVE_TYPE_RE ───────────────────────────────────────────────────────
console.log('\n_SENSITIVE_TYPE_RE');
test('matches type=password', () => eq(TYPE_RE.test('password'), true));
test('case insensitive', () => eq(TYPE_RE.test('PASSWORD'), true));
test('does not match type=text', () => eq(TYPE_RE.test('text'), false));
test('does not match type=email', () => eq(TYPE_RE.test('email'), false));
test('does not match empty', () => eq(TYPE_RE.test(''), false));

// ── _SENSITIVE_AUTOCOMPLETE_RE ───────────────────────────────────────────────
console.log('\n_SENSITIVE_AUTOCOMPLETE_RE');
test('matches current-password', () => eq(AUTO_RE.test('current-password'), true));
test('matches new-password',     () => eq(AUTO_RE.test('new-password'), true));
test('matches one-time-code',    () => eq(AUTO_RE.test('one-time-code'), true));
test('matches cc-number',        () => eq(AUTO_RE.test('cc-number'), true));
test('matches cc-csc',           () => eq(AUTO_RE.test('cc-csc'), true));
test('matches cc-exp',           () => eq(AUTO_RE.test('cc-exp'), true));
test('matches cc-exp-month',     () => eq(AUTO_RE.test('cc-exp-month'), true));
test('does not match email',     () => eq(AUTO_RE.test('email'), false));
test('does not match username',  () => eq(AUTO_RE.test('username'), false));
test('does not match given-name',() => eq(AUTO_RE.test('given-name'), false));

// ── _SENSITIVE_NAME_RE (se ejecuta sobre hint padded con espacios) ───────────
// La heurística usa: " name id aria-label placeholder " (espacios alrededor)
// para que tokens en bordes matcheen igual.
console.log('\n_SENSITIVE_NAME_RE');
function hint(...parts) { return ' ' + parts.join(' ') + ' '; }

test('matches "password"',         () => eq(NAME_RE.test(hint('password')), true));
test('matches "user_password"',    () => eq(NAME_RE.test(hint('user_password')), true));
test('matches "user-password"',    () => eq(NAME_RE.test(hint('user-password')), true));
test('matches "passwd"',           () => eq(NAME_RE.test(hint('passwd')), true));
test('matches "pwd"',              () => eq(NAME_RE.test(hint('pwd')), true));
test('matches "cvv"',              () => eq(NAME_RE.test(hint('cvv')), true));
test('matches "cvc"',              () => eq(NAME_RE.test(hint('cvc')), true));
test('matches "card-number"',      () => eq(NAME_RE.test(hint('card-number')), true));
test('matches "cardnumber"',       () => eq(NAME_RE.test(hint('cardnumber')), true));
test('matches "card_num"',         () => eq(NAME_RE.test(hint('card_num')), true));
test('matches "ccnum"',            () => eq(NAME_RE.test(hint('ccnum')), true));
test('matches "ssn"',              () => eq(NAME_RE.test(hint('ssn')), true));
test('matches "dni"',              () => eq(NAME_RE.test(hint('dni')), true));
test('matches "cuit"',             () => eq(NAME_RE.test(hint('cuit')), true));
test('matches "api_key"',          () => eq(NAME_RE.test(hint('api_key')), true));
test('matches "api-key"',          () => eq(NAME_RE.test(hint('api-key')), true));
test('matches "secret"',           () => eq(NAME_RE.test(hint('secret')), true));
test('matches "token"',            () => eq(NAME_RE.test(hint('token')), true));
test('matches "pin"',              () => eq(NAME_RE.test(hint('pin')), true));
test('matches "tax-id"',           () => eq(NAME_RE.test(hint('tax-id')), true));
test('matches "Enter password"',   () => eq(NAME_RE.test(hint('Enter password please')), true));

// Falsos positivos típicos
test('does not match "email"',           () => eq(NAME_RE.test(hint('email')), false));
test('does not match "username"',        () => eq(NAME_RE.test(hint('username')), false));
test('does not match "user_name"',       () => eq(NAME_RE.test(hint('user_name')), false));
test('does not match "address"',         () => eq(NAME_RE.test(hint('address')), false));
test('does not match "phone"',           () => eq(NAME_RE.test(hint('phone')), false));
test('does not match "name"',            () => eq(NAME_RE.test(hint('name')), false));
test('does not match "given_name"',      () => eq(NAME_RE.test(hint('given_name')), false));
test('does not match "company"',         () => eq(NAME_RE.test(hint('company')), false));
test('does not match "buenos aires"',    () => eq(NAME_RE.test(hint('buenos aires')), false));
test('does not match empty hint',        () => eq(NAME_RE.test(hint('')), false));

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.e.message}`);
  process.exit(1);
}
