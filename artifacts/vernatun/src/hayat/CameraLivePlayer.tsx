import {useCallback,useEffect,useRef,useState} from 'react';
import {Room,RoomEvent,Track} from 'livekit-client';
import {MonitorPlay,Square,VideoOff} from 'lucide-react';
import {request} from '../portal/client';

type SessionStart={sessionId:string;viewerId:string;state:'STARTING'|'ACTIVE';serverUrl:string;joinToken:string;tokenExpiresAt:string};
type SessionState={sessionId:string;viewerId:string;state:'STARTING'|'ACTIVE'|'FAILED'|'STOPPING'|'ENDED';failureCode:string|null};
type Props={cameraId:string;enabled:boolean;labels:{start:string;stop:string;connecting:string;live:string;waiting:string;failed:string;notReady:string}};

export default function CameraLivePlayer({cameraId,enabled,labels}:Props){
 const [session,setSession]=useState<SessionStart|null>(null);
 const [state,setState]=useState<SessionState['state']>('ENDED');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const container=useRef<HTMLDivElement>(null);
 const roomRef=useRef<Room|null>(null);
  const sessionRef=useRef<SessionStart|null>(null);
  const connectedOnce=useRef(false);

 const disconnect=useCallback(async()=>{
  const room=roomRef.current;
  roomRef.current=null;
  if(room){
   room.removeAllListeners();
   await room.disconnect();
  }
  container.current?.replaceChildren();
 },[]);

 const attachVideo=useCallback((track:any)=>{
  if(track.kind!==Track.Kind.Video||!container.current)return;
  container.current.replaceChildren();
  const element=track.attach() as HTMLVideoElement;
  element.className='hayat-camera-video';
  element.autoplay=true;
  element.playsInline=true;
  element.muted=true;
  container.current.appendChild(element);
  void element.play().catch(()=>{});
 },[]);

 const connect=useCallback(async(data:SessionStart)=>{
  await disconnect();
  const room=new Room({adaptiveStream:true,dynacast:false});
  roomRef.current=room;
  room.on(RoomEvent.TrackSubscribed,(track)=>attachVideo(track));
  room.on(RoomEvent.TrackUnsubscribed,(track)=>{
   for(const element of track.detach())element.remove();
  });
   room.on(RoomEvent.Disconnected,()=>{
    if(!connectedOnce.current||roomRef.current!==room)return;
    const current=sessionRef.current;
    if(!current)return;
    setState('STARTING');
    void request<Pick<SessionStart,'serverUrl'|'joinToken'|'tokenExpiresAt'>>(
     `/camera-media/sessions/${current.sessionId}/token`,'POST',{viewerId:current.viewerId},
    ).then(token=>{
     const refreshed={...current,...token};
     sessionRef.current=refreshed;
     setSession(refreshed);
     return connect(refreshed);
    }).catch(()=>{
     setError(labels.failed);
     setState('FAILED');
    });
   });
  await room.connect(data.serverUrl,data.joinToken,{autoSubscribe:true});
   connectedOnce.current=true;
  for(const participant of room.remoteParticipants.values()){
   for(const publication of participant.trackPublications.values()){
    if(publication.track)attachVideo(publication.track);
   }
  }
  },[attachVideo,disconnect,labels.failed]);

 const stop=useCallback(async()=>{
  const current=session;
  setBusy(true);
  setError('');
  try{
   if(current)await request(`/camera-media/sessions/${current.sessionId}?viewerId=${encodeURIComponent(current.viewerId)}`,'DELETE');
  }catch{setError(labels.failed)}
  finally{
   await disconnect();
    connectedOnce.current=false;
    sessionRef.current=null;
   setSession(null);
   setState('ENDED');
   setBusy(false);
  }
 },[disconnect,labels.failed,session]);

 const start=useCallback(async()=>{
  if(!enabled||busy)return;
  setBusy(true);
  setError('');
  try{
   const created=await request<SessionStart>(`/camera-media/cameras/${cameraId}/sessions`,'POST',{});
   setSession(created);
    sessionRef.current=created;
    connectedOnce.current=false;
   setState(created.state);
   await connect(created);
  }catch{
   setError(labels.failed);
   await disconnect();
   setSession(null);
   setState('FAILED');
  }finally{setBusy(false)}
 },[cameraId,connect,disconnect,enabled,busy,labels.failed]);

 useEffect(()=>{
  if(!session)return;
  let active=true;
  const refresh=async()=>{
   try{
    const next=await request<SessionState>(`/camera-media/sessions/${session.sessionId}?viewerId=${encodeURIComponent(session.viewerId)}`);
    if(active){
     setState(next.state);
     if(['FAILED','STOPPING','ENDED'].includes(next.state)){
      setError(next.failureCode??labels.failed);
      await disconnect();
      setSession(null);
     }
    }
   }catch{if(active)setError(labels.failed)}
  };
  const heartbeat=()=>void request(`/camera-media/sessions/${session.sessionId}/heartbeat`,'POST',{viewerId:session.viewerId}).catch(()=>{});
  const poll=window.setInterval(()=>void refresh(),2500);
  const beat=window.setInterval(heartbeat,20_000);
  void refresh();
  return()=>{active=false;window.clearInterval(poll);window.clearInterval(beat)};
 },[disconnect,labels.failed,session]);

  useEffect(()=>()=>{const current=sessionRef.current;if(current)void request(
   `/camera-media/sessions/${current.sessionId}?viewerId=${encodeURIComponent(current.viewerId)}`,'DELETE',
  ).catch(()=>{});void disconnect()},[disconnect]);

 const isLive=state==='ACTIVE';
 return <div className="hayat-camera-live">
  <div className="hayat-camera-live-frame">
   <div ref={container} className="hayat-camera-live-video" aria-label={labels.live}/>
   {!isLive&&<div className="hayat-camera-live-placeholder" role="status">
    <VideoOff size={27}/>
    <strong>{session?state==='FAILED'?labels.failed:labels.connecting:labels.notReady}</strong>
    <span>{session?labels.waiting:''}</span>
   </div>}
   {isLive&&<span className="hayat-camera-live-indicator"><i/> LIVE</span>}
  </div>
  <div className="hayat-camera-live-controls">
   {!session?<button type="button" disabled={!enabled||busy} onClick={()=>void start()}><MonitorPlay size={16}/>{busy?labels.connecting:labels.start}</button>
    :<button type="button" disabled={busy} onClick={()=>void stop()}><Square size={15}/>{busy?labels.connecting:labels.stop}</button>}
   {error&&<span role="status" className="hayat-camera-live-error">{error}</span>}
  </div>
 </div>;
}
