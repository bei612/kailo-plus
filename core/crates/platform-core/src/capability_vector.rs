//! DD-124(1)(2): value sources of `V2` conformance vectors. A value is LITERAL
//! unless a binding declares it PRECONDITION or CAPTURE at an exact JSON
//! Pointer whose literal is the reserved placeholder `{{SOURCE:key}}`. This is
//! the generic runner semantics shipped with Core (DD-102(4)), not a
//! configurable matcher: no expressions, no extra mappings, no fixture rewrite.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::{bad, identifier};
use crate::governance::Refusal;

const V2: &str = "V2";
const PRECONDITION: &str = "PRECONDITION";
const CAPTURE: &str = "CAPTURE";
const INPUT: &str = "INPUT";
const EXPECTED: &str = "EXPECTED";
const FORWARD: &str = "FORWARD";
const RECEIVER: &str = "RECEIVER";
const OBJECT_SLOT: &str = "CONTENT_REFERENCE_NATIVE_OBJECT_REF";
const REVISION_SLOT: &str = "CONTENT_REFERENCE_NATIVE_REVISION";
const GENERATED_SLOT: &str = "GENERATED_REF";
const ACTION_SLOT: &str = "ACTION_EXECUTION_ID";
const OPERATION_SLOT: &str = "OPERATION_ID";
/// `native_revision` is implementation-generated wherever it appears.
const GENERATED_MEMBERS: [&str; 1] = ["nativeRevision"];
/// Identifiers that only Core generates for an admission or a receipt.
const CORE_MEMBERS: [&str; 4] = [
    "actionExecutionId",
    "receiverActionExecutionId",
    "operationId",
    "sourceReadActionExecutionId",
];

pub(crate) fn placeholder(source: &str, key: &str) -> String {
    format!("{{{{{source}:{key}}}}}")
}

/// Any string starting with `{{` is reserved for a declared binding.
fn reserved(value: &Value) -> bool {
    value.as_str().is_some_and(|text| text.starts_with("{{"))
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(bad)
}

fn list<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], Refusal> {
    match value.get(key) {
        Some(items) => items.as_array().map(Vec::as_slice).ok_or_else(bad),
        None => Ok(&[]),
    }
}

fn pointer(value: &Value) -> Result<&str, Refusal> {
    value
        .as_str()
        .filter(|pointer| pointer.starts_with('/'))
        .ok_or_else(bad)
}

fn document(step: &Value, field: &str) -> Result<Value, Refusal> {
    serde_json::from_str(text(step, field)?).map_err(|_| bad())
}

fn escape(token: &str) -> String {
    token.replace('~', "~0").replace('/', "~1")
}

/// The object member a JSON Pointer ends in (unescaped).
fn member_of(pointer: &str) -> String {
    pointer
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .replace("~1", "/")
        .replace("~0", "~")
}

/// Every position of a document with its JSON Pointer and object member name.
fn positions<'a>(
    value: &'a Value,
    path: String,
    name: Option<&'a str>,
    out: &mut Vec<(String, Option<&'a str>, &'a Value)>,
) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let at = format!("{path}/{}", escape(key));
                positions(child, at, Some(key.as_str()), out);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                positions(child, format!("{path}/{index}"), None, out);
            }
        }
        _ => {}
    }
    out.push((path, name, value));
}

fn has_member(document: &Value, name: &str, value: &Value) -> bool {
    match document {
        Value::Object(map) => {
            for (key, child) in map {
                if (key == name && child == value) || has_member(child, name, value) {
                    return true;
                }
            }
            false
        }
        Value::Array(items) => items.iter().any(|child| has_member(child, name, value)),
        _ => false,
    }
}

struct Binding<'a> {
    source: &'a str,
    key: &'a str,
    side: &'a str,
    pointer: &'a str,
}

