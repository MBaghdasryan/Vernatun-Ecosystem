import {useCallback,useEffect,useMemo,useState} from 'react';
import {Activity,Camera,ChevronRight,Clock3,MonitorPlay,RefreshCw,ShieldAlert,VideoOff} from 'lucide-react';
import type {Language} from '../portal/i18n';
import {request} from '../portal/client';
import CameraLivePlayer from './CameraLivePlayer';

type CameraSummary={
 id:string;
 name:string;
 buildingId:string;
 buildingName:string;
 zone:string|null;
 edgeId:string;
 edgeStatus:string;
 edgeConnected:boolean;
 cameraStatus:'ONLINE'|'STALE'|'OFFLINE'|'UNKNOWN';
 lastTelemetryAt:string|null;
 telemetry:{online:boolean|null;cameraOpen:boolean|null;videoLoss:boolean|null;tamper:boolean|null;fps:number|null;resolution:string|null};
  stream:{available:boolean;state:'NOT_CONFIGURED'|'EDGE_OFFLINE'|'CAMERA_OFFLINE'|'VIDEO_UNAVAILABLE'|'READY';reason:string};
};
type CameraList={cameras:CameraSummary[]};
type CopyKey='cameraTitle'|'cameraSub'|'cameraRefresh'|'cameraLoading'|'cameraLoadError'|'cameraRetry'|'cameraEmptyTitle'|'cameraEmptyBody'|'cameraList'|'cameraCount'|'cameraSelected'|'cameraTelemetry'|'cameraMediaPlane'|'cameraPlayerTitle'|'cameraNoVideo'|'cameraProviderPending'|'cameraLive'|'cameraSnapshot'|'cameraActionPending'|'cameraNoSelection'|'cameraLocation'|'cameraEdge'|'cameraLastTelemetry'|'cameraFps'|'cameraResolution'|'cameraOnline'|'cameraOpen'|'cameraVideoLoss'|'cameraTamper'|'cameraYes'|'cameraNo'|'cameraUnknown'|'cameraStatusOnline'|'cameraStatusStale'|'cameraStatusOffline'|'cameraStatusUnknown'|'cameraEdgeConnected'|'cameraEdgeDisconnected'|'cameraStreamReady'|'cameraStreamNotConfigured'|'cameraStreamEdgeOffline'|'cameraStreamCameraOffline'|'cameraStreamUnavailable'|'cameraTelemetryNote'|'cameraStart'|'cameraStop'|'cameraConnecting'|'cameraLiveState'|'cameraWaiting'|'cameraStreamFailed'|'cameraNotReady';

