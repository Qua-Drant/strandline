//! Test helpers: every test works in a throwaway folder under `<repo>/sandbox/.tests`,
//! never in the system temp folder on C:.

use std::path::PathBuf;

pub fn tmp() -> tempfile::TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sandbox").join(".tests");
    std::fs::create_dir_all(&base).expect("create sandbox/.tests");
    // resolve `..` so paths look like real absolute paths (the guard rejects `..`)
    let base = crate::guard::dunce_canonical(&base).expect("canonical sandbox/.tests");
    tempfile::Builder::new().prefix("t").tempdir_in(base).expect("temp dir in sandbox")
}