fn bindings(step: &Value) -> Result<Vec<Binding<'_>>, Refusal> {
    let mut parsed = Vec::new();
    for binding in list(step, "bindings")? {
        let entry = Binding {
            source: text(binding, "source")?,
            key: text(binding, "key")?,
            side: text(binding, "side")?,
            pointer: pointer(&binding["pointer"])?,
        };
        if !matches!(entry.source, PRECONDITION | CAPTURE)
            || !matches!(entry.side, INPUT | EXPECTED)
            || !identifier(entry.key)
        {
            return Err(bad());
        }
        parsed.push(entry);
    }
    Ok(parsed)
}

struct Capture<'a> {
    key: &'a str,
    slot: &'a str,
    pointer: Option<&'a str>,
}

fn captures(step: &Value) -> Result<Vec<Capture<'_>>, Refusal> {
    let mut parsed = Vec::new();
    for capture in list(step, "captures")? {
        let entry = Capture {
            key: text(capture, "key")?,
            slot: text(capture, "slot")?,
            pointer: capture.get("pointer").map(pointer).transpose()?,
        };
        if !identifier(entry.key) {
            return Err(bad());
        }
        parsed.push(entry);
    }
    Ok(parsed)
}

fn own_keys(step: &Value) -> Result<BTreeSet<&str>, Refusal> {
    let mut keys = BTreeSet::new();
    for capture in captures(step)? {
        keys.insert(capture.key);
    }
    Ok(keys)
}

/// Capture keys the step reads from earlier steps. An EXPECTED binding to a
/// value this same step captures keeps its placeholder; the actual result is
/// normalized at that pointer instead (see `capture`).
fn needed(step: &Value) -> Result<BTreeSet<&str>, Refusal> {
    let own = own_keys(step)?;
    let mut keys = BTreeSet::new();
    for binding in bindings(step)? {
        if binding.source == CAPTURE && !own.contains(binding.key) {
            keys.insert(binding.key);
        }
    }
    Ok(keys)
}

pub(crate) fn is_v2(vectors: &Value) -> bool {
    vectors["formatVersion"] == V2
}

/// DD-124(3)(4): a RECEIVER step depends on the service read edge and runs in
/// the isolated deployment; the production plan only observes it. Absent is
/// FORWARD. V1 vectors never carry the field.
pub(crate) fn is_receiver(step: &Value) -> Result<bool, Refusal> {
    match step.get("direction") {
        None => Ok(false),
        Some(value) => match value.as_str() {
            Some(FORWARD) => Ok(false),
            Some(RECEIVER) => Ok(true),
            _ => Err(bad()),
        },
    }
}

/// A runnable REMOTE_ADAPTER suite carries at least one actually observed
/// value into a later request: V1 `referenceFromStepKey`, V2 INPUT CAPTURE.
pub(crate) fn has_roundtrip(vectors: &Value) -> bool {
    for case in list(vectors, "cases").unwrap_or_default() {
        for step in list(case, "steps").unwrap_or_default() {
            if step.get("referenceFromStepKey").is_some() {
                return true;
            }
            // A RECEIVER step's own INPUT captures describe the isolated
            // admission; they are not a value carried into a later request.
            if is_receiver(step).unwrap_or(true) {
                continue;
            }
            for binding in bindings(step).unwrap_or_default() {
                if binding.source == CAPTURE && binding.side == INPUT {
                    return true;
                }
            }
        }
    }
    false
}

/// V1 keeps its original rules; V2 fields cannot be smuggled into it.
fn v1_only(vectors: &Value, cases: &[Value]) -> Result<(), Refusal> {
    let mut fields = vec![
        vectors.get("generatedRefs"),
        vectors.get("preconditionKinds"),
    ];
    for case in cases {
        fields.push(case.get("preconditions"));
        for step in list(case, "steps")? {
            fields.push(step.get("bindings"));
            fields.push(step.get("captures"));
            fields.push(step.get("direction"));
        }
    }
    if fields.iter().any(Option::is_some) {
        return Err(bad());
    }
    Ok(())
}

