// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

static VOICE_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
static VOICE_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static VOICE_PID: Mutex<Option<u32>> = Mutex::new(None);
static CAPTURE_ACTIVE: Mutex<bool> = Mutex::new(false);

#[derive(Serialize)]
struct HealthStatus {
    ok: bool,
    status_code: Option<u16>,
    detail: String,
}

#[derive(Serialize)]
struct VoiceStatus {
    running: bool,
    detail: String,
}

#[derive(Serialize)]
struct VoiceFeed {
    lines: Vec<String>,
}

#[derive(Serialize)]
struct VoiceDevice {
    index: i32,
    name: String,
    is_input: bool,
    is_output: bool,
    is_default_input: bool,
    is_default_output: bool,
}

#[derive(Serialize)]
struct VoiceDeviceConfig {
    input_device: i32,
    output_device: i32,
}

#[derive(Serialize)]
struct ChatReply {
    text: String,
}

fn push_voice_log(line: String) {
    if let Ok(mut log) = VOICE_LOG.lock() {
        log.push(line);
        if log.len() > 200 {
            let keep = 200;
            let drop_count = log.len().saturating_sub(keep);
            log.drain(0..drop_count);
        }
    }
}

fn run_powershell(command: &str) -> Result<std::process::Output, String> {
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("powershell");

    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new("powershell.exe");

    cmd.arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(command)
        .output()
        .map_err(|e| format!("powershell exec failed: {e}"))
}

fn get_tracked_pid() -> Option<u32> {
    VOICE_PID.lock().ok().and_then(|g| *g)
}

fn set_tracked_pid(pid: Option<u32>) {
    if let Ok(mut g) = VOICE_PID.lock() {
        *g = pid;
    }
}

fn find_windows_voice_pid() -> Result<Option<u32>, String> {
    let script_name = voice_helper_script_name();
    let probe = format!(
        "Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{}*' }} | Select-Object -First 1 -ExpandProperty ProcessId",
        script_name
    );
    let out = run_powershell(&probe)?;
    if !out.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    let pid = raw
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok());
    Ok(pid)
}

fn ensure_voice_helper() -> Result<(), String> {
    let mut guard = VOICE_CHILD.lock().map_err(|_| "voice child mutex poisoned")?;

    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
        *guard = None;
    }
    let python_path = ps_single_quote(&voice_python_path());
    let script_path = ps_single_quote(&voice_helper_script_path());
    let helper_cmd = format!(
        "$py='{python}'; if (!(Test-Path $py)) {{ $py='python' }}; $script='{script}'; if (!(Test-Path $script)) {{ Write-Error 'helper script not found'; exit 2 }}; & $py $script",
        python = python_path,
        script = script_path,
    );
    #[cfg(target_os = "windows")]
    let mut proc = Command::new("powershell");
    #[cfg(not(target_os = "windows"))]
    let mut proc = Command::new("powershell.exe");

    let mut child = proc
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(helper_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start gui capture helper: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let t = line.trim();
                if !t.is_empty() {
                    push_voice_log(t.to_string());
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let t = line.trim();
                if !t.is_empty() {
                    push_voice_log(format!("[stderr] {t}"));
                }
            }
        });
    }

    *guard = Some(child);
    set_tracked_pid(find_windows_voice_pid()?);
    Ok(())
}

fn send_helper_command(cmd: &str) -> Result<(), String> {
    ensure_voice_helper()?;
    let mut guard = VOICE_CHILD.lock().map_err(|_| "voice child mutex poisoned")?;
    let child = guard.as_mut().ok_or("voice helper missing")?;
    let stdin = child.stdin.as_mut().ok_or("voice helper stdin unavailable")?;
    stdin
        .write_all(format!("{}\n", cmd).as_bytes())
        .map_err(|e| format!("helper stdin write failed: {e}"))?;
    stdin.flush().map_err(|e| format!("helper stdin flush failed: {e}"))?;
    Ok(())
}

fn is_capture_active() -> bool {
    CAPTURE_ACTIVE.lock().map(|v| *v).unwrap_or(false)
}

fn set_capture_active(v: bool) {
    if let Ok(mut s) = CAPTURE_ACTIVE.lock() {
        *s = v;
    }
}

fn ps_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn voice_helper_script_path() -> String {
    env::var("MK1_GUI_CAPTURE_SCRIPT")
        .unwrap_or_else(|_| "C:\\Users\\Admin\\mina-voice\\mina_windows_gui_capture.py".to_string())
}

