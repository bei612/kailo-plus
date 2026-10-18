// DD-124(1)(2) reader for capability conformance vectors (format V2) shared by
// the isolated conformance tools and the built-in adapter tests. It only parses
// and checks the frozen registration document
// (contracts/domain/capability_conformance_vectors.schema.json,
// capability_vector_binding/capture.schema.json); Core remains the authority
// that registers, freezes, substitutes and compares. Nothing here produces an
// expectation: a PRECONDITION value comes only from what the candidate's own
// native entry returned (seed), a CAPTURE value only from the candidate's
// actual wire response during Core's run.
//
// Value sources are closed: every leaf of a step's input/expected document is
// LITERAL unless a binding declares it PRECONDITION or CAPTURE, in which case
// the literal there is exactly the reserved placeholder {{SOURCE:key}}.

export const SOURCES = Object.freeze(['PRECONDITION', 'CAPTURE']);
export const SIDES = Object.freeze(['INPUT', 'EXPECTED']);
export const SLOTS = Object.freeze(['CONTENT_REFERENCE_NATIVE_OBJECT_REF', 'CONTENT_REFERENCE_NATIVE_REVISION',
  'GENERATED_REF', 'ACTION_EXECUTION_ID', 'OPERATION_ID']);
// DD-124(4): a RECEIVER step depends on the service read edge; it runs only in
// the isolated receiver deployment and the production plan observes it.
export const DIRECTIONS = Object.freeze(['FORWARD', 'RECEIVER']);
// Same closed member names as Core's capability_vector.rs: nativeRevision is
// implementation-generated wherever it appears; these ids only Core generates.
const GENERATED_MEMBERS = Object.freeze(['nativeRevision']);
const CORE_MEMBERS = Object.freeze(['actionExecutionId', 'receiverActionExecutionId', 'operationId',
  'sourceReadActionExecutionId']);

export class VectorRefusal extends Error {}
const refuse = (message) => { throw new VectorRefusal(message); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v) => typeof v === 'string' && v.trim() !== '';
const identifier = (v) => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v);
// Any string starting with {{ is reserved for a declared binding.
const reserved = (v) => typeof v === 'string' && v.startsWith('{{');

export const placeholder = (source, key) => `{{${source}:${key}}}`;

// Absent is FORWARD (Core capability_vector.rs is_receiver).
export function isReceiver(step) {
  if (step.direction === undefined) return false;
  if (!DIRECTIONS.includes(step.direction)) refuse(`${step.stepKey}: direction ${step.direction} is not FORWARD or RECEIVER`);
  return step.direction === 'RECEIVER';
}

function exact(value, required, optional, label) {
  if (!isObject(value)) refuse(`${label}: object required`);
  for (const key of required) if (!Object.hasOwn(value, key)) refuse(`${label}: missing ${key}`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) refuse(`${label}: unknown field ${key}`);
}

// RFC 6901 JSON Pointer; '' addresses the whole document (never a binding).
export function tokens(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) refuse(`invalid JSON Pointer ${JSON.stringify(pointer)}`);
  return pointer.slice(1).split('/').map((part) => {
    if (/~[^01]/.test(part) || part.endsWith('~')) refuse(`invalid JSON Pointer escape in ${pointer}`);
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function container(document, pointer) {
  const parts = tokens(pointer);
  let node = document;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(node) && /^(0|[1-9][0-9]*)$/.test(part) && Number(part) < node.length) node = node[Number(part)];
    else if (isObject(node) && Object.hasOwn(node, part)) node = node[part];
    else refuse(`JSON Pointer ${pointer} does not resolve`);
  }
  const last = parts.at(-1);
  if (Array.isArray(node) ? !(/^(0|[1-9][0-9]*)$/.test(last) && Number(last) < node.length) : !(isObject(node) && Object.hasOwn(node, last))) {
    refuse(`JSON Pointer ${pointer} does not resolve`);
  }
  return [node, Array.isArray(node) ? Number(last) : last];
}

export function pointerGet(document, pointer) {
  const [node, key] = container(document, pointer);
  return node[key];
}

export function pointerSet(document, pointer, value) {
  const [node, key] = container(document, pointer);
  node[key] = value;
}

const escape = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');

// Every position (containers included) with its pointer and member name.
function positions(value, pointer = '', name = undefined, out = []) {
  if (Array.isArray(value)) value.forEach((item, index) => positions(item, `${pointer}/${index}`, undefined, out));
  else if (isObject(value)) for (const key of Object.keys(value)) positions(value[key], `${pointer}/${escape(key)}`, key, out);
  out.push({ pointer, name, value });
  return out;
}

const canonicalText = (value) => JSON.stringify(Array.isArray(value) ? value.map((v) => JSON.parse(canonicalText(v)))
  : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, JSON.parse(canonicalText(value[k]))])) : value);