const words:Record<CopyKey,[string,string,string]>={
 cameraTitle:['Камеры','Cameras','Տեսախցիկներ'],
 cameraSub:['Состояние камер и Edge-телеметрия. Видео появится после подключения медиапровайдера.','Camera state and Edge telemetry. Video will appear when a media provider is connected.','Տեսախցիկների վիճակ և Edge հեռաչափություն։ Տեսանյութը հասանելի կլինի մեդիա մատակարարին միանալուց հետո։'],
 cameraRefresh:['Обновить данные','Refresh data','Թարմացնել տվյալները'],
 cameraLoading:['Загружаем состояние камер…','Loading camera status…','Տեսախցիկների վիճակի բեռնում…'],
 cameraLoadError:['Не удалось загрузить камеры. Проверьте подключение и повторите попытку.','Camera data could not be loaded. Check the connection and try again.','Չհաջողվեց բեռնել տեսախցիկների տվյալները։ Ստուգեք կապը և փորձեք կրկին։'],
 cameraRetry:['Повторить загрузку','Retry loading','Կրկնել բեռնումը'],
 cameraEmptyTitle:['Камеры не найдены','No cameras found','Տեսախցիկներ չեն գտնվել'],
 cameraEmptyBody:['Для этого рабочего контекста сервер пока не вернул камеры. Новые устройства появятся после регистрации в Edge.','The server has not returned any cameras for this workspace. Devices will appear after they are registered with Edge.','Սերվերը դեռ տեսախցիկներ չի վերադարձրել այս աշխատանքային համատեքստի համար։ Սարքերը կհայտնվեն Edge-ում գրանցվելուց հետո։'],
 cameraList:['Список камер','Camera inventory','Տեսախցիկների ցանկ'],
 cameraCount:['в системе','in system','համակարգում'],
 cameraSelected:['Выбрана камера','Selected camera','Ընտրված տեսախցիկ'],
 cameraTelemetry:['Телеметрия устройства','Device telemetry','Սարքի հեռաչափություն'],
 cameraMediaPlane:['Медиаканал','Media plane','Մեդիա ալիք'],
 cameraPlayerTitle:['Просмотр изображения','Camera view','Տեսախցիկի դիտում'],
 cameraNoVideo:['Видео не подключено','Video not connected','Տեսանյութը միացված չէ'],
 cameraProviderPending:['Ожидается подключение провайдера видео. Здесь нет трансляции или снимка.','Video provider pending. No live feed or snapshot is being shown here.','Տեսանյութի մատակարարի միացումը սպասվում է։ Այստեղ ուղիղ հեռարձակում կամ պատկեր չկա։'],
 cameraLive:['Открыть эфир','Open live view','Բացել ուղիղ դիտումը'],
 cameraSnapshot:['Снимок','Snapshot','Նկար'],
 cameraActionPending:['Медиаинтеграция ожидает подключения.','Media integration is pending.','Մեդիա ինտեգրումը սպասում է միացման։'],
 cameraNoSelection:['Выберите камеру из списка, чтобы просмотреть её состояние.','Select a camera from the list to inspect its status.','Ընտրեք տեսախցիկը ցանկից՝ դրա վիճակը դիտելու համար։'],
 cameraLocation:['Расположение','Location','Տեղադրություն'],
 cameraEdge:['Edge','Edge','Edge'],
 cameraLastTelemetry:['Последняя телеметрия','Last telemetry','Վերջին հեռաչափություն'],
 cameraFps:['Кадров/с','Frames/s','Կադր/վրկ'],
 cameraResolution:['Разрешение','Resolution','Լուծաչափ'],
 cameraOnline:['Устройство онлайн','Device online','Սարքը առցանց է'],
 cameraOpen:['Камера открыта','Camera open','Տեսախցիկը բաց է'],
 cameraVideoLoss:['Потеря видеосигнала','Video loss','Տեսաազդանշանի կորուստ'],
 cameraTamper:['Вмешательство','Tamper','Միջամտություն'],
 cameraYes:['Да','Yes','Այո'],
 cameraNo:['Нет','No','Ոչ'],
 cameraUnknown:['Нет данных','No data','Տվյալներ չկան'],
 cameraStatusOnline:['В сети','Online','Առցանց'],
 cameraStatusStale:['Устаревшие данные','Stale data','Հնացած տվյալներ'],
 cameraStatusOffline:['Не в сети','Offline','Անցանց'],
 cameraStatusUnknown:['Неизвестно','Unknown','Անհայտ'],
 cameraEdgeConnected:['Edge подключён','Edge connected','Edge-ը միացված է'],
 cameraEdgeDisconnected:['Edge не подключён','Edge disconnected','Edge-ը միացված չէ'],
 cameraStreamReady:['Медиаканал доступен','Media available','Մեդիան հասանելի է'],
 cameraStreamNotConfigured:['Не настроен','Not configured','Կարգավորված չէ'],
 cameraStreamEdgeOffline:['Edge не в сети','Edge offline','Edge-ն անցանց է'],
 cameraStreamCameraOffline:['Камера не в сети','Camera offline','Տեսախցիկն անցանց է'],
 cameraStreamUnavailable:['Видео недоступно','Video unavailable','Տեսանյութը հասանելի չէ'],
 cameraTelemetryNote:['Телеметрия — состояние устройства; она не является видеопотоком.','Telemetry describes device state; it is not a video feed.','Հեռաչափությունը նկարագրում է սարքի վիճակը, ոչ թե տեսահոսքը։'],
  cameraStart:['Начать просмотр','Start live view','Սկսել ուղիղ դիտումը'],
  cameraStop:['Остановить просмотр','Stop live view','Դադարեցնել ուղիղ դիտումը'],
  cameraConnecting:['Подключаемся…','Connecting…','Միանում ենք…'],
  cameraLiveState:['В эфире','Live','Ուղիղ եթերում'],
  cameraWaiting:['Ожидаем видеотрек от Vernatun Edge.','Waiting for a video track from Vernatun Edge.','Սպասում ենք Vernatun Edge-ի տեսահոսքին։'],
  cameraStreamFailed:['Не удалось запустить видеопоток.','Could not start the video stream.','Չհաջողվեց սկսել տեսահոսքը։'],
  cameraNotReady:['Видеоканал пока не настроен.','The video channel is not configured yet.','Տեսաալիքը դեռ կարգավորված չէ։'],
};
const translated=(language:Language,key:CopyKey)=>words[key][language==='ru'?0:language==='en'?1:2];
const statusKey:Record<CameraSummary['cameraStatus'],CopyKey>={ONLINE:'cameraStatusOnline',STALE:'cameraStatusStale',OFFLINE:'cameraStatusOffline',UNKNOWN:'cameraStatusUnknown'};
const streamKey:Record<CameraSummary['stream']['state'],CopyKey>={NOT_CONFIGURED:'cameraStreamNotConfigured',EDGE_OFFLINE:'cameraStreamEdgeOffline',CAMERA_OFFLINE:'cameraStreamCameraOffline',VIDEO_UNAVAILABLE:'cameraStreamUnavailable',READY:'cameraStreamReady'};