fn voice_python_path() -> String {
    env::var("MK1_GUI_VOICE_PYTHON")
        .unwrap_or_else(|_| "C:\\Users\\Admin\\mina-voice\\.venv\\Scripts\\python.exe".to_string())
}

fn voice_helper_script_name() -> String {
    Path::new(&voice_helper_script_path())
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("mina_windows_gui_capture.py")
        .to_string()
}

#[tauri::command]
fn voice_list_devices() -> Result<Vec<VoiceDevice>, String> {
    // Use a temp Python file to avoid PowerShell quoting issues with inline -c payloads.
    let py = ps_single_quote(&voice_python_path());
    let script = format!(
        r#"
$py='{py}'
@'
import json
import sounddevice as sd

d = sd.query_devices()
de = sd.default.device
di = de[0] if de and de[0] is not None else -1
do = de[1] if de and de[1] is not None else -1

out = []
for i, x in enumerate(d):
    out.append(dict(
        index=i,
        name=x.get("name", "unknown"),
        is_input=int(x.get("max_input_channels", 0)) > 0,
        is_output=int(x.get("max_output_channels", 0)) > 0,
        is_default_input=(i == di),
        is_default_output=(i == do),
    ))

print(json.dumps(out))
'@ | & $py -
$ec=$LASTEXITCODE
exit $ec
"#,
        py = py
    );

    let out = run_powershell(&script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(format!("list devices failed: {err}; stdout={stdout}"));
    }

    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    let json_text = raw.trim();
    let value: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| format!("failed to parse device json: {e}; raw={json_text}"))?;

    let mut devices = Vec::new();
    if let Some(arr) = value.as_array() {
        for item in arr {
            let index = item.get("index").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let is_input = item
                .get("is_input")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_output = item
                .get("is_output")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_default_input = item
                .get("is_default_input")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_default_output = item
                .get("is_default_output")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            devices.push(VoiceDevice {
                index,
                name,
                is_input,
                is_output,
                is_default_input,
                is_default_output,
            });
        }
    }

    Ok(devices)
}

#[tauri::command]
fn voice_get_input_device() -> Result<VoiceDeviceConfig, String> {
    let script_path = ps_single_quote(&voice_helper_script_path());
    let script = format!(
        "$p='{path}'; $in=Select-String -Path $p -Pattern '^INPUT_DEVICE\\s*=\\s*(\\d+)' | Select-Object -First 1; $out=Select-String -Path $p -Pattern '^OUTPUT_DEVICE\\s*=\\s*(\\d+)' | Select-Object -First 1; $i=if($in){{$in.Matches[0].Groups[1].Value}}else{{'1'}}; $o=if($out){{$out.Matches[0].Groups[1].Value}}else{{'3'}}; Write-Output \"$i,$o\"",
        path = script_path,
    );
    let out = run_powershell(&script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("read input/output device failed: {err}"));
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut parts = text.split(',');
    let input_device = parts.next().unwrap_or("1").trim().parse::<i32>().unwrap_or(1);
    let output_device = parts.next().unwrap_or("3").trim().parse::<i32>().unwrap_or(3);
    Ok(VoiceDeviceConfig {
        input_device,
        output_device,
    })
}

#[tauri::command]
fn voice_set_input_device(input_device: i32, output_device: Option<i32>) -> Result<VoiceDeviceConfig, String> {
    let out_dev = output_device.unwrap_or(3);
    let script_path = ps_single_quote(&voice_helper_script_path());
    let script = format!(
        "$p='{path}'; $c=Get-Content $p -Raw; $c=$c -replace 'INPUT_DEVICE\\s*=\\s*\\d+', 'INPUT_DEVICE = {}'; if($c -match 'OUTPUT_DEVICE\\s*=\\s*\\d+'){{$c=$c -replace 'OUTPUT_DEVICE\\s*=\\s*\\d+', 'OUTPUT_DEVICE = {}'}} else {{$c=$c + \"`nOUTPUT_DEVICE = {}\"}}; Set-Content $p $c",
        input_device,
        out_dev,
        out_dev,
        path = script_path,
    );
    let out = run_powershell(&script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("set input/output device failed: {err}"));
    }
    push_voice_log(format!("[system] input/output set to {}/{}", input_device, out_dev));
    Ok(VoiceDeviceConfig {
        input_device,
        output_device: out_dev,
    })
}

