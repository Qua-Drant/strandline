//! Path helpers: %VAR% expansion, user folders, and display forms that hide the user name.

use std::path::{Path, PathBuf};

/// Expand `%NAME%` environment variables (Windows style). Unknown names are left as they are.
pub fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => {
                let name = &after[..j];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => { out.push('%'); out.push_str(name); out.push('%'); }
                }
                rest = &after[j + 1..];
            }
            None => { out.push('%'); rest = after; }
        }
    }
    out.push_str(rest);
    out
}

/// Show a path the way the UI does: %LOCALAPPDATA%, %APPDATA%, %USERPROFILE% instead of the real folders.
pub fn display(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    for var in ["LOCALAPPDATA", "APPDATA", "TEMP", "USERPROFILE"] {
        if let Ok(v) = std::env::var(var)
            && !v.is_empty() && starts_with_ci(&s, &v) {
                return format!("%{var}%{}", &s[v.len()..]);
            }
    }
    s
}

pub fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s.is_char_boundary(prefix.len()) && s[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Is `p` inside (or equal to) `root`? Case-insensitive, component-wise.
pub fn is_within(p: &Path, root: &Path) -> bool {
    let a: Vec<String> = p.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect();
    let b: Vec<String> = root.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect();
    a.len() >= b.len() && a[..b.len()] == b[..]
}

/// Split "C:\a\b\name" into ("C:\a\b\", "name") for the path chips in the UI.
pub fn head_tail(p: &Path) -> (String, String) {
    let d = display(p);
    match d.rfind('\\') {
        Some(i) if i + 1 < d.len() => (d[..=i].to_string(), d[i + 1..].to_string()),
        _ => (String::new(), d),
    }
}

/// Well-known user folders by their Chinese UI names (used by rules).
pub fn user_folder(name: &str) -> Option<PathBuf> {
    match name.trim() {
        "下载" => dirs::download_dir(),
        "桌面" => dirs::desktop_dir(),
        "文稿" | "文档" => dirs::document_dir(),
        "图片" => dirs::picture_dir(),
        "视频" => dirs::video_dir(),
        "音乐" => dirs::audio_dir(),
        "微信收到的文件" => dirs::document_dir().map(|d| d.join("WeChat Files")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_and_displays() {
        let up = std::env::var("USERPROFILE").unwrap();
        assert_eq!(expand_env("%USERPROFILE%\\x"), format!("{up}\\x"));
        assert_eq!(expand_env("%NOPE_NOT_SET%\\x"), "%NOPE_NOT_SET%\\x");
        assert_eq!(display(Path::new(&format!("{up}\\Downloads"))), "%USERPROFILE%\\Downloads");
    }

    #[test]
    fn within_is_case_insensitive_and_component_wise() {
        assert!(is_within(Path::new("C:\\Windows\\System32"), Path::new("c:\\windows")));
        assert!(!is_within(Path::new("C:\\WindowsApps"), Path::new("C:\\Windows")));
    }
}
