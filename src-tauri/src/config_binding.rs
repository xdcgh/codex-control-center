use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf}};

pub fn choose_existing(profile:&Path,explicit:Option<&Path>)->Result<Option<PathBuf>,String>{
 if let Some(config)=explicit{if config.is_absolute()&&config.is_file(){return Ok(Some(config.to_path_buf()));}return Err("configured-file-unavailable".into());}
 let binding=profile.join("config-binding.json");
 if binding.is_file(){let saved:Value=serde_json::from_slice(&fs::read(binding).map_err(|_|"config-binding-unavailable")?).map_err(|_|"config-binding-invalid")?;let p=PathBuf::from(saved["config"].as_str().ok_or("config-binding-invalid")?);if p.is_absolute()&&p.is_file(){return Ok(Some(p));}return Err("Saved configuration is unavailable. Reconnect the original background owner configuration.".into());}
 if profile.join("binding-established").exists()||profile.join("owner/daemon.lock").exists()||profile.join("state/control-center.sqlite").exists(){return Err("The saved configuration binding is missing. Reconnect the original configuration; a second state will not be created.".into());}
 let default=profile.join("config.json");if default.is_file(){return Ok(Some(default));}Ok(None)
}
pub fn establish(profile:&Path,config:&Path)->Result<(),String>{
 fs::create_dir_all(profile).map_err(|_|"config-binding-directory-unavailable")?;
 // Write the permanent sentinel first: a crash can require reconnecting, never a silent fresh owner.
 fs::write(profile.join("binding-established"),"1\n").map_err(|_|"config-binding-save-failed")?;
 fs::write(profile.join("config-binding.json"),json!({"config":config}).to_string()).map_err(|_|"config-binding-save-failed")?;Ok(())
}
