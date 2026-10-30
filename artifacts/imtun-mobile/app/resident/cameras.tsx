import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useRouter} from 'expo-router';
import {Feather} from '@expo/vector-icons';
import {getGetCameraMediaSessionQueryKey,getListCameraMediaCamerasQueryKey,useGetMobileAuthSession,useGetCameraMediaSession,useHeartbeatCameraMediaSession,useListCameraMediaCameras,useStartCameraMediaSession,useStopCameraMediaSession} from '@workspace/api-client-react';
import {useAppPalette,type Palette} from '@/hooks/useAppTheme';
import {useLang} from '@/lib/resident/hooks';
import {L} from '@/lib/resident/text';
import type {CameraMediaCamera,CameraMediaSessionStart} from '@workspace/api-client-react';

type NativePlayer=React.ComponentType<{serverUrl:string;token:string;palette:{surface:string;foreground:string;mutedForeground:string}}>;
export default function ResidentCamerasScreen(){
 const palette=useAppPalette(),st=React.useMemo(()=>styles(palette),[palette]),l=useLang(),router=useRouter();
 const auth=useGetMobileAuthSession(),context=auth.data?.contexts.find(item=>item.id===auth.data?.contextId);
 const allowed=!!context?.permissions?.includes('device.camera.live_view');
 const cameras=useListCameraMediaCameras({query:{queryKey:getListCameraMediaCamerasQueryKey(),enabled:allowed,refetchInterval:15_000,retry:false}});
 const startMutation=useStartCameraMediaSession(),stopMutation=useStopCameraMediaSession(),heartbeatMutation=useHeartbeatCameraMediaSession();
 const [active,setActive]=useState<CameraMediaSessionStart|null>(null);
 const [NativePlayer,setNativePlayer]=useState<NativePlayer|null>(null);
 const [error,setError]=useState('');
 const activeRef=useRef(active),stopRef=useRef(stopMutation.mutate);
 activeRef.current=active;stopRef.current=stopMutation.mutate;
 const status=useGetCameraMediaSession(active?.sessionId??'',{viewerId:active?.viewerId??''},{query:{queryKey:getGetCameraMediaSessionQueryKey(active?.sessionId??'',{viewerId:active?.viewerId??''}),enabled:!!active,refetchInterval:3000,retry:false}});
 const strings={
  title:L(l,['Տեսախցիկներ','Камеры','Cameras']),
  description:L(l,['Տեսահոսքը հասանելի է միայն հատուկ թույլտվությամբ։','Просмотр доступен только при явно выданном доступе.','Live view requires explicitly granted access.']),
  denied:L(l,['Այս համատեքստին տեսախցիկների հասանելիություն չի տրվել։','В этом контексте нет доступа к камерам.','Camera access has not been granted in this context.']),
  loading:L(l,['Բեռնում…','Загрузка…','Loading…']),
  empty:L(l,['Տեսախցիկներ չեն գտնվել։','Камеры не найдены.','No cameras found.']),
  start:L(l,['Սկսել դիտումը','Начать просмотр','Start viewing']),
  stop:L(l,['Դադարեցնել','Остановить','Stop viewing']),
  ready:L(l,['Պատրաստ է','Готово','Ready']),
  waiting:L(l,['Սպասում ենք Vernatun Edge-ի տեսահոսքին։','Ожидаем видеопоток от Vernatun Edge.','Waiting for video from Vernatun Edge.']),
  unavailable:L(l,['Տեսահոսքը հիմա հասանելի չէ։','Видеопоток сейчас недоступен.','Video is not available right now.']),
  failed:L(l,['Չհաջողվեց սկսել դիտումը։','Не удалось начать просмотр.','Could not start live view.']),
 };
 const open=useCallback(async(camera:CameraMediaCamera)=>{
  if(!camera.stream.available)return;
  setError('');
  try{
   const session=await startMutation.mutateAsync({cameraId:camera.id,data:{}});
   setActive(session);
   try{
    const module=await import('@/components/media/CameraLiveNative');
    setNativePlayer(()=>module.default);
   }catch{
    setError(strings.unavailable);
    await stopMutation.mutateAsync({sessionId:session.sessionId,params:{viewerId:session.viewerId}}).catch(()=>{});
    setActive(null);
   }
  }catch{setError(strings.failed)}
 },[startMutation,stopMutation,strings.failed,strings.unavailable]);
 const close=useCallback(async()=>{
  if(!active)return;
  try{await stopMutation.mutateAsync({sessionId:active.sessionId,params:{viewerId:active.viewerId}})}catch{}
  setActive(null);setNativePlayer(null);
 },[active,stopMutation]);
 useEffect(()=>{
  if(!active)return;
  const timer=setInterval(()=>heartbeatMutation.mutate({sessionId:active.sessionId,data:{viewerId:active.viewerId}}),20_000);
  return()=>clearInterval(timer);
 },[active,heartbeatMutation]);
 useEffect(()=>{
  const state=status.data?.state;
  if(state==='FAILED'||state==='ENDED'){setError(status.data?.failureCode??strings.failed);setActive(null);setNativePlayer(null)}
 },[status.data?.failureCode,status.data?.state,strings.failed]);
 useEffect(()=>()=>{const current=activeRef.current;if(current)stopRef.current({sessionId:current.sessionId,params:{viewerId:current.viewerId}})},[]);

 return <ScrollView style={{backgroundColor:palette.background}} contentContainerStyle={st.page}>
  <View style={st.header}>
   <Pressable accessibilityRole="button" accessibilityLabel={L(l,['Հետ','Назад','Back'])} onPress={()=>router.back()} style={st.back}><Feather name="arrow-left" size={20} color={palette.foreground}/></Pressable>
   <View style={{flex:1}}><Text accessibilityRole="header" style={st.title}>{strings.title}</Text><Text style={st.description}>{strings.description}</Text></View>
  </View>
  {!allowed?<View style={st.notice}><Feather name="shield" size={22} color={palette.primary}/><Text style={st.noticeText}>{strings.denied}</Text></View>
   :cameras.isPending?<View style={st.notice}><ActivityIndicator color={palette.primary}/><Text style={st.noticeText}>{strings.loading}</Text></View>
   :cameras.isError?<View style={st.notice}><Feather name="alert-triangle" size={21} color={palette.primary}/><Text style={st.noticeText}>{strings.failed}</Text></View>
   :!cameras.data?.cameras.length?<View style={st.notice}><Feather name="video-off" size={22} color={palette.primary}/><Text style={st.noticeText}>{strings.empty}</Text></View>
   :<View style={st.content}>
    {active&&NativePlayer?<NativePlayer serverUrl={active.serverUrl} token={active.joinToken} palette={{surface:palette.surface,foreground:palette.foreground,mutedForeground:palette.mutedForeground}}/>
     :<View style={st.videoPlaceholder}><Feather name="video-off" size={28} color="#b8c6c8"/><Text style={st.videoText}>{active?strings.waiting:strings.unavailable}</Text></View>}
    {cameras.data.cameras.map(camera=><View key={camera.id} style={st.cameraCard}>
     <View style={st.cameraHeader}><View style={st.cameraIcon}><Feather name="video" size={18} color={palette.primary}/></View><View style={{flex:1}}><Text style={st.cameraName}>{camera.name}</Text><Text style={st.cameraLocation}>{camera.buildingName}{camera.zone?` · ${camera.zone}`:''}</Text></View><Text style={[st.status,camera.cameraStatus==='ONLINE'?st.online:st.offline]}>{camera.cameraStatus}</Text></View>
     <View style={st.mediaStatus}><Text style={st.mediaLabel}>Edge</Text><Text style={st.mediaValue}>{camera.edgeConnected?L(l,['Միացված է','Подключён','Connected']):L(l,['Անջատված է','Отключён','Offline'])}</Text></View>
     <View style={st.mediaStatus}><Text style={st.mediaLabel}>WebRTC</Text><Text style={st.mediaValue}>{camera.stream.available?strings.ready:strings.unavailable}</Text></View>
     <Pressable accessibilityRole="button" disabled={!camera.stream.available||startMutation.isPending||!!active} onPress={()=>void open(camera)} style={[st.action,(!camera.stream.available||!!active)&&st.disabled]}>{startMutation.isPending?<ActivityIndicator color="#fff"/>:<Feather name="play" size={16} color="#fff"/>}<Text style={st.actionText}>{strings.start}</Text></Pressable>
    </View>)}
    {active?<Pressable accessibilityRole="button" onPress={()=>void close()} style={[st.action,st.stop]}><Feather name="square" size={15} color="#fff"/><Text style={st.actionText}>{strings.stop}</Text></Pressable>:null}
    {error?<Text accessibilityRole="alert" style={st.error}>{error}</Text>:null}
   </View>}
  <Text style={st.footnote}>{L(l,['Տեսախցիկի հեռաչափությունը տեսանյութ չէ։ Հոսքը միացվում է պահանջով և ավարտվում է դիտումը դադարեցնելիս։','Телеметрия камеры не является видео. Поток запускается по запросу и прекращается после завершения просмотра.','Camera telemetry is not video. Streams start on demand and stop when viewing ends.'])}</Text>
 </ScrollView>;
}

