#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_notification::NotificationExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
mod pipe_helper;
mod config_binding;

struct Service { config: PathBuf, preferences: Mutex<Value>, preferences_file: PathBuf }

fn core_assets(app:&tauri::AppHandle)->Result<(PathBuf,PathBuf),String>{
 let resources=app.path().resource_dir().map_err(|_|"resources-unavailable")?;let mut node=resources.join("node.exe");let mut source=resources.join("core/src");
 #[cfg(debug_assertions)] {if !node.is_file(){node=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.packaged/node.exe");source=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src");}}
 Ok((node,source))
}
fn owner_anchor(app:&tauri::AppHandle)->Result<PathBuf,String>{
 let (node,source)=core_assets(app)?;let mut command=std::process::Command::new(node);command.arg("--disable-warning=ExperimentalWarning").arg(source.join("core/ownership.mjs")).arg("--print-anchor");
 #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 let output=command.stderr(std::process::Stdio::null()).output().map_err(|_|"owner-anchor-unavailable")?;
 let value:Value=serde_json::from_slice(&output.stdout).map_err(|_|"owner-anchor-response-invalid")?;
 if !output.status.success(){return Err(value["error"].as_str().unwrap_or("owner-anchor-unavailable").to_string());}
 Ok(PathBuf::from(value["anchor"].as_str().ok_or("owner-anchor-invalid")?))
}

fn discover_config(app: &tauri::AppHandle) -> Result<PathBuf,String> {
    let anchor=owner_anchor(app)?;let profile=anchor.parent().ok_or("owner-profile-unavailable")?.to_path_buf();
    let explicit=std::env::var("CODEX_CONTROL_CENTER_CONFIG").ok().map(PathBuf::from);
    if let Some(config)=config_binding::choose_existing(&profile,explicit.as_deref())?{config_binding::establish(&profile,&config)?;return Ok(config);}
    let local=profile.join("config.json");
    if local.is_file(){return Ok(local);}
    #[cfg(debug_assertions)] { let dev=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime/config.json");if dev.is_file(){let dev=fs::canonicalize(dev).map_err(|_|"configuration-canonical-path-unavailable")?;config_binding::establish(&profile,&dev)?;return Ok(dev);} }
    let resources=app.path().resource_dir().map_err(|_|"resources-unavailable")?;
    let mut command=std::process::Command::new(resources.join("node.exe"));
    command.args([resources.join("core/scripts/discover-config.mjs").to_string_lossy().as_ref(),local.to_string_lossy().as_ref()]);
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    if command.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map_err(|_|"configuration-discovery-failed")?.success(){config_binding::establish(&profile,&local)?;Ok(local)}else{Err("Open Codex Desktop and sign in, then restart.".into())}
}

fn config_value(service:&Service)->Result<Value,String>{serde_json::from_slice(&fs::read(&service.config).map_err(|_|"configuration-unavailable")?).map_err(|_|"configuration-invalid".into())}

async fn request(service:&Service,method:&str,params:Value)->Result<Value,String>{
    let config=config_value(service)?;
    let descriptor=PathBuf::from(config["stateDirectory"].as_str().ok_or("state-directory-missing")?).join("broker/owner.json");
    let value:Value=serde_json::from_slice(&fs::read(descriptor).map_err(|_|"Background service is not connected.")?).map_err(|_|"owner-descriptor-invalid")?;
    let pipe=value["pipe"].as_str().ok_or("owner-pipe-missing")?;
    if !pipe.starts_with("\\\\.\\pipe\\codex-control-center-"){return Err("non-local-pipe-rejected".into());}
    let token=value["token"].as_str().ok_or("owner-authentication-unavailable")?;
    #[cfg(windows)] {
      let client=tokio::net::windows::named_pipe::ClientOptions::new().open(pipe).map_err(|_|"Background service is unavailable.")?;
      let (read,mut write)=tokio::io::split(client);let mut reader=BufReader::new(read);
      let authentication=json!({"id":0,"method":"authenticate","params":{"token":token}}).to_string()+"\n";
      write.write_all(authentication.as_bytes()).await.map_err(|_|"broker-authentication-write-failed")?;
      let mut line=String::new();tokio::time::timeout(Duration::from_secs(10),reader.read_line(&mut line)).await.map_err(|_|"broker-authentication-timeout")?.map_err(|_|"broker-authentication-read-failed")?;
      let auth:Value=serde_json::from_str(&line).map_err(|_|"broker-response-invalid")?;
      if auth["result"]["authenticated"]!=true{return Err("broker-authentication-rejected".into());}
      let message=json!({"id":1,"method":method,"params":params}).to_string()+"\n";
      if message.len()>65536{return Err("request-too-large".into());}
      write.write_all(message.as_bytes()).await.map_err(|_|"broker-write-failed")?;line.clear();
      tokio::time::timeout(Duration::from_secs(40),reader.read_line(&mut line)).await.map_err(|_|"broker-request-timeout")?.map_err(|_|"broker-read-failed")?;
      if line.len()>16*1024*1024{return Err("broker-response-too-large".into());}
      let response:Value=serde_json::from_str(&line).map_err(|_|"broker-response-invalid")?;
      if let Some(error)=response.get("error"){return Err(error["message"].as_str().unwrap_or("request-failed").to_string());}
      Ok(response["result"].clone())
    }
    #[cfg(not(windows))] {let _=(token,method,params);Err("Windows is required.".into())}
}

