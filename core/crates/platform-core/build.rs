//! DD-105: compile the same ExtMcp wire protocol as the pinned Gateway.
//! Source: agentgateway 1f7ebbf87cbdbe9517f6f181221879d04dc50692,
//! crates/protos/proto/ext_mcp.proto. No independent protocol copy or protoc.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let directory = root.join("../../../model-gateway/crates/protos/proto");
    let source = directory.join("ext_mcp.proto");
    let descriptors = protox::compile([&source], [&directory])?;
    let mut config = prost_build::Config::new();
    config.extern_path(".google.protobuf.Value", "::prost_wkt_types::Value");
    config.extern_path(".google.protobuf.Struct", "::prost_wkt_types::Struct");
    tonic_prost_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_fds_with_config(descriptors, config)?;
    println!("cargo:rerun-if-changed={}", source.display());
    Ok(())
}