const styles=(p:Palette)=>StyleSheet.create({
 page:{padding:18,paddingTop:62,paddingBottom:34,gap:16},
 header:{flexDirection:'row',alignItems:'flex-start',gap:10},
 back:{width:38,height:38,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:p.surface,borderWidth:1,borderColor:p.border},
 title:{fontSize:23,fontWeight:'800',color:p.foreground},
 description:{marginTop:5,fontSize:12,lineHeight:18,color:p.mutedForeground},
 notice:{minHeight:140,padding:20,borderRadius:16,borderWidth:1,borderColor:p.border,backgroundColor:p.surface,alignItems:'center',justifyContent:'center',gap:12},
 noticeText:{textAlign:'center',fontSize:13,lineHeight:20,color:p.mutedForeground},
 content:{gap:12},
 videoPlaceholder:{aspectRatio:16/9,borderRadius:14,backgroundColor:'#101d25',alignItems:'center',justifyContent:'center',gap:10},
 videoText:{color:'#dbe4e6',fontSize:12,textAlign:'center',paddingHorizontal:18},
 cameraCard:{padding:14,borderRadius:15,backgroundColor:p.surface,borderWidth:1,borderColor:p.border,gap:10},
 cameraHeader:{flexDirection:'row',alignItems:'center',gap:10},
 cameraIcon:{width:38,height:38,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:p.accent},
 cameraName:{fontSize:14,fontWeight:'800',color:p.foreground},
 cameraLocation:{fontSize:11,color:p.mutedForeground,marginTop:3},
 status:{fontSize:9,fontWeight:'800',paddingHorizontal:7,paddingVertical:4,borderRadius:9,overflow:'hidden'},
 online:{backgroundColor:'#e6f4ea',color:'#397b4d'},offline:{backgroundColor:'#f8e8e4',color:'#a84b39'},
 mediaStatus:{flexDirection:'row',justifyContent:'space-between',gap:8},
 mediaLabel:{fontSize:11,color:p.mutedForeground},mediaValue:{fontSize:11,fontWeight:'700',color:p.foreground},
 action:{minHeight:43,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:p.primary,marginTop:4},
 stop:{backgroundColor:'#34434a'},disabled:{opacity:.45},
 actionText:{fontSize:12,fontWeight:'800',color:'#fff'},
 error:{fontSize:12,color:'#a84b39'},
 footnote:{fontSize:10,lineHeight:16,color:p.mutedForeground},
});