/// Register-time checks (V-SCN-117) on a schema-checked canonical document.
pub(crate) fn validate(vectors: &Value, operations: &BTreeSet<&str>) -> Result<(), Refusal> {
    let cases = list(vectors, "cases")?;
    if !is_v2(vectors) {
        return v1_only(vectors, cases);
    }
    let mut generated = BTreeSet::new();
    for entry in list(vectors, "generatedRefs")? {
        let contract = text(entry, "contractKey")?;
        let side = text(entry, "side")?;
        let at = pointer(&entry["pointer"])?;
        if !operations.contains(contract)
            || !matches!(side, INPUT | EXPECTED)
            || !generated.insert((contract, side, at))
        {
            return Err(bad());
        }
    }
    let mut kinds = BTreeMap::new();
    for entry in list(vectors, "preconditionKinds")? {
        let kind = text(entry, "kind")?;
        text(entry, "description")?;
        let mut properties = BTreeSet::new();
        for name in list(entry, "properties")? {
            let name = name.as_str().ok_or_else(bad)?;
            let valid = !name.is_empty() && !name.contains(char::is_whitespace);
            if !valid || !properties.insert(name) {
                return Err(bad());
            }
        }
        if !identifier(kind) || kinds.insert(kind, properties).is_some() {
            return Err(bad());
        }
    }
    for case in cases {
        validate_case(case, &generated, &kinds)?;
    }
    Ok(())
}

