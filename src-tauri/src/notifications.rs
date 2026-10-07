use serde_json::Value;
use std::collections::HashSet;
pub const TYPES:[&str;8]=["quotaExhausted","taskWaiting","quotaRecovered","threadResumed","resumeFailed","unknownVersion","weeklyLow","naturalCycle"];
pub struct Notice{pub kind:&'static str,pub title:&'static str,pub body:&'static str}
#[derive(Default)]
pub struct Planner{seen:HashSet<String>,last_event:Option<u64>}
impl Planner{
 pub fn enabled(prefs:&Value,kind:&str)->bool{prefs["notifications"].as_bool().unwrap_or(true)&&prefs["notificationTypes"][kind].as_bool().unwrap_or(true)}
 fn add(&mut self,output:&mut Vec<Notice>,kind:&'static str,key:String,title:&'static str,body:&'static str){if self.seen.insert(format!("{kind}:{key}")){output.push(Notice{kind,title,body});}}
 pub fn plan(&mut self,previous:Option<&Value>,current:&Value,events:&[Value],natural:Option<&Value>)->Vec<Notice>{
  let mut out=Vec::new();
  if let Some(old)=previous{
   if old["quota"]["ready"]==false&&current["quota"]["ready"]==true{self.add(&mut out,"quotaRecovered",current["lastQuotaPollAt"].to_string(),"Codex quota recovered","All blocking windows are available.");}
   if old["quota"]["ready"]==true&&current["quota"]["ready"]==false&&current["quota"]["known"]==true{self.add(&mut out,"quotaExhausted",current["lastQuotaPollAt"].to_string(),"Codex quota exhausted","Eligible work is waiting for real quota recovery.");}
  }
  if current["compatibility"]["verified"]==false&&current["compatibility"]["status"]!="not-probed"{self.add(&mut out,"unknownVersion",format!("{}:{}:{}",current["compatibility"]["cliVersion"],current["compatibility"]["desktopVersion"],current["compatibility"]["status"]),"Codex compatibility not verified","Automatic recovery is in safe mode. Run Doctor.");}
  if let Some(window)=current["quota"]["windows"].as_array().and_then(|windows|windows.iter().find(|w|w["durationMinutes"]==10080)){
   if window["remainingPercent"].as_f64().map(|p|p<=10.0).unwrap_or(false){self.add(&mut out,"weeklyLow",window["resetsAt"].to_string(),"Weekly Codex quota is low","The 7-day window has 10% or less remaining.");}
  }
  let maximum=events.iter().filter_map(|e|e["id"].as_u64()).max();
  if let Some(last)=self.last_event{
   for event in events.iter().filter(|e|e["id"].as_u64().map(|id|id>last).unwrap_or(false)){
    let key=event["id"].to_string();match event["event"].as_str().unwrap_or(""){
     "task-state" if event["details"]["phase"]=="waitingQuota"=>self.add(&mut out,"taskWaiting",key,"Codex task waiting","A quota-stopped task is safely queued."),
     "auto-resumed" if event["details"]["manual"]!=true=>self.add(&mut out,"threadResumed",key,"Codex thread resumed automatically","The original task was resumed after fresh safety checks."),
     "resume-needs-attention"=>self.add(&mut out,"resumeFailed",key,"Codex recovery needs attention","Automatic retries stopped. Review the task in Dashboard."),
     "task-state" if event["details"]["phase"]=="needsAttention"=>self.add(&mut out,"resumeFailed",key,"Codex recovery needs attention","Automatic retries stopped. Review the task in Dashboard."),_=>{}
    }
   }
  }
  if maximum.is_some(){self.last_event=maximum;}
  if let Some(report)=natural{if report["json"]["status"]=="PASS"{self.add(&mut out,"naturalCycle",report["json"]["cycles"].to_string(),"Natural Codex quota cycle completed","Real exhaustion, recovery, resumption and task completion were observed.");}}
  out
 }
}
#[cfg(test)]mod tests{
 use super::*;use serde_json::json;
 #[test]fn toggles_are_independent_and_master_disables_all(){let prefs=json!({"notifications":true,"notificationTypes":{"quotaExhausted":false}});assert!(!Planner::enabled(&prefs,"quotaExhausted"));assert!(Planner::enabled(&prefs,"threadResumed"));assert!(!Planner::enabled(&json!({"notifications":false}),"threadResumed"));}
 #[test]fn actual_transitions_and_events_are_not_repeated(){let mut planner=Planner::default();let ready=json!({"quota":{"ready":true,"known":true},"compatibility":{"verified":true},"lastQuotaPollAt":1});assert!(planner.plan(None,&ready,&[json!({"id":1,"event":"auto-resumed"})],None).is_empty());let limited=json!({"quota":{"ready":false,"known":true},"compatibility":{"verified":true},"lastQuotaPollAt":2});let events=vec![json!({"id":2,"event":"auto-resumed","details":{"manual":false}})];let notices=planner.plan(Some(&ready),&limited,&events,None);assert_eq!(notices.len(),2);assert!(planner.plan(Some(&limited),&limited,&events,None).is_empty());}
 #[test]fn pending_or_simulated_natural_reports_never_notify_completion(){let mut planner=Planner::default();let current=json!({"compatibility":{"verified":true}});for status in ["INCOMPLETE","SIMULATED","UNKNOWN"]{assert!(planner.plan(None,&current,&[],Some(&json!({"json":{"status":status}}))).is_empty());}let pass=json!({"json":{"status":"PASS","cycles":[{"cycleFingerprint":"synthetic-unit-only"}]}});assert_eq!(planner.plan(None,&current,&[],Some(&pass)).len(),1);assert!(planner.plan(None,&current,&[],Some(&pass)).is_empty());}
}
