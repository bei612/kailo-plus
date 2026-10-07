use std::{fs, path::Path};

#[test]
fn adapter_pep_preserves_exact_native_resource_and_legacy_absence() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../contracts/samples/adapter-pep-resource.sample.json");
    let raw = fs::read_to_string(path).unwrap();
    let typed: Vec<contracts::AdapterPepCheckResponse> = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()
    );
}

#[test]
fn adapter_citations_preserve_typed_sources_and_empty_absence() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../contracts/samples/adapter-citations.sample.json");
    let raw = fs::read_to_string(path).unwrap();
    let typed: Vec<contracts::AdapterExecutionResponse> = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()
    );
}