fn validate_case(
    case: &Value,
    generated: &BTreeSet<(&str, &str, &str)>,
    kinds: &BTreeMap<&str, BTreeSet<&str>>,
) -> Result<(), Refusal> {
    let mut preconditions = BTreeMap::new();
    for entry in list(case, "preconditions")? {
        let key = text(entry, "key")?;
        let registered = kinds.get(text(entry, "kind")?).ok_or_else(bad)?;
        let mut properties = BTreeMap::new();
        for property in list(entry, "properties")? {
            let value: Value =
                serde_json::from_str(text(property, "valueJson")?).map_err(|_| bad())?;
            let name = text(property, "name")?;
            if reserved(&value) || properties.insert(name, value).is_some() {
                return Err(bad());
            }
        }
        let names: BTreeSet<&str> = properties.keys().copied().collect();
        if !identifier(key)
            || names != *registered
            || preconditions.insert(key, properties).is_some()
        {
            return Err(bad());
        }
    }
    let steps = list(case, "steps")?;
    let mut expectations = Vec::with_capacity(steps.len());
    let mut produced = BTreeMap::new();
    let mut consumed = BTreeSet::new();
    let mut emitted = BTreeMap::new();
    for (index, step) in steps.iter().enumerate() {
        if step.get("referenceFromStepKey").is_some() {
            return Err(bad());
        }
        let contract = text(step, "contractKey")?;
        let input = document(step, "inputJson")?;
        let expected = document(step, "expectedOutputJson")?;
        let reference = step.get("referenceResourceId").is_some();
        // DD-124(4): a RECEIVER step is observed, never sent. It names the
        // receiver Resource and has no result body of its own.
        let receiver = is_receiver(step)?;
        if receiver
            && (!reference || step.get("referenceAssetId").is_some() || expected != json!({}))
        {
            return Err(bad());
        }
        let mut own = BTreeMap::new();
        // Own receiver captures bound in this step's INPUT: the isolated
        // admission's identifiers (GENERATED_REF keeps its exact pointer).
        let mut admission = BTreeMap::new();
        for capture in captures(step)? {
            if produced.insert(capture.key, index).is_some() {
                return Err(bad());
            }
            match (capture.slot, capture.pointer) {
                (OBJECT_SLOT | REVISION_SLOT, None) if reference => {}
                (GENERATED_SLOT, Some(at))
                    if !receiver && generated.contains(&(contract, EXPECTED, at)) =>
                {
                    own.insert(at, capture.key);
                }
                (GENERATED_SLOT, Some(at))
                    if receiver && generated.contains(&(contract, INPUT, at)) =>
                {
                    admission.insert(capture.key, Some(at));
                }
                // Isolated-Core identifiers exist only for a RECEIVER step.
                (ACTION_SLOT | OPERATION_SLOT, None) if receiver => {
                    admission.insert(capture.key, None);
                }
                _ => return Err(bad()),
            }
        }
        let declared = bindings(step)?;
        // INPUT first: a PRECONDITION sent by this step may be verified by
        // the same step's expectation, never before it was sent.
        let mut ordered: Vec<&Binding> = declared.iter().filter(|b| b.side == INPUT).collect();
        ordered.extend(declared.iter().filter(|b| b.side == EXPECTED));
        let mut bound = BTreeMap::new();
        for binding in ordered {
            let target = if binding.side == INPUT {
                &input
            } else {
                &expected
            };
            let literal = json!(placeholder(binding.source, binding.key));
            let at = (binding.side, binding.pointer);
            if target.pointer(binding.pointer) != Some(&literal)
                || bound.insert(at, (binding.source, binding.key)).is_some()
            {
                return Err(bad());
            }
            // A RECEIVER step may bind its own isolated admission identifiers
            // where that admission carries them (an execution id member or the
            // exact generated position).
            let admitted = admission.get(binding.key).is_some_and(|at| match at {
                Some(at) => *at == binding.pointer,
                None => CORE_MEMBERS.contains(&member_of(binding.pointer).as_str()),
            });
            match (binding.source, binding.side) {
                (PRECONDITION, INPUT) if preconditions.contains_key(binding.key) => {
                    emitted.entry(binding.key).or_insert(index);
                }
                (PRECONDITION, EXPECTED) if emitted.contains_key(binding.key) => {}
                // A RECEIVER request is not substituted: it cannot carry an
                // earlier step's value.
                (CAPTURE, _)
                    if !receiver && produced.get(binding.key).is_some_and(|at| *at < index) =>
                {
                    consumed.insert(binding.key);
                }
                (CAPTURE, EXPECTED) if own.get(binding.pointer) == Some(&binding.key) => {}
                (CAPTURE, INPUT) if admitted => {
                    consumed.insert(binding.key);
                }
                _ => return Err(bad()),
            }
        }
        for (at, key) in &own {
            if bound.get(&(EXPECTED, *at)) != Some(&(CAPTURE, *key)) {
                return Err(bad());
            }
        }
        for (key, at) in &admission {
            if let Some(at) = at {
                if bound.get(&(INPUT, *at)) != Some(&(CAPTURE, *key)) {
                    return Err(bad());
                }
            }
        }
        for (side, document) in [(INPUT, &input), (EXPECTED, &expected)] {
            let mut all = Vec::new();
            positions(document, String::new(), None, &mut all);
            for (path, name, value) in all {
                let binding = bound.get(&(side, path.as_str()));
                let member = name.unwrap_or_default();
                let implementation = GENERATED_MEMBERS.contains(&member)
                    || generated.contains(&(contract, side, path.as_str()));
                let core = CORE_MEMBERS.contains(&member);
                let unbound = binding.is_none();
                let uncaptured = binding.is_none_or(|(source, _)| *source != CAPTURE);
                if ((reserved(value) || implementation) && unbound) || (core && uncaptured) {
                    return Err(bad());
                }
            }
        }
        expectations.push(expected);
    }
    if produced.keys().any(|key| !consumed.contains(key)) {
        return Err(bad());
    }
    for (key, properties) in &preconditions {
        let from = *emitted.get(key).ok_or_else(bad)?;
        let later = &expectations[from..];
        for (name, value) in properties {
            if !later.iter().any(|doc| has_member(doc, name, value)) {
                return Err(bad());
            }
        }
    }
    Ok(())
}