function hasMember(document, name, value) {
  if (Array.isArray(document)) return document.some((child) => hasMember(child, name, value));
  if (!isObject(document)) return false;
  return Object.entries(document).some(([key, child]) => (key === name && canonicalText(child) === canonicalText(value))
    || hasMember(child, name, value));
}

function parseJson(text, label) {
  if (typeof text !== 'string') refuse(`${label}: JSON text required`);
  try { return JSON.parse(text); } catch { return refuse(`${label}: invalid JSON`); }
}

export function parseVectors(registration) {
  const vectors = typeof registration?.testVectorsJson === 'string'
    ? parseJson(registration.testVectorsJson, 'testVectorsJson') : registration?.testVectorsJson;
  if (!isObject(vectors) || !Array.isArray(vectors.cases)) refuse('testVectorsJson cases required');
  if (!['V1', 'V2'].includes(vectors.formatVersion)) refuse(`unknown vector formatVersion ${vectors.formatVersion}`);
  return vectors;
}

// Static DD-124 checks with the same rules as Core's register-time validator
// (core capability_vector.rs validate), plus the LITERAL/PRECONDITION/CAPTURE
// classification of every value. Returns { cases:[{caseKey, preconditions,
// steps:[{…, input, expected, bindings, captures, values}]}] } or refuses with
// the first violation: a refused document is one Core must not register.
export function analyseV2(vectors, label = 'vectors', operations = undefined) {
  exact(vectors, ['formatVersion', 'cases'], ['generatedRefs', 'preconditionKinds'], label);
  if (vectors.formatVersion !== 'V2') refuse(`${label}: V2 vectors required`);
  const generated = vectors.generatedRefs ?? [];
  if (!Array.isArray(generated)) refuse(`${label}.generatedRefs: array`);
  const generatedKeys = new Set();
  for (const ref of generated) {
    exact(ref, ['contractKey', 'side', 'pointer'], [], `${label}.generatedRefs[]`);
    tokens(ref.pointer);
    const id = `${ref.contractKey} ${ref.side} ${ref.pointer}`;
    if (!nonempty(ref.contractKey) || !SIDES.includes(ref.side) || generatedKeys.has(id)
      || (operations && !operations.includes(ref.contractKey))) refuse(`${label}.generatedRefs[]: unique known contractKey/side/pointer`);
    generatedKeys.add(id);
  }
  const isGenerated = (contractKey, side, pointer) => generatedKeys.has(`${contractKey} ${side} ${pointer}`);
  const kinds = new Map();
  for (const kind of vectors.preconditionKinds ?? []) {
    exact(kind, ['kind', 'properties', 'description'], [], `${label}.preconditionKinds[]`);
    if (!identifier(kind.kind) || kinds.has(kind.kind) || !nonempty(kind.description) || !Array.isArray(kind.properties)
      || kind.properties.some((p) => typeof p !== 'string' || !p || /\s/.test(p)) || new Set(kind.properties).size !== kind.properties.length) {
      refuse(`${label}.preconditionKinds: unique identifier kind with unique property names required`);
    }
    kinds.set(kind.kind, kind.properties);
  }
  if (!vectors.cases.length) refuse(`${label}: no cases`);
  const caseKeys = new Set();
  const cases = vectors.cases.map((vectorCase) => {
    exact(vectorCase, ['caseKey', 'steps'], ['preconditions'], `${label} case`);
    const where = `${label}:${vectorCase.caseKey}`;
    if (!identifier(vectorCase.caseKey) || caseKeys.has(vectorCase.caseKey)) refuse(`${where}: unique caseKey required`);
    caseKeys.add(vectorCase.caseKey);
    const preconditions = new Map();
    for (const item of vectorCase.preconditions ?? []) {
      exact(item, ['key', 'kind', 'properties'], [], `${where}.preconditions[]`);
      if (!identifier(item.key) || preconditions.has(item.key)) refuse(`${where}: unique identifier precondition key required`);
      const registered = kinds.get(item.kind) ?? refuse(`${where}/${item.key}: kind ${item.kind} is not in preconditionKinds`);
      if (!Array.isArray(item.properties)) refuse(`${where}/${item.key}: properties array`);
      const properties = {};
      for (const property of item.properties) {
        exact(property, ['name', 'valueJson'], [], `${where}/${item.key}.properties[]`);
        const value = parseJson(property.valueJson, `${where}/${item.key}.${property.name}`);
        if (!nonempty(property.name) || Object.hasOwn(properties, property.name) || reserved(value)) {
          refuse(`${where}/${item.key}: property ${property.name} must be unique with a literal value`);
        }
        properties[property.name] = value;
      }
      if (canonicalText(Object.keys(properties).sort()) !== canonicalText([...registered].sort())) {
        refuse(`${where}/${item.key}: exactly the registered properties of ${item.kind} must be declared`);
      }
      preconditions.set(item.key, { key: item.key, kind: item.kind, properties });
    }
    if (!Array.isArray(vectorCase.steps) || !vectorCase.steps.length) refuse(`${where}: steps required`);
    const stepKeys = new Set();
    const produced = new Map(); // capture key -> step index
    const consumed = new Set();
    const emitted = new Map(); // precondition key -> first INPUT step index
    const expectations = [];
    const steps = vectorCase.steps.map((step, index) => {
      exact(step, ['stepKey', 'contractKey', 'inputJson', 'expectedOutputJson'],
        ['referenceResourceId', 'referenceAssetId', 'bindings', 'captures', 'direction'], `${where} step`);
      const at = `${where}/${step.stepKey}`;
      if (!nonempty(step.stepKey) || stepKeys.has(step.stepKey) || !nonempty(step.contractKey)) refuse(`${at}: unique stepKey and contractKey required`);
      stepKeys.add(step.stepKey);
      const documents = { INPUT: parseJson(step.inputJson, `${at}.inputJson`), EXPECTED: parseJson(step.expectedOutputJson, `${at}.expectedOutputJson`) };
      // A RECEIVER step is observed, never sent: it names the receiver
      // Resource and has no result body of its own.
      const receiver = isReceiver(step);
      if (receiver && (step.referenceResourceId === undefined || step.referenceAssetId !== undefined
        || canonicalText(documents.EXPECTED) !== '{}')) {
        refuse(`${at}: a RECEIVER step names only referenceResourceId and expects {}`);
      }
      const captures = step.captures ?? [];
      if (!Array.isArray(captures)) refuse(`${at}.captures: array`);
      const own = new Map(); // GENERATED_REF pointer -> own capture key
      // RECEIVER: own isolated admission identifiers -> exact INPUT pointer
      // (GENERATED_REF) or null (Core execution id, bound at a Core member).
      const admission = new Map();
      for (const capture of captures) {
        exact(capture, ['key', 'slot'], ['pointer'], `${at}.captures[]`);
        if (!identifier(capture.key) || produced.has(capture.key)) refuse(`${at}: capture key unique in the case required`);
        produced.set(capture.key, index);
        if (['CONTENT_REFERENCE_NATIVE_OBJECT_REF', 'CONTENT_REFERENCE_NATIVE_REVISION'].includes(capture.slot)
          && !Object.hasOwn(capture, 'pointer') && step.referenceResourceId !== undefined) continue;
        if (capture.slot === 'GENERATED_REF' && !receiver && isGenerated(step.contractKey, 'EXPECTED', capture.pointer)) {
          own.set(capture.pointer, capture.key);
          continue;
        }
        if (capture.slot === 'GENERATED_REF' && receiver && isGenerated(step.contractKey, 'INPUT', capture.pointer)) {
          admission.set(capture.key, capture.pointer);
          continue;
        }
        if (['ACTION_EXECUTION_ID', 'OPERATION_ID'].includes(capture.slot)) {
          if (receiver && !Object.hasOwn(capture, 'pointer')) { admission.set(capture.key, null); continue; }
          refuse(`${at}/${capture.key}: Core execution ids are captured only by a RECEIVER step in the isolated receiver deployment (DD-124(4))`);
        }
        refuse(`${at}/${capture.key}: slot ${capture.slot} is not capturable here`);
      }
      const bindings = step.bindings ?? [];
      if (!Array.isArray(bindings)) refuse(`${at}.bindings: array`);
      for (const binding of bindings) {
        exact(binding, ['source', 'key', 'side', 'pointer'], [], `${at}.bindings[]`);
        if (!SOURCES.includes(binding.source) || !SIDES.includes(binding.side) || !identifier(binding.key)) refuse(`${at}: binding source/side/key`);
        tokens(binding.pointer);
      }
      // INPUT first: a precondition this step sends may be verified by the
      // same step's expectation, never before it was sent.
      const ordered = [...bindings.filter((b) => b.side === 'INPUT'), ...bindings.filter((b) => b.side === 'EXPECTED')];
      const declared = new Map();
      for (const binding of ordered) {
        const position = `${binding.side}${binding.pointer}`;
        let value;
        try { value = pointerGet(documents[binding.side], binding.pointer); } catch { value = undefined; }
        if (value !== placeholder(binding.source, binding.key) || declared.has(position)) {
          refuse(`${at}: ${position} must hold exactly ${placeholder(binding.source, binding.key)}, declared once`);
        }
        declared.set(position, binding);
        const admitted = admission.has(binding.key) && (admission.get(binding.key) === null
          ? CORE_MEMBERS.includes(tokens(binding.pointer).at(-1)) : admission.get(binding.key) === binding.pointer);
        if (binding.source === 'PRECONDITION' && binding.side === 'INPUT' && preconditions.has(binding.key)) {
          if (!emitted.has(binding.key)) emitted.set(binding.key, index);
        } else if (binding.source === 'PRECONDITION' && binding.side === 'EXPECTED' && emitted.has(binding.key)) {
          // verified after it was sent
        } else if (binding.source === 'CAPTURE' && !receiver && produced.has(binding.key) && produced.get(binding.key) < index) {
          // a RECEIVER request is never substituted with an earlier value
          consumed.add(binding.key);
        } else if (binding.source === 'CAPTURE' && binding.side === 'EXPECTED' && own.get(binding.pointer) === binding.key) {
          // self-captured generated result position
        } else if (binding.source === 'CAPTURE' && binding.side === 'INPUT' && admitted) {
          // the isolated admission's own identifier
          consumed.add(binding.key);
        } else refuse(`${at}: ${binding.source} ${binding.key} at ${position} is not available here`);
      }
      for (const [pointer, key] of own) {
        const bound = declared.get(`EXPECTED${pointer}`);
        if (bound?.source !== 'CAPTURE' || bound.key !== key) refuse(`${at}: own GENERATED_REF ${key} must be bound at EXPECTED${pointer}`);
      }
      for (const [key, pointer] of admission) {
        if (pointer === null) continue;
        const bound = declared.get(`INPUT${pointer}`);
        if (bound?.source !== 'CAPTURE' || bound.key !== key) refuse(`${at}: receiver GENERATED_REF ${key} must be bound at INPUT${pointer}`);
      }
      const values = [];
      for (const side of SIDES) {
        for (const { pointer, name, value } of positions(documents[side])) {
          const binding = declared.get(`${side}${pointer}`);
          const implementation = GENERATED_MEMBERS.includes(name) || isGenerated(step.contractKey, side, pointer);
          if (((reserved(value) || implementation) && !binding) || (CORE_MEMBERS.includes(name) && binding?.source !== 'CAPTURE')) {
            refuse(`${at}: ${side}${pointer} cannot be LITERAL (reserved, implementation- or Core-generated)`);
          }
          if (!isObject(value) && !Array.isArray(value)) {
            values.push({ side, pointer, source: binding?.source ?? 'LITERAL', ...(binding ? { key: binding.key } : {}) });
          }
        }
      }
      expectations.push(documents.EXPECTED);
      return { stepKey: step.stepKey, contractKey: step.contractKey, direction: receiver ? 'RECEIVER' : 'FORWARD',
        referenceResourceId: step.referenceResourceId,
        referenceAssetId: step.referenceAssetId, input: documents.INPUT, expected: documents.EXPECTED, bindings, captures, values };
    });
    for (const key of produced.keys()) if (!consumed.has(key)) refuse(`${where}: capture ${key} is never consumed by a later step`);
    for (const [key, precondition] of preconditions) {
      const from = emitted.get(key) ?? refuse(`${where}: precondition ${key} is never sent as INPUT`);
      for (const [name, value] of Object.entries(precondition.properties)) {
        if (!expectations.slice(from).some((document) => hasMember(document, name, value))) {
          refuse(`${where}: precondition ${key} property ${name} is never verified by a literal expectation`);
        }
      }
    }
    return { caseKey: vectorCase.caseKey, preconditions: [...preconditions.values()], steps };
  });
  return { generatedRefs: generated, preconditionKinds: [...kinds.keys()], cases };
}

// The suite carries an actually observed value into a later request (Core
// capability_vector.rs has_roundtrip): V2 needs one INPUT CAPTURE binding on a
// FORWARD step (a RECEIVER step's own INPUT captures describe its admission).
export function hasRoundtripV2(vectors) {
  return vectors.cases.some((c) => (c.steps ?? []).some((s) => s.direction !== 'RECEIVER'
    && (s.bindings ?? []).some((b) => b.source === 'CAPTURE' && b.side === 'INPUT')));
}

// Substitute already-known values into one step document. Used only where the
// value source is legitimate: PRECONDITION values from the native seed record,
// CAPTURE values from the same candidate's earlier wire response.
export function substitute(step, side, values) {
  const document = structuredClone(step[side === 'INPUT' ? 'input' : 'expected']);
  for (const binding of step.bindings.filter((item) => item.side === side)) {
    const table = values[binding.source] ?? {};
    if (!Object.hasOwn(table, binding.key) || !nonempty(table[binding.key])) {
      refuse(`${step.stepKey}: no ${binding.source} value for ${binding.key}`);
    }
    pointerSet(document, binding.pointer, table[binding.key]);
  }
  return document;
}
