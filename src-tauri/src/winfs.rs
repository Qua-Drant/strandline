//! Windows file-system facts the scanner and every reader must respect.
//!
//! * Cloud placeholders (OneDrive, iCloud, Dropbox "online-only" files) carry
//!   `FILE_ATTRIBUTE_OFFLINE`, `FILE_ATTRIBUTE_RECALL_ON_OPEN` or `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`.
//!   Their bytes are not on this disk, and opening / reading them makes Windows download them.
//!   Attributes come from the directory listing, so checking them never triggers a download.
//! * Hard links: the same file reached through several paths. Identified by (volume serial, file
//!   index); opening with attribute-only access does not read or download anything.

use std::path::Path;

pub const ATTR_OFFLINE: u32 = 0x0000_1000;
pub const ATTR_RECALL_ON_OPEN: u32 = 0x0004_0000;
pub const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
pub const ATTR_REPARSE_POINT: u32 = 0x0000_0400;
pub const ATTR_SPARSE: u32 = 0x0000_0200;

/// True for files whose content lives in the cloud (reading them would download them).
pub fn is_cloud_attrs(attrs: u32) -> bool {
    attrs & (ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS) != 0
}

pub fn attrs(p: &Path) -> u32 {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        std::fs::symlink_metadata(p).map(|m| m.file_attributes()).unwrap_or(0)
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        0
    }
}

/// Never read a file for which this is true.
pub fn is_cloud(p: &Path) -> bool {
    is_cloud_attrs(attrs(p))
}

/// (volume serial, file index, link count) without reading the file.
pub fn file_id(p: &Path) -> Option<(u32, u64, u32)> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT};
        const FILE_READ_ATTRIBUTES: u32 = 0x80;
        let f = std::fs::OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(0x7)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(p)
            .ok()?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(f.as_raw_handle() as _, &mut info) } == 0 {
            return None;
        }
        Some((info.dwVolumeSerialNumber, ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64, info.nNumberOfLinks))
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        None
    }
}

/// Mark a file offline (tests: stands in for a cloud placeholder; the content stays local).
#[cfg(windows)]
pub fn set_offline(p: &Path) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::SetFileAttributesW;
    let w: Vec<u16> = p.as_os_str().to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
    let a = attrs(p) | ATTR_OFFLINE;
    if unsafe { SetFileAttributesW(w.as_ptr(), a) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
