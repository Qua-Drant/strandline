//! `cargo run --bin sandbox-gen -- [folder]` — build a fake drive tree for safe testing
//! (default: ../sandbox next to src-tauri). Point Settings › 扫描范围 at it.

fn main() {
    let arg = std::env::args().nth(1);
    let root = match arg {
        Some(a) => std::path::PathBuf::from(a),
        None => std::env::current_dir().expect("cwd").join("..").join("sandbox"),
    };
    let root = std::path::absolute(&root).unwrap_or(root);
    match strandline_lib::sandbox::generate(&root) {
        Ok(g) => println!(
            "沙盒已生成：{}\n{} 个文件，逻辑大小 {:.1} GB（大文件为稀疏文件，几乎不占空间）\n在 设置 › 扫描范围 里填这个路径即可。",
            root.display(), g.files, g.logical_bytes as f64 / 1024f64.powi(3)
        ),
        Err(e) => {
            eprintln!("没有生成沙盒：{e}");
            std::process::exit(1);
        }
    }
}