/// Fixture values for every V2 precondition of the frozen contracts: exactly
/// one opaque value per declaration, keyed by the plan case key. They are the
/// identifiers the candidate's native entry returned, never expectations.
pub(crate) fn fixture_values(
    fixture: &Value,
    contracts: &[Value],
) -> Result<BTreeMap<(String, String), String>, Refusal> {
    let mut declared = BTreeSet::new();
    for contract in contracts {
        let content = &contract["content"];
        let category = text(content, "categoryKey")?;
        let version = content["contractVersion"].as_i64().ok_or_else(bad)?;
        for case in list(&contract["vectors"], "cases")? {
            let case_key = format!("{category}:{version}:{}", text(case, "caseKey")?);
            for entry in list(case, "preconditions")? {
                declared.insert((case_key.clone(), text(entry, "key")?.to_owned()));
            }
        }
    }
    let mut values = BTreeMap::new();
    for entry in list(fixture, "preconditions")? {
        let case_key = text(entry, "caseKey")?.to_owned();
        let key = text(entry, "key")?.to_owned();
        let value = text(entry, "value")?.to_owned();
        if reserved(&entry["value"]) || values.insert((case_key, key), value).is_some() {
            return Err(bad());
        }
    }
    let supplied: BTreeSet<_> = values.keys().cloned().collect();
    if supplied != declared {
        return Err(bad());
    }
    Ok(values)
}

fn substitute(document: &mut Value, binding: &Value, value: &str) -> Result<(), Refusal> {
    let literal = json!(placeholder(text(binding, "source")?, text(binding, "key")?));
    let at = pointer(&binding["pointer"])?;
    let slot = document.pointer_mut(at).ok_or_else(bad)?;
    if *slot != literal {
        return Err(bad());
    }
    *slot = Value::String(value.to_owned());
    Ok(())
}

/// Freeze one V2 vector step: substitute the fixture PRECONDITION values and
/// keep only the CAPTURE declarations (no values) for the runtime.
pub(crate) fn freeze_step(
    step: &Value,
    case_key: &str,
    values: &BTreeMap<(String, String), String>,
) -> Result<(String, String, Vec<Value>), Refusal> {
    let mut input = document(step, "inputJson")?;
    let mut expected = document(step, "expectedOutputJson")?;
    let mut remaining = Vec::new();
    for binding in list(step, "bindings")? {
        if binding["source"] != PRECONDITION {
            remaining.push(binding.clone());
            continue;
        }
        let key = (case_key.to_owned(), text(binding, "key")?.to_owned());
        let value = values.get(&key).ok_or_else(bad)?;
        let target = if binding["side"] == INPUT {
            &mut input
        } else {
            &mut expected
        };
        substitute(target, binding, value)?;
    }
    let input = serde_json::to_string(&input).map_err(|_| bad())?;
    let expected = serde_json::to_string(&expected).map_err(|_| bad())?;
    Ok((input, expected, remaining))
}

/// The values a probe supplies for the step's CAPTURE bindings: exactly the
/// needed keys, each an opaque non-empty value that is not a placeholder.
pub(crate) fn probe_values(
    step: &Value,
    probe: &Value,
) -> Result<BTreeMap<String, String>, Refusal> {
    let mut values = BTreeMap::new();
    for entry in list(probe, "captures")? {
        let key = text(entry, "key")?.to_owned();
        let value = text(entry, "value")?.to_owned();
        if reserved(&entry["value"]) || values.insert(key, value).is_some() {
            return Err(bad());
        }
    }
    let supplied: BTreeSet<&str> = values.keys().map(String::as_str).collect();
    if supplied != needed(step)? {
        return Err(bad());
    }
    Ok(values)
}

/// The same values taken from the recorded observations of the report.
pub(crate) fn recorded_values(
    step: &Value,
    case: &str,
    recorded: &BTreeMap<(String, String), String>,
) -> Result<BTreeMap<String, String>, Refusal> {
    let mut values = BTreeMap::new();
    for key in needed(step)? {
        let value = recorded.get(&(case.to_owned(), key.to_owned()));
        values.insert(key.to_owned(), value.ok_or_else(bad)?.clone());
    }
    Ok(values)
}