async fn ensure_owner(app:&tauri::AppHandle)->Result<(),String>{
    let service=app.state::<Service>();
    if request(&service,"snapshot",json!({})).await.is_ok(){return Ok(());}
    let config=config_value(&service)?;
    if let Some(legacy)=config["legacyStateDirectory"].as_str(){
        let control:Value=serde_json::from_slice(&fs::read(PathBuf::from(legacy).join("control.json")).map_err(|_|"Legacy handover status is unavailable.")?).map_err(|_|"Legacy handover status is invalid.")?;
        if control["enabled"]!=false{return Err("The legacy watchdog is still enabled. Finish the safe owner handover before starting this service.".into());}
    }
    let state=PathBuf::from(config["stateDirectory"].as_str().ok_or("state-directory-missing")?);
    let owner=owner_anchor(app)?.join("daemon.lock");
    if owner.exists()||state.join("daemon.lock").exists(){return Err("The existing background owner is starting or unavailable. A second service was not started.".into());}
    let resources=app.path().resource_dir().map_err(|_|"resources-unavailable")?;
    let mut node=resources.join("node.exe");let mut source=resources.join("core/src/core-cli.mjs");
    #[cfg(debug_assertions)] {if !node.is_file(){node=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.packaged/node.exe");source=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/core-cli.mjs");}}
    let mut command=std::process::Command::new(node);
    command.env("CODEX_CONTROL_CENTER_BROKER_HELPER",std::env::current_exe().map_err(|_|"broker-helper-unavailable")?);
    command.arg("--disable-warning=ExperimentalWarning").arg(source).arg("run").arg("--config").arg(&service.config);
    if config["ownerHandoverAcknowledged"]==true || config["installationMode"]=="fresh" {command.arg("--execute");}
    command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    command.spawn().map_err(|_|"Background service could not be started.")?;
    for _ in 0..40{tokio::time::sleep(Duration::from_millis(250)).await;if request(&service,"snapshot",json!({})).await.is_ok(){return Ok(());}}
    Err("Background service has not become ready.".into())
}

#[tauri::command]
async fn core_request(app:tauri::AppHandle,method:String,params:Option<Value>)->Result<Value,String>{request(&app.state::<Service>(),&method,params.unwrap_or(json!({}))).await}

#[tauri::command]
fn ui_preferences(app:tauri::AppHandle,update:Option<Value>)->Result<Value,String>{
 let service=app.state::<Service>();let mut prefs=service.preferences.lock().map_err(|_|"preferences-lock-failed")?;
 if let Some(value)=update {let object=value.as_object().ok_or("invalid-preferences")?;let current=prefs.as_object_mut().ok_or("invalid-preferences")?;for(key,value)in object{if !["theme","privacy","widgetExpanded","widgetLocked","widgetOpacity","widgetPinned","notifications","widgetVisible"].contains(&key.as_str()){return Err("unknown-preference".into());}current.insert(key.clone(),value.clone());}
 fs::create_dir_all(service.preferences_file.parent().ok_or("preferences-parent-missing")?).map_err(|_|"preferences-save-failed")?;
 fs::write(&service.preferences_file,serde_json::to_vec_pretty(&*prefs).map_err(|_|"preferences-invalid")?).map_err(|_|"preferences-save-failed")?;
 if let Some(window)=app.get_webview_window("widget"){let _=window.set_always_on_top(prefs["widgetPinned"].as_bool().unwrap_or(true));}
 let _=app.emit("preferences/updated",prefs.clone()); }
 Ok(prefs.clone())
}

