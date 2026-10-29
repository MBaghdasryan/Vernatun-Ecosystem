import React from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { useContextId, useLang } from '@/lib/resident/hooks';
import { L, type T } from '@/lib/resident/text';
import { Btn, Card, Chip, Empty, ErrorBox, Skeleton } from '../Ui';
import { useAction } from '../useAction';

type Notice={id:string;title:string;body:string;created_at:string;read_at:string|null};
const copy={
 title:['Ստացված ծանուցումներ','Полученные рассылки','Received broadcasts'] as T,
 unread:['Չընթերցված','Не прочитано','Unread'] as T,
 read:['Նշել որպես կարդացված','Отметить прочитанным','Mark as read'] as T,
 };
export default function BroadcastInbox(){
 const palette=useAppPalette(),l=useLang(),contextId=useContextId(),qc=useQueryClient();
 const list=useQuery({queryKey:['resident-broadcasts',contextId],enabled:!!contextId,refetchInterval:30000,queryFn:()=>customFetch<Notice[]>('/broadcasts/inbox')});
 const mark=useAction(l,()=>{void qc.invalidateQueries({queryKey:['resident-broadcasts',contextId]})});
 return <View style={{gap:12}}>
  {list.isPending&&<Skeleton/>}
  {list.isError&&<ErrorBox message={L(l,['Չհաջողվեց բեռնել ծանուցումները։','Не удалось загрузить рассылки.','Could not load broadcasts.'])} retryLabel={L(l,['Կրկնել','Повторить','Retry'])} onRetry={()=>void list.refetch()}/>}
  {list.data&&!list.data.length&&<Empty text={L(l,['Ստացված ծանուցումներ դեռ չկան։','Полученных рассылок пока нет.','No broadcasts received yet.'])}/>}
  {list.data?.map(item=><Card key={item.id}>
   <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}>
    <Text accessibilityRole="header" style={{color:palette.foreground,fontWeight:'800',fontSize:16,flex:1}}>{item.title}</Text>
    {!item.read_at&&<Chip tone="warn" label={L(l,copy.unread)}/>}
   </View>
   <Text style={{color:palette.mutedForeground,fontSize:12}}>{new Date(item.created_at).toLocaleString(l)}</Text>
   <Text style={{color:palette.foreground,fontSize:14,lineHeight:21}}>{item.body}</Text>
   {!item.read_at&&<Btn label={L(l,copy.read)} busy={mark.busy} onPress={()=>void mark.run(()=>customFetch(`/notifications/${encodeURIComponent(item.id)}/read`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))}/>}
   {mark.err?<Text accessibilityRole="alert" style={{color:palette.dangerText}}>{mark.err}</Text>:null}
  </Card>)}
  <Text style={{color:palette.mutedForeground,fontSize:12}}>{L(l,copy.title)}</Text>
 </View>;
}