/// Substitute CAPTURE values into the execute request input before the
/// ActionToken is signed, and into the expectation before it is digested.
pub(crate) fn apply(
    step: &Value,
    values: &BTreeMap<String, String>,
    request: &mut Value,
    expected: &mut Value,
) -> Result<(), Refusal> {
    let own = own_keys(step)?;
    for binding in list(step, "bindings")? {
        let key = text(binding, "key")?;
        if binding["source"] != CAPTURE {
            return Err(bad());
        }
        let target = match text(binding, "side")? {
            INPUT => request.pointer_mut("/arguments/input").ok_or_else(bad)?,
            EXPECTED if own.contains(key) => continue,
            EXPECTED => &mut *expected,
            _ => return Err(bad()),
        };
        let value = values.get(key).ok_or_else(bad)?;
        substitute(target, binding, value)?;
    }
    Ok(())
}

/// Read the declared captures from an actual SUCCEEDED response that carries
/// its native terminal status (DD-124(5)). A self-captured result position is
/// reset to its placeholder before the result is digested, so every other
/// field is still compared exactly. An incomplete slot yields no captures.
pub(crate) fn capture(
    step: &Value,
    response: &Value,
    mut result: Option<&mut Value>,
) -> Result<Option<Vec<Value>>, Refusal> {
    let declared = captures(step)?;
    let execution = &response["execution"];
    if declared.is_empty()
        || execution["platformStatus"] != "SUCCEEDED"
        || text(execution, "nativeStatus").is_err()
    {
        return Ok(None);
    }
    let reference = &response["contentReference"];
    let mut values = Vec::new();
    for capture in &declared {
        let value = match (capture.slot, capture.pointer) {
            (OBJECT_SLOT, None) => reference["nativeObjectRef"].clone(),
            (REVISION_SLOT, None) => reference["nativeRevision"].clone(),
            (GENERATED_SLOT, Some(at)) => {
                let Some(document) = result.as_mut() else {
                    return Ok(None);
                };
                let Some(slot) = document.pointer_mut(at) else {
                    return Ok(None);
                };
                let literal = json!(placeholder(CAPTURE, capture.key));
                std::mem::replace(slot, literal)
            }
            _ => return Err(bad()),
        };
        let usable = value.as_str().is_some_and(|text| !text.trim().is_empty());
        if !usable || reserved(&value) {
            return Ok(None);
        }
        values.push(json!({"key":capture.key,"value":value}));
    }
    Ok(Some(values))
}

/// Recorded captures of one observation: exactly the declared keys in order;
/// a typed-slot capture equals the observation's typed ContentReference.
pub(crate) fn observed(
    step: &Value,
    observation: &Value,
) -> Result<Vec<(String, String)>, Refusal> {
    let declared = captures(step)?;
    let supplied = list(observation, "captures")?;
    let present = observation.get("captures").is_some();
    if declared.len() != supplied.len() || (present && supplied.is_empty()) {
        return Err(bad());
    }
    let reference = &observation["contentReference"];
    let mut values = Vec::with_capacity(declared.len());
    for (capture, entry) in declared.iter().zip(supplied) {
        let value = text(entry, "value")?;
        if entry["key"] != capture.key || reserved(&entry["value"]) {
            return Err(bad());
        }
        let typed = match capture.slot {
            OBJECT_SLOT => &reference["nativeObjectRef"],
            REVISION_SLOT => &reference["nativeRevision"],
            GENERATED_SLOT => &entry["value"],
            _ => return Err(bad()),
        };
        if *typed != entry["value"] {
            return Err(bad());
        }
        values.push((capture.key.to_owned(), value.to_owned()));
    }
    Ok(values)
}

