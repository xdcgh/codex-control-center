use serde_json::{json,Value};
use std::{collections::HashMap,sync::{Arc,atomic::{AtomicU64,Ordering}},time::Duration};
use tokio::{io::{AsyncBufReadExt,AsyncReadExt,AsyncWriteExt,BufReader},sync::{Mutex,Semaphore,oneshot}};

pub fn run(){
 let runtime=tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("helper-runtime-unavailable");
 if runtime.block_on(server()).is_err(){std::process::exit(2);}
}
async fn frame<R:tokio::io::AsyncRead+Unpin>(reader:&mut R,limit:usize)->Result<String,()> {
 let mut bytes=Vec::new();loop{let byte=reader.read_u8().await.map_err(|_|())?;if byte==b'\n'{return String::from_utf8(bytes).map_err(|_|());}bytes.push(byte);if bytes.len()>limit{return Err(());}}
}
async fn output(writer:&Arc<Mutex<tokio::io::Stdout>>,value:Value)->Result<(),()>{let line=value.to_string()+"\n";writer.lock().await.write_all(line.as_bytes()).await.map_err(|_|())}
#[cfg(windows)]
async fn server()->Result<(),()> {
 use tokio::net::windows::named_pipe::ServerOptions;
 let mut stdin=BufReader::new(tokio::io::stdin());let mut configure=String::new();stdin.read_line(&mut configure).await.map_err(|_|())?;
 if configure.len()>65536{return Err(());}let config:Value=serde_json::from_str(&configure).map_err(|_|())?;
 let pipe=config["pipe"].as_str().ok_or(())?.to_string();let token=config["token"].as_str().ok_or(())?.as_bytes().to_vec();
 if !pipe.starts_with("\\\\.\\pipe\\codex-control-center-")||token.len()!=64{return Err(());}
 let mut listener=ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).max_instances(9).create(&pipe).map_err(|_|())?;
 let writer=Arc::new(Mutex::new(tokio::io::stdout()));output(&writer,json!({"event":"ready","rejectRemoteClients":true})).await?;
 let pending:Arc<Mutex<HashMap<u64,oneshot::Sender<Value>>>>=Arc::new(Mutex::new(HashMap::new()));
 let incoming=pending.clone();
 tokio::spawn(async move{loop{let mut line=String::new();let read=stdin.read_line(&mut line).await;if read.is_err()||read.ok()==Some(0){std::process::exit(0);}if line.len()>16*1024*1024{std::process::exit(2);}if let Ok(value)=serde_json::from_str::<Value>(&line){if let Some(id)=value["brokerId"].as_u64(){if let Some(waiter)=incoming.lock().await.remove(&id){let _=waiter.send(value["response"].clone());}}}}});
 let slots=Arc::new(Semaphore::new(8));let sequence=Arc::new(AtomicU64::new(0));
 loop{
   listener.connect().await.map_err(|_|())?;let connection=listener;
   let permit=match slots.clone().try_acquire_owned(){Ok(p)=>p,Err(_)=>{drop(connection);listener=ServerOptions::new().reject_remote_clients(true).max_instances(9).create(&pipe).map_err(|_|())?;continue;}};
   listener=ServerOptions::new().reject_remote_clients(true).max_instances(9).create(&pipe).map_err(|_|())?;
   let token=token.clone();let writer=writer.clone();let pending=pending.clone();let sequence=sequence.clone();
   tokio::spawn(async move{
     let _permit=permit;let mut authenticated=false;let mut connection=BufReader::new(connection);
     loop{
       let line=match tokio::time::timeout(Duration::from_secs(if authenticated{30}else{10}),frame(&mut connection,65535)).await{Ok(Ok(line))=>line,_=>return};
       let request:Value=match serde_json::from_str(&line){Ok(v)=>v,Err(_)=>return};
       if !authenticated{
         let supplied=request["params"]["token"].as_str().unwrap_or("").as_bytes();let mut diff=(supplied.len()!=token.len()) as u8;
         for(index,expected)in token.iter().enumerate(){diff|=*expected^supplied.get(index).copied().unwrap_or(0);}
         if request["method"]!="authenticate"||diff!=0{return;}
         authenticated=true;let response=json!({"id":request["id"],"result":{"authenticated":true}}).to_string()+"\n";if connection.get_mut().write_all(response.as_bytes()).await.is_err(){return;}continue;
       }
       let id=sequence.fetch_add(1,Ordering::Relaxed)+1;let (send,receive)=oneshot::channel();pending.lock().await.insert(id,send);
       if output(&writer,json!({"brokerId":id,"request":request})).await.is_err(){pending.lock().await.remove(&id);return;}
       let response=match tokio::time::timeout(Duration::from_secs(35),receive).await{Ok(Ok(value))=>value,_=>{pending.lock().await.remove(&id);return;}};
       let line=response.to_string()+"\n";if connection.get_mut().write_all(line.as_bytes()).await.is_err(){return;}
     }
   });
 }
}
#[cfg(not(windows))]
async fn server()->Result<(),()>{Err(())}
