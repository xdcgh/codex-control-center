//! Presentation language is independent of protocol IDs and diagnostic codes.
use serde_json::Value;
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum Locale { ZhCn, En }
impl Locale {pub fn code(self)->&'static str {match self{Self::ZhCn=>"zh-CN",Self::En=>"en"}}}
pub fn resolve(language:Option<&str>,system:Option<&str>)->Locale {match language{Some("zh-CN")=>Locale::ZhCn,Some("en")=>Locale::En,_=>if system.unwrap_or("en").split('-').next().unwrap_or("").eq_ignore_ascii_case("zh"){Locale::ZhCn}else{Locale::En}}}
pub fn system_locale()->Option<String>{
 #[cfg(windows)] {
  #[link(name="kernel32")]extern "system"{fn GetUserDefaultUILanguage()->u16;fn LCIDToLocaleName(locale:u32,name:*mut u16,count:i32,flags:u32)->i32;}
  let mut name=[0u16;85];let count=unsafe{LCIDToLocaleName(GetUserDefaultUILanguage() as u32,name.as_mut_ptr(),name.len() as i32,0)};
  if count>1{return String::from_utf16(&name[..count as usize-1]).ok();}None
 }
 #[cfg(not(windows))] {None}
}
pub fn preference_locale(prefs:&Value)->Locale{resolve(prefs["language"].as_str(),system_locale().as_deref())}
pub fn exposed_preferences(prefs:&Value)->Value {let mut result=prefs.clone();let system=system_locale();if let Some(object)=result.as_object_mut(){object.entry("language").or_insert(Value::String("auto".into()));object.insert("systemLocale".into(),system.clone().map(Value::String).unwrap_or(Value::Null));if system.is_some()||matches!(prefs["language"].as_str(),Some("zh-CN"|"en")){object.insert("resolvedLocale".into(),Value::String(preference_locale(prefs).code().into()));}}result}
pub fn text(locale:Locale,key:&str)->String {if locale==Locale::En{return key.into();}match key {
 "Notification test (TEST)"=>"通知测试（TEST）",
 "This is a notification test only. No task or quota state changed."=>"这仅是测试通知。未更改任何任务或额度状态。",
 "Codex Control Center"=>"Codex 控制中心",
 "Connecting to background owner"=>"正在连接后台服务",
 "Open Dashboard"=>"打开概览",
 "Open Threads"=>"打开任务列表",
 "Show Widget"=>"显示悬浮窗",
 "Refresh"=>"刷新",
 "Pause Auto Resume"=>"暂停自动恢复",
 "Resume Eligible Tasks"=>"恢复符合条件的任务",
 "Start with Windows"=>"随 Windows 启动",
 "Diagnostics"=>"诊断",
 "Exit UI (keep background service)"=>"退出界面（保留后台服务）",
 "Exit UI and background service"=>"退出界面及后台服务",
 "unavailable"=>"不可用",
 "5h"=>"5 小时",
 "7d"=>"7 天",
 "Running"=>"运行中",
 "Waiting quota"=>"等待额度",
 "Codex quota recovered"=>"Codex 额度已恢复",
 "All blocking windows are available."=>"所有限制额度窗口均已可用。",
 "Codex quota exhausted"=>"Codex 额度已耗尽",
 "Eligible work is waiting for real quota recovery."=>"符合条件的任务正在等待真实额度恢复。",
 "Codex compatibility not verified"=>"Codex 兼容性尚未验证",
 "Automatic recovery is in safe mode. Run Doctor."=>"自动恢复处于安全模式。请运行兼容性检查。",
 "Weekly Codex quota is low"=>"每周 Codex 额度不足",
 "The 7-day window has 10% or less remaining."=>"7 天额度窗口剩余不超过 10%。",
 "Codex task waiting"=>"Codex 任务等待中",
 "A quota-stopped task is safely queued."=>"因额度暂停的任务已安全加入队列。",
 "Codex thread resumed automatically"=>"Codex 任务已自动恢复",
 "The original task was resumed after fresh safety checks."=>"最新安全检查通过后，已恢复原始任务。",
 "Codex recovery needs attention"=>"Codex 恢复需要处理",
 "Automatic retries stopped. Review the task in Dashboard."=>"自动重试已停止。请在概览中查看任务。",
 "Natural Codex quota cycle completed"=>"Codex 真实额度周期已完成",
 "Real exhaustion, recovery, resumption and task completion were observed."=>"已观测到真实额度耗尽、恢复、任务继续及最终完成。",
 _=>key}.into()}