#[tauri::command]
fn show_window(app:tauri::AppHandle,label:String)->Result<(),String>{let window=app.get_webview_window(&label).ok_or("window-unavailable")?;window.show().map_err(|_|"window-show-failed")?;let _=window.set_focus();Ok(())}

#[tauri::command]
fn set_autostart(app:tauri::AppHandle,enabled:bool)->Result<bool,String>{if enabled{app.autolaunch().enable()}else{app.autolaunch().disable()}.map_err(|_|"autostart-update-failed")?;app.autolaunch().is_enabled().map_err(|_|"autostart-status-failed".into())}

#[tauri::command]
fn get_autostart(app:tauri::AppHandle)->Result<bool,String>{app.autolaunch().is_enabled().map_err(|_|"autostart-status-failed".into())}

#[tauri::command]
fn save_diagnostics(app:tauri::AppHandle,value:Value)->Result<String,String>{
 let service=app.state::<Service>();let destination=service.preferences_file.parent().ok_or("diagnostics-directory-missing")?.join("diagnostics-redacted.json");
 fs::write(&destination,serde_json::to_vec_pretty(&value).map_err(|_|"diagnostics-invalid")?).map_err(|_|"diagnostics-save-failed")?;
 Ok(destination.to_string_lossy().into_owned())
}

fn show(app:&tauri::AppHandle,label:&str,page:Option<&str>){if let Some(window)=app.get_webview_window(label){let _=window.show();let _=window.set_focus();if let Some(page)=page{let _=window.emit("navigate",page);}}}

fn tray(app:&tauri::AppHandle)->Result<(),Box<dyn std::error::Error>>{
 let quota5=MenuItem::with_id(app,"quota5","5h: unavailable",false,None::<&str>)?;
 let quota7=MenuItem::with_id(app,"quota7","7d: unavailable",false,None::<&str>)?;
 let running=MenuItem::with_id(app,"running","Running: unavailable",false,None::<&str>)?;
 let items:Vec<MenuItem<tauri::Wry>>=vec![quota5.clone(),quota7.clone(),running.clone(),
   MenuItem::with_id(app,"dashboard","Open Dashboard",true,None::<&str>)?,MenuItem::with_id(app,"threads","Open Threads",true,None::<&str>)?,MenuItem::with_id(app,"widget","Show Widget",true,None::<&str>)?,MenuItem::with_id(app,"refresh","Refresh",true,None::<&str>)?,MenuItem::with_id(app,"pause","Pause Auto Resume",true,None::<&str>)?,MenuItem::with_id(app,"resume","Resume Eligible Tasks",true,None::<&str>)?,MenuItem::with_id(app,"autostart","Start with Windows",true,None::<&str>)?,MenuItem::with_id(app,"doctor","Diagnostics",true,None::<&str>)?,MenuItem::with_id(app,"exit-ui","Exit UI (keep background service)",true,None::<&str>)?,MenuItem::with_id(app,"exit-all","Exit UI and background service",true,None::<&str>)?];
 let references:Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>>=items.iter().map(|i|i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
 let menu=Menu::with_items(app,&references)?;
 TrayIconBuilder::with_id("main-tray").icon(app.default_window_icon().ok_or("default-icon-missing")?.clone()).menu(&menu).show_menu_on_left_click(false)
 .on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}){show(tray.app_handle(),"compact",None);}})
 .on_menu_event(|app,event|{let id=event.id.as_ref();match id{
  "dashboard"=>show(app,"main",Some("Dashboard")),"threads"=>show(app,"main",Some("Threads")),"widget"=>show(app,"widget",None),"doctor"=>show(app,"main",Some("Diagnostics")),
  "autostart"=>{let manager=app.autolaunch();if manager.is_enabled().unwrap_or(false){let _=manager.disable();}else{let _=manager.enable();}},"exit-ui"=>app.exit(0),
  "refresh"|"pause"|"resume"|"exit-all"=>{let handle=app.clone();let id=id.to_string();tauri::async_runtime::spawn(async move{let service=handle.state::<Service>();match id.as_str(){"refresh"=>{let _=request(&service,"refresh",json!({})).await;},"pause"=>{let _=request(&service,"settings/update",json!({"autoResume":false})).await;},"resume"=>{let _=request(&service,"settings/update",json!({"autoResume":true})).await;let _=request(&service,"refresh",json!({})).await;},"exit-all"=>{let _=request(&service,"shutdown",json!({})).await;handle.exit(0);},_=>{}}});},_=>{}}}).build(app)?;
 let handle=app.clone();tauri::async_runtime::spawn(async move{
  let mut previous:Option<Value>=None;
  loop{
   let result=request(&handle.state::<Service>(),"snapshot",json!({})).await;
   match result{
    Ok(value)=>{
     let windows=value["quota"]["windows"].as_array();
     for(duration,item,label)in [(300,&quota5,"5h"),(10080,&quota7,"7d")]{let text=windows.and_then(|ws|ws.iter().find(|w|w["durationMinutes"]==duration)).and_then(|w|w["remainingPercent"].as_f64()).map(|left|format!("{label}: {left:.0}% remaining")).unwrap_or(format!("{label}: unavailable"));let _=item.set_text(text);}
     let tasks=value["tasks"].as_array();let working=tasks.map(|t|t.iter().filter(|t|t["phase"]=="watching"&&t["reason"]=="running").count()).unwrap_or(0);let waiting=tasks.map(|t|t.iter().filter(|t|t["phase"]=="waitingQuota").count()).unwrap_or(0);let _=running.set_text(format!("Running: {working} · Waiting quota: {waiting}"));
     let _=handle.emit("core/snapshot",&value);
     let notify=handle.state::<Service>().preferences.lock().map(|p|p["notifications"].as_bool().unwrap_or(true)).unwrap_or(false);
     if notify {if let Some(old)=&previous {
       if old["quota"]["ready"]==false&&value["quota"]["ready"]==true{let _=handle.notification().builder().title("Codex quota recovered").body("All blocking quota windows are available.").show();}
       if old["quota"]["ready"]==true&&value["quota"]["ready"]==false&&value["quota"]["known"]==true{let _=handle.notification().builder().title("Codex quota exhausted").body("Eligible tasks will wait for real quota recovery.").show();}
       if old["compatibility"]["verified"]==true&&value["compatibility"]["verified"]==false{let _=handle.notification().builder().title("Codex compatibility not verified").body("Automatic recovery is in safe mode.").show();}
     }}previous=Some(value);
    },Err(reason)=>{let _=handle.emit("core/disconnected",json!({"reason":reason}));}
   }
   tokio::time::sleep(Duration::from_secs(2)).await;
  }
 });Ok(())
}