#[tauri::command]
async fn gui_chat_send(
    message: String,
    _agent_id: Option<String>,
    _haven_session_id: Option<String>
) -> Result<ChatReply, String> {

    let client = reqwest::Client::new();

    let payload = serde_json::json!({
        "message": message
    });

    let resp = client
        .post("http://127.0.0.1:8000/chat")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("chat http error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("chat http status {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("chat json parse failed: {e}"))?;

    let reply = json
        .get("reply")
        .and_then(|v| v.as_str())
        .unwrap_or("(no reply)")
        .to_string();

    Ok(ChatReply { text: reply })
}

#[tauri::command]
fn ping_http(url: String) -> Result<HealthStatus, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("client init failed: {e}"))?;

    let response = client.get(&url).send();
    match response {
        Ok(resp) => {
            let code = resp.status().as_u16();
            let ok = resp.status().is_success();
            Ok(HealthStatus {
                ok,
                status_code: Some(code),
                detail: if ok {
                    "reachable".into()
                } else {
                    format!("http {code}")
                },
            })
        }
        Err(e) => Ok(HealthStatus {
            ok: false,
            status_code: None,
            detail: e.to_string(),
        }),
    }
}

#[tauri::command]
fn voice_start() -> Result<VoiceStatus, String> {
    if let Ok(mut log) = VOICE_LOG.lock() {
        if log.is_empty() {
            log.push("[system] voice controls loaded".into());
        }
    }

    ensure_voice_helper()?;
    if is_capture_active() {
        let pid = find_windows_voice_pid()?;
        return Ok(VoiceStatus {
            running: true,
            detail: format!("already capturing (pid: {:?})", pid),
        });
    }

    send_helper_command("start")?;
    set_capture_active(true);
    let pid = find_windows_voice_pid()?;
    set_tracked_pid(pid);
    push_voice_log("[system] capture started".into());

    Ok(VoiceStatus {
        running: true,
        detail: format!("capturing (pid: {:?})", pid),
    })
}

#[tauri::command]
fn voice_stop() -> Result<VoiceStatus, String> {
    ensure_voice_helper()?;
    if !is_capture_active() {
        return Ok(VoiceStatus {
            running: true,
            detail: "not capturing; press Start Capture first".into(),
        });
    }

    send_helper_command("stop")?;
    set_capture_active(false);
    push_voice_log("[system] capture stopped; processing".into());

    Ok(VoiceStatus {
        running: true,
        detail: "processing turn (transcribe/reply)".into(),
    })
}

#[tauri::command]
fn voice_restart() -> Result<VoiceStatus, String> {
    let mut guard = VOICE_CHILD.lock().map_err(|_| "voice child mutex poisoned")?;
    if let Some(mut child) = guard.take() {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(b"quit\n");
            let _ = stdin.flush();
        }
        let _ = child.kill();
        let _ = child.wait();
        set_tracked_pid(None);
        set_capture_active(false);
        push_voice_log("[system] helper restarted: stopped".into());
        return Ok(VoiceStatus {
            running: false,
            detail: "restart toggle: stopped (press again to start)".into(),
        });
    }

    drop(guard);
    ensure_voice_helper()?;
    let pid = find_windows_voice_pid()?;
    set_tracked_pid(pid);
    push_voice_log("[system] helper restarted: ready".into());
    Ok(VoiceStatus {
        running: true,
        detail: format!("helper ready (pid: {:?})", pid),
    })
}

#[tauri::command]
fn voice_status() -> Result<VoiceStatus, String> {
    let mut running = false;
    {
        let mut guard = VOICE_CHILD.lock().map_err(|_| "voice child mutex poisoned")?;
        if let Some(child) = guard.as_mut() {
            running = child.try_wait().map_err(|e| e.to_string())?.is_none();
            if !running {
                *guard = None;
            }
        }
    }

    let pid = if running {
        match get_tracked_pid() {
            Some(p) => Some(p),
            None => {
                let discovered = find_windows_voice_pid()?;
                set_tracked_pid(discovered);
                discovered
            }
        }
    } else {
        set_tracked_pid(None);
        None
    };

    Ok(VoiceStatus {
        running,
        detail: if running {
            let phase = if is_capture_active() { "capturing" } else { "ready" };
            format!("voice helper {} (pid: {:?})", phase, pid)
        } else {
            set_capture_active(false);
            "voice helper stopped".into()
        },
    })
}

#[tauri::command]
fn voice_feed() -> Result<VoiceFeed, String> {
    let log = VOICE_LOG.lock().map_err(|_| "voice log mutex poisoned")?;
    Ok(VoiceFeed { lines: log.clone() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ping_http,
            gui_chat_send,
            voice_start,
            voice_stop,
            voice_restart,
            voice_status,
            voice_feed,
            voice_list_devices,
            voice_get_input_device,
            voice_set_input_device
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