function BooleanValue({value,language}:{value:boolean|null;language:Language}){
 if(value===null)return <span className="hayat-camera-value is-unknown">{translated(language,'cameraUnknown')}</span>;
 return <span className={'hayat-camera-value '+(value?'is-true':'is-false')}><i aria-hidden="true"/>{translated(language,value?'cameraYes':'cameraNo')}</span>;
}

export default function CameraWorkspace({language}:{language:Language}){
 const [cameras,setCameras]=useState<CameraSummary[]>();
 const [selectedId,setSelectedId]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState(false);
 const [refreshing,setRefreshing]=useState(false);
 const t=(key:CopyKey)=>translated(language,key);
 const load=useCallback(async(initial=false)=>{
  if(initial)setLoading(true);else setRefreshing(true);
  try{
   const result=await request<CameraList>('/camera-media/cameras');
   setCameras(Array.isArray(result?.cameras)?result.cameras:[]);
   setError(false);
  }catch{setError(true)}
  finally{setLoading(false);setRefreshing(false)}
 },[]);
 useEffect(()=>{
  let active=true;
  const run=async(initial=false)=>{
   if(!active||document.visibilityState!=='visible'||!navigator.onLine)return;
   if(initial)setLoading(true);else setRefreshing(true);
   try{
    const result=await request<CameraList>('/camera-media/cameras');
    if(active){setCameras(Array.isArray(result?.cameras)?result.cameras:[]);setError(false)}
   }catch{if(active)setError(true)}
   finally{if(active){setLoading(false);setRefreshing(false)}}
  };
  void run(true);
  const onFocus=()=>void run();
  const onVisibility=()=>{if(document.visibilityState==='visible')void run()};
  const interval=window.setInterval(()=>void run(),30000);
  window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{active=false;window.clearInterval(interval);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisibility)};
 },[]);
 const camera=useMemo(()=>cameras?.find(item=>item.id===selectedId)??cameras?.[0], [cameras,selectedId]);
 useEffect(()=>{if(camera&&camera.id!==selectedId)setSelectedId(camera.id)},[camera,selectedId]);
 const formatDate=(value:string|null)=>value?new Intl.DateTimeFormat(language,{timeZone:'Asia/Yerevan',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):t('cameraUnknown');
 const statusLabel=(value:CameraSummary['cameraStatus'])=>t(statusKey[value]??'cameraStatusUnknown');
 const streamLabel=(item:CameraSummary)=>item.stream.available?t('cameraStreamReady'):t(streamKey[item.stream.state]??'cameraStreamUnavailable');
 return <section className="hayat-cameras" aria-labelledby="camera-workspace-title">
  <header className="hayat-camera-heading">
   <div><span className="hayat-camera-kicker"><Camera size={15}/>{t('cameraList')}</span><h2 id="camera-workspace-title">{t('cameraTitle')}</h2><p>{t('cameraSub')}</p></div>
   <button className="hayat-camera-refresh" type="button" onClick={()=>void load()} disabled={loading||refreshing} aria-label={t('cameraRefresh')}><RefreshCw size={17} className={refreshing?'is-spinning':''}/><span>{t('cameraRefresh')}</span></button>
  </header>
  {loading&&!cameras?<div className="hayat-camera-loading" role="status" aria-label={t('cameraLoading')}><div className="hayat-camera-skeleton rail"/><div className="hayat-camera-skeleton main"/><span>{t('cameraLoading')}</span></div>:error&&!cameras?<div className="hayat-camera-error" role="alert"><ShieldAlert size={24}/><p>{t('cameraLoadError')}</p><button type="button" onClick={()=>void load(true)}>{t('cameraRetry')}</button></div>:!cameras?.length?<div className="hayat-camera-empty"><Camera size={26}/><h3>{t('cameraEmptyTitle')}</h3><p>{t('cameraEmptyBody')}</p></div>:<>
   {error&&<div className="hayat-camera-inline-error" role="alert"><ShieldAlert size={17}/>{t('cameraLoadError')}</div>}
   <div className="hayat-camera-layout">
    <aside className="hayat-camera-rail" aria-label={t('cameraList')}>
     <div className="hayat-camera-rail-heading"><div><span>{t('cameraList')}</span><strong>{cameras.length}</strong></div><small>{t('cameraCount')}</small></div>
     <div className="hayat-camera-items">{cameras.map(item=><button type="button" key={item.id} className={'hayat-camera-item '+(camera?.id===item.id?'selected':'')} onClick={()=>setSelectedId(item.id)} aria-current={camera?.id===item.id?'true':undefined} data-testid={`camera-item-${item.id}`}>
      <span className={'hayat-camera-dot '+item.cameraStatus.toLowerCase()} aria-hidden="true"/><span className="hayat-camera-item-copy"><strong>{item.name}</strong><small>{item.buildingName}{item.zone?` · ${item.zone}`:''}</small></span><span className="hayat-camera-item-status">{statusLabel(item.cameraStatus)}</span><ChevronRight size={15}/>
     </button>)}</div>
    </aside>
    <div className="hayat-camera-detail">
     {!camera?<div className="hayat-camera-player-empty"><Camera size={30}/><p>{t('cameraNoSelection')}</p></div>:<>
      <div className="hayat-camera-detail-head">
       <div><span className="hayat-camera-kicker">{t('cameraSelected')}</span><h3>{camera.name}</h3><p>{camera.buildingName}{camera.zone?` · ${camera.zone}`:''}</p></div>
       <span className={'hayat-camera-status '+camera.cameraStatus.toLowerCase()}><i aria-hidden="true"/>{statusLabel(camera.cameraStatus)}</span>
      </div>
      <section className="hayat-camera-player" aria-labelledby="camera-player-title">
       <div className="hayat-camera-player-top"><h4 id="camera-player-title"><MonitorPlay size={17}/>{t('cameraPlayerTitle')}</h4><span className="hayat-camera-media-label"><span/>{t('cameraNoVideo')}</span></div>
        <CameraLivePlayer
         key={camera.id}
         cameraId={camera.id}
         enabled={camera.stream.available}
         labels={{
          start:t('cameraStart'),stop:t('cameraStop'),connecting:t('cameraConnecting'),
          live:t('cameraLiveState'),waiting:t('cameraWaiting'),failed:t('cameraStreamFailed'),
          notReady:t('cameraNotReady'),
         }}
        />
        <div className="hayat-camera-player-meta"><span>{t('cameraMediaPlane')}</span><b>{streamLabel(camera)}</b></div>
      </section>
      <div className="hayat-camera-panels">
       <section className="hayat-camera-panel" aria-labelledby="camera-telemetry-title">
        <div className="hayat-camera-panel-heading"><div><Activity size={17}/><h4 id="camera-telemetry-title">{t('cameraTelemetry')}</h4></div><small>{t('cameraTelemetryNote')}</small></div>
        <div className="hayat-camera-telemetry-grid">
         <div className="hayat-camera-telemetry-cell"><span>{t('cameraOnline')}</span><BooleanValue value={camera.telemetry.online} language={language}/></div>
         <div className="hayat-camera-telemetry-cell"><span>{t('cameraOpen')}</span><BooleanValue value={camera.telemetry.cameraOpen} language={language}/></div>
         <div className="hayat-camera-telemetry-cell"><span>{t('cameraVideoLoss')}</span><BooleanValue value={camera.telemetry.videoLoss} language={language}/></div>
         <div className="hayat-camera-telemetry-cell"><span>{t('cameraTamper')}</span><BooleanValue value={camera.telemetry.tamper} language={language}/></div>
         <div className="hayat-camera-telemetry-cell"><span>{t('cameraFps')}</span><strong>{camera.telemetry.fps??'—'}</strong></div>
         <div className="hayat-camera-telemetry-cell"><span>{t('cameraResolution')}</span><strong>{camera.telemetry.resolution??'—'}</strong></div>
        </div>
       </section>
       <section className="hayat-camera-panel hayat-camera-edge-panel" aria-labelledby="camera-edge-title">
        <div className="hayat-camera-panel-heading"><div><Activity size={17}/><h4 id="camera-edge-title">{t('cameraEdge')}</h4></div></div>
        <div className="hayat-camera-edge-state"><span className={'hayat-camera-edge-indicator '+(camera.edgeConnected?'connected':'disconnected')}/><strong>{camera.edgeConnected?t('cameraEdgeConnected'):t('cameraEdgeDisconnected')}</strong><small>{camera.edgeStatus}</small></div>
        <div className="hayat-camera-edge-meta"><span>{t('cameraEdge')} ID</span><code>{camera.edgeId}</code></div>
        <div className="hayat-camera-edge-meta"><span>{t('cameraLastTelemetry')}</span><strong><Clock3 size={14}/>{formatDate(camera.lastTelemetryAt)}</strong></div>
        <div className="hayat-camera-edge-meta media"><span>{t('cameraMediaPlane')}</span><strong>{streamLabel(camera)}</strong></div>
       </section>
      </div>
     </>}
    </div>
   </div>
  </>}
 </section>;
}