fn main(){
 if std::env::args().any(|arg|arg=="--pipe-broker-helper"){pipe_helper::run();return;}
 #[cfg(debug_assertions)] {let args:Vec<String>=std::env::args().collect();if let Some(index)=args.iter().position(|arg|arg=="--probe-config-binding"){let profile=PathBuf::from(args.get(index+1).expect("test-profile-required"));match config_binding::choose_existing(&profile,None){Ok(selected)=>println!("{}",json!({"selected":selected})),Err(error)=>{println!("{}",json!({"error":error}));std::process::exit(1);}}return;}}
 tauri::Builder::default()
 .plugin(tauri_plugin_single_instance::init(|app,_,_|{show(app,"main",None);}))
 .plugin(tauri_plugin_autostart::Builder::new().args(["--background"]).build())
 .plugin(tauri_plugin_notification::init())
 .plugin(tauri_plugin_window_state::Builder::default().build())
 .invoke_handler(tauri::generate_handler![core_request,ui_preferences,show_window,set_autostart,get_autostart,save_diagnostics])
 .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=window.hide();}})
 .setup(|app|{
    let handle=app.handle().clone();let config=discover_config(&handle)?;let preferences_file=app.path().app_local_data_dir()?.join("ui-settings.json");
    let preferences=fs::read(&preferences_file).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or(json!({"theme":"dark","privacy":false,"widgetExpanded":false,"widgetLocked":false,"widgetOpacity":0.95,"widgetPinned":true,"notifications":true,"widgetVisible":false}));
    app.manage(Service{config,preferences:Mutex::new(preferences),preferences_file});
    if std::env::args().any(|arg|arg=="--enable-autostart"){let _=app.autolaunch().enable();}
    if std::env::args().any(|arg|arg=="--background"){if let Some(window)=app.get_webview_window("main"){let _=window.hide();}}
    tray(&handle)?;
    tauri::async_runtime::spawn(async move{if let Err(reason)=ensure_owner(&handle).await{let _=handle.emit("core/disconnected",json!({"reason":reason}));}});
    Ok(())
 }).run(tauri::generate_context!()).expect("Codex Control Center could not start");
}