/// DD-124(4): the read of a RECEIVER step's completed observation and the
/// receiver admission the isolated Core produced for it. A native batch admits
/// one SERVICE receiver per read; an APPLICATION receiver action anchors every
/// read and its frozen arguments carry the input the isolated Core admitted.
pub(crate) fn receiver_admission<'a>(
    step: &Value,
    native: &'a Value,
) -> Result<(&'a Value, Value), Refusal> {
    let reads = list(native, "readOperations")?;
    let batch = native["request"].get("importConfigRef").is_some();
    let read = if batch {
        reads.iter().find(|read| {
            read["nativeBatch"]["actionKey"] == step["contractKey"]
                && read["nativeBatch"]["receiverResourceId"] == step["referenceResourceId"]
        })
    } else {
        reads.first()
    }
    .ok_or_else(bad)?;
    if batch {
        let input = json!({"sourceResourceId":read["sourceResourceId"],
            "importConfigRef":read["nativeBatch"]["importConfigRef"],
            "batchId":read["nativeBatch"]["batchId"],
            "sourceReadActionExecutionId":read["actionExecutionId"]});
        return Ok((read, input));
    }
    let encoded = text(&read["readRequest"], "receiverArgumentsJson")?;
    let arguments: Value = serde_json::from_str(encoded).map_err(|_| bad())?;
    if arguments["target"]["resourceId"] != step["referenceResourceId"] {
        return Err(bad());
    }
    Ok((read, arguments["input"].clone()))
}

/// The captures of a RECEIVER step, read from that admission only: the SOURCE
/// read ActionExecution and Operation the isolated Core generated, the
/// receiver's own read_receipt reference, or a generated admission field.
pub(crate) fn receiver_values(
    step: &Value,
    read: &Value,
    input: &Value,
) -> Result<Vec<(String, String)>, Refusal> {
    let mut values = Vec::new();
    for capture in captures(step)? {
        let value = match (capture.slot, capture.pointer) {
            (ACTION_SLOT, None) => &read["actionExecutionId"],
            (OPERATION_SLOT, None) => &read["operationId"],
            (OBJECT_SLOT, None) => &read["receiverReceipt"]["nativeObjectRef"],
            (REVISION_SLOT, None) => &read["receiverReceipt"]["nativeRevision"],
            (GENERATED_SLOT, Some(at)) => input.pointer(at).ok_or_else(bad)?,
            _ => return Err(bad()),
        };
        let usable = value.as_str().filter(|text| !text.trim().is_empty());
        let usable = usable.filter(|_| !reserved(value)).ok_or_else(bad)?;
        values.push((capture.key.to_owned(), usable.to_owned()));
    }
    Ok(values)
}

/// The frozen receiver input with the step's own captured identifiers. Core
/// requires it to equal the admission the isolated Core actually produced.
pub(crate) fn receiver_input(step: &Value, values: &[(String, String)]) -> Result<Value, Refusal> {
    let mut input = document(step, "nativeReceiverInputJson")?;
    for binding in list(step, "bindings")? {
        let key = text(binding, "key")?;
        if binding["source"] != CAPTURE || binding["side"] != INPUT {
            return Err(bad());
        }
        let (_, value) = values.iter().find(|(own, _)| *own == key).ok_or_else(bad)?;
        substitute(&mut input, binding, value)?;
    }
    Ok(input)
}

/// The recorded captures of a receiver observation equal the recomputed ones.
pub(crate) fn receiver_recorded(
    observation: &Value,
    values: &[(String, String)],
) -> Result<(), Refusal> {
    let supplied = list(observation, "captures")?;
    let present = observation.get("captures").is_some();
    if supplied.len() != values.len() || (present && supplied.is_empty()) {
        return Err(bad());
    }
    for (entry, (key, value)) in supplied.iter().zip(values) {
        if entry["key"] != key.as_str() || entry["value"] != value.as_str() {
            return Err(bad());
        }
    }
    Ok(())
}

/// The wire form of receiver captures for the step observation.
pub(crate) fn receiver_wire(values: &[(String, String)]) -> Option<Value> {
    (!values.is_empty()).then(|| {
        json!(values
            .iter()
            .map(|(key, value)| json!({"key":key,"value":value}))
            .collect::<Vec<_>>())
    })
}