pub fn quota_label(locale:Locale,label:&str,left:Option<f64>,reset:&str)->String{let label=text(locale,label);match left{Some(value)=>match locale{Locale::En=>format!("{label}: {value:.0}% remaining · reset {reset}"),Locale::ZhCn=>format!("{label}：剩余 {value:.0}% · 重置 {reset}")},None=>format!("{label}: {}",text(locale,"unavailable"))}}
pub fn running_label(locale:Locale,working:usize,waiting:usize)->String{format!("{}: {working} · {}: {waiting}",text(locale,"Running"),text(locale,"Waiting quota"))}
pub fn reset_time(locale:Locale,timestamp:Option<i64>,weekly:bool)->String{
 use chrono::{Datelike,Timelike};let Some(date)=timestamp.and_then(chrono::DateTime::from_timestamp_millis).map(|date|date.with_timezone(&chrono::Local))else{return text(locale,"unavailable");};
 #[cfg(windows)] {
  #[repr(C)]struct SystemTime{year:u16,month:u16,day_of_week:u16,day:u16,hour:u16,minute:u16,second:u16,milliseconds:u16}
  #[link(name="kernel32")]extern "system"{fn GetTimeFormatEx(locale:*const u16,flags:u32,time:*const SystemTime,format:*const u16,output:*mut u16,length:i32)->i32;fn GetDateFormatEx(locale:*const u16,flags:u32,time:*const SystemTime,format:*const u16,output:*mut u16,length:i32,calendar:*const u16)->i32;}
  let code:Vec<u16>=locale.code().encode_utf16().chain(Some(0)).collect();let system=SystemTime{year:date.year() as u16,month:date.month() as u16,day_of_week:date.weekday().num_days_from_sunday() as u16,day:date.day() as u16,hour:date.hour() as u16,minute:date.minute() as u16,second:date.second() as u16,milliseconds:0};let mut time=[0u16;128];let count=unsafe{GetTimeFormatEx(code.as_ptr(),2,&system,std::ptr::null(),time.as_mut_ptr(),time.len() as i32)};
  if count>1{let time=String::from_utf16_lossy(&time[..count as usize-1]);if !weekly{return time;}let mut day=[0u16;128];let count=unsafe{GetDateFormatEx(code.as_ptr(),1,&system,std::ptr::null(),day.as_mut_ptr(),day.len() as i32,std::ptr::null())};if count>1{return format!("{} {time}",String::from_utf16_lossy(&day[..count as usize-1]));}}
 }
 let _=(date.year(),date.hour());if weekly{date.format("%Y-%m-%d %H:%M").to_string()}else{date.format("%H:%M").to_string()}
}
#[cfg(test)]mod tests{use super::*;#[test]fn system_variants_and_explicit_overrides(){assert_eq!(resolve(Some("auto"),Some("zh-TW")),Locale::ZhCn);assert_eq!(resolve(None,Some("en-GB")),Locale::En);assert_eq!(resolve(None,Some("fr-FR")),Locale::En);assert_eq!(resolve(Some("en"),Some("zh-CN")),Locale::En);assert_eq!(resolve(Some("zh-CN"),Some("en-US")),Locale::ZhCn);}
#[cfg(windows)]#[test]fn actual_windows_ui_language_is_reported(){let system=system_locale().expect("Windows UI language unavailable");assert!(!system.is_empty());println!("Windows user default UI language: {system}; resolved catalog: {}",resolve(Some("auto"),Some(&system)).code());}
#[test]fn unknown_identifiers_remain_exact(){assert_eq!(text(Locale::ZhCn,"gpt-unknown"),"gpt-unknown");}
#[test]fn all_notification_messages_are_translated(){for key in ["Codex quota recovered","All blocking windows are available.","Codex quota exhausted","Eligible work is waiting for real quota recovery.","Codex compatibility not verified","Automatic recovery is in safe mode. Run Doctor.","Weekly Codex quota is low","The 7-day window has 10% or less remaining.","Codex task waiting","A quota-stopped task is safely queued.","Codex thread resumed automatically","The original task was resumed after fresh safety checks.","Codex recovery needs attention","Automatic retries stopped. Review the task in Dashboard.","Natural Codex quota cycle completed","Real exhaustion, recovery, resumption and task completion were observed."]{assert_ne!(text(Locale::ZhCn,key),key);assert_eq!(text(Locale::En,key),key);}}}
