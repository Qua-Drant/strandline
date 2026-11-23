//! Fixed and removable drives with their capacity (read-only).

use crate::model::DriveInfo;
use sysinfo::Disks;

pub const GB: f64 = 1024.0 * 1024.0 * 1024.0;

pub fn system_drive() -> String {
    std::env::var("SystemDrive").ok().and_then(|s| s.chars().next()).map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_else(|| "C".into())
}

/// (letter, label, total GB, free GB, removable)
pub fn raw_drives() -> Vec<(String, String, f64, f64, bool)> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<(String, String, f64, f64, bool)> = Vec::new();
    for d in disks.list() {
        let mp = d.mount_point().to_string_lossy().to_string();
        let letter = match mp.chars().next() {
            Some(c) if c.is_ascii_alphabetic() && mp.len() <= 3 => c.to_ascii_uppercase().to_string(),
            _ => continue,
        };
        if d.total_space() == 0 || out.iter().any(|x| x.0 == letter) {
            continue;
        }
        let label = d.name().to_string_lossy().to_string();
        out.push((letter, label, d.total_space() as f64 / GB, d.available_space() as f64 / GB, d.is_removable()));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Drives for the sidebar. `free30` comes from stored history (`free` when unknown).
pub fn list(free30: impl Fn(&str) -> Option<f64>) -> Vec<DriveInfo> {
    let sys = system_drive();
    raw_drives()
        .into_iter()
        .map(|(id, label, total, free, removable)| {
            let name = if id == sys { "系统盘".to_string() } else if removable { "移动硬盘".to_string() } else if !label.trim().is_empty() { label } else { "本地磁盘".to_string() };
            let f30 = free30(&id).unwrap_or(free);
            DriveInfo { id, name, total, free, free30: f30 }
        })
        .collect()
}

pub fn drive_free_gb(letter: &str) -> Option<f64> {
    raw_drives().into_iter().find(|d| d.0.eq_ignore_ascii_case(letter)).map(|d| d.3)
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_the_system_drive() {
        let ds = super::list(|_| None);
        let sys = super::system_drive();
        let d = ds.iter().find(|d| d.id == sys).expect("system drive listed");
        assert!(d.total > 1.0 && d.free >= 0.0 && d.free <= d.total);
        assert_eq!(d.name, "系统盘");
    }
}
