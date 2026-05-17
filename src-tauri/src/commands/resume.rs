use std::path::Path;

pub fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("INVALID_SESSION_ID".into());
    }
    let all_ok = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !all_ok {
        return Err("INVALID_SESSION_ID".into());
    }
    Ok(())
}

pub fn escape_powershell_single_quoted(s: &str) -> String {
    s.replace('\'', "''")
}

#[tauri::command]
pub fn resume_claude_session(project_path: String, session_id: String) -> Result<(), String> {
    validate_session_id(&session_id)?;

    let path = Path::new(&project_path);
    if !path.is_dir() {
        return Err("PATH_NOT_FOUND".into());
    }

    launch_claude_in_powershell(&project_path, &session_id)
}

#[cfg(target_os = "windows")]
fn launch_claude_in_powershell(project_path: &str, session_id: &str) -> Result<(), String> {
    use std::process::Command;
    let escaped = escape_powershell_single_quoted(project_path);
    let ps_command = format!("Set-Location -LiteralPath '{escaped}'; claude --resume {session_id}");
    Command::new("cmd")
        .args([
            "/c",
            "start",
            "powershell",
            "-NoExit",
            "-Command",
            &ps_command,
        ])
        .spawn()
        .map_err(|e| format!("SPAWN_FAILED:{e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_claude_in_powershell(_project_path: &str, _session_id: &str) -> Result<(), String> {
    Err("UNSUPPORTED_PLATFORM".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_session_id_accepts_alphanum_and_dash() {
        assert!(validate_session_id("8a1f2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c").is_ok());
        assert!(validate_session_id("abc123").is_ok());
        assert!(validate_session_id("a_b-c").is_ok());
    }

    #[test]
    fn validate_session_id_rejects_injection_attempts() {
        for bad in &[
            "",
            " ",
            "abc; rm -rf /",
            "../../etc",
            "id with space",
            "id&calc",
        ] {
            assert!(validate_session_id(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn escape_powershell_single_quoted_doubles_single_quotes() {
        assert_eq!(escape_powershell_single_quoted("abc"), "abc");
        assert_eq!(escape_powershell_single_quoted("a'b"), "a''b");
        assert_eq!(escape_powershell_single_quoted("'"), "''");
    }

    #[test]
    fn resume_rejects_nonexistent_path() {
        let r = resume_claude_session(
            "Z:\\definitely-does-not-exist-12345".into(),
            "abc123".into(),
        );
        assert_eq!(r.unwrap_err(), "PATH_NOT_FOUND");
    }

    #[test]
    fn resume_rejects_invalid_session_id() {
        let cwd = std::env::current_dir().unwrap();
        let r = resume_claude_session(cwd.to_string_lossy().into_owned(), "bad; id".into());
        assert_eq!(r.unwrap_err(), "INVALID_SESSION_ID");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn resume_rejects_non_windows() {
        let cwd = std::env::current_dir().unwrap();
        let r = resume_claude_session(cwd.to_string_lossy().into_owned(), "abc123".into());
        assert_eq!(r.unwrap_err(), "UNSUPPORTED_PLATFORM");
    }
}
