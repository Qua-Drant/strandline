//! Small date helpers (local time from the Windows time-zone bias; no extra crates).

use crate::store::now_ms;

/// Local UTC offset in seconds.
pub fn local_offset_secs() -> i64 {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
        let mut tz: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
        let r = unsafe { GetTimeZoneInformation(&mut tz) };
        let bias = tz.Bias + if r == 2 { tz.DaylightBias } else { tz.StandardBias };
        -(bias as i64) * 60
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// Days since 1970-01-01 → (year, month, day).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn local_day(ms: i64) -> i64 {
    (ms / 1000 + local_offset_secs()).div_euclid(86_400)
}

pub fn hhmm(ms: i64) -> String {
    let secs = ms / 1000 + local_offset_secs();
    format!("{:02}:{:02}", (secs / 3600).rem_euclid(24), (secs / 60).rem_euclid(60))
}

pub fn ymd(ms: i64) -> String {
    let (y, m, d) = civil_from_days(local_day(ms));
    format!("{y}-{m:02}-{d:02}")
}

/// "今天 / 昨天 / 11 月 3 日"
pub fn day_label(ms: i64) -> String {
    match local_day(now_ms()) - local_day(ms) {
        0 => "今天".into(),
        1 => "昨天".into(),
        _ => {
            let (_, m, d) = civil_from_days(local_day(ms));
            format!("{m} 月 {d} 日")
        }
    }
}

/// Whole days since `ms` (0 for the future / unknown).
pub fn days_since(ms: i64) -> u32 {
    if ms <= 0 { return 0; }
    ((now_ms() - ms).max(0) / 86_400_000) as u32
}

/// "今天 / 昨天 / 12 天前 / 3 个月前 / 1 年前" — the format the large-file page parses.
pub fn ago(ms: i64) -> String {
    if ms <= 0 { return "—".into(); }
    match days_since(ms) {
        0 => "今天".into(),
        1 => "昨天".into(),
        d if d < 30 => format!("{d} 天前"),
        d if d < 365 => format!("{} 个月前", d / 30),
        d => format!("{} 年前", d / 365),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn calendar() {
        assert_eq!(super::civil_from_days(0), (1970, 1, 1));
        assert_eq!(super::civil_from_days(20_412), (2025, 11, 20));
    }
}
