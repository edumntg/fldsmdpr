use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, PtySession>>);

#[derive(Clone, serde::Serialize)]
struct PtyOutput {
    id: String,
    data: String, // base64 (terminal bytes may be partial UTF-8)
}

#[derive(Clone, serde::Serialize)]
struct PtyExit {
    id: String,
}

fn next_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    format!("pty-{}", COUNTER.fetch_add(1, Ordering::SeqCst))
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
    }
}

/// GUI apps get a minimal PATH, so bare program names (e.g. "claude") must be
/// resolved to a full path or the spawn fails in the packaged build.
fn resolve_program(program: &str) -> String {
    if program.contains('/') {
        return program.to_string();
    }
    if program == "claude" {
        if let Some(p) = crate::connectors::slack::claude_bin() {
            return p.display().to_string();
        }
    }
    if let Ok(out) = std::process::Command::new("which").arg(program).output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return p;
            }
        }
    }
    program.to_string()
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<PtyState>,
    cwd: Option<String>,
    program: Option<String>,
    args: Vec<String>,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(resolve_program(&program.unwrap_or_else(default_shell)));
    for a in &args {
        cmd.arg(a);
    }
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = next_id();

    // Stream output to the frontend on a dedicated thread; on exit, reap the
    // session (wait() the child so it doesn't linger as a zombie) and drop it.
    let app_out = app.clone();
    let id_out = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_out.emit(
                        "pty-output",
                        PtyOutput {
                            id: id_out.clone(),
                            data,
                        },
                    );
                }
            }
        }
        {
            use tauri::Manager;
            let state = app_out.state::<PtyState>();
            if let Some(mut s) = state.0.lock().ok().and_then(|mut m| m.remove(&id_out)) {
                let _ = s.child.wait();
            }
        }
        let _ = app_out.emit("pty-exit", PtyExit { id: id_out.clone() });
    });

    state.0.lock().unwrap().insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<PtyState>, id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(s) = map.get_mut(&id) {
        s.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, id: String, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(s) = state.0.lock().unwrap().get(&id) {
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<PtyState>, id: String) -> Result<(), String> {
    if let Some(mut s) = state.0.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
        let _ = s.child.wait(); // reap — otherwise it lingers as a zombie
    }
    Ok(())
}
