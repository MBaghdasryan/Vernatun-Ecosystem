import React, {useState} from 'react';
import {Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {getResidentDiscussionTarget, type ResidentRecord} from '@workspace/api-client-react';
import {useContextId} from '@/lib/resident/hooks';
import {L,S,statusLabel,type Language} from '@/lib/resident/text';
import {Btn,Card,ErrorBox,Skeleton} from './Ui';

export default function DiscussionLinks({rec,l}:{rec:ResidentRecord;l:Language}){
 const ctx=useContextId(),[target,setTarget]=useState<'request'|'proposal'>();
 const q=useQuery({queryKey:['discussion-target',ctx,rec.id,target],enabled:!!ctx&&!!target,
  queryFn:()=>getResidentDiscussionTarget(rec.id,target!),staleTime:0});
 if(rec.kind!=='discussions')return null;
 return <View style={{gap:10}}>
  {rec.linkedRequestId?<Btn kind="secondary" label={L(l,['Բացել ստեղծված հայտը','Открыть созданную заявку','Open created request'])} onPress={()=>setTarget('request')}/>:null}
  {rec.data.proposalConversion?<Btn kind="secondary" label={L(l,['Բացել օրակարգի առաջարկը','Открыть предложение повестки','Open agenda proposal'])} onPress={()=>setTarget('proposal')}/>:null}
  {target?<Card>
   {q.isPending?<Skeleton/>:null}
   {q.isError?<ErrorBox message={L(l,S.fail)} retryLabel={L(l,S.retry)} onRetry={()=>q.refetch()}/>:null}
   {q.data?<><Text style={{fontSize:17,fontWeight:'800'}}>{q.data.title}</Text>
    {q.data.meetingTitle?<Text>{q.data.meetingTitle}</Text>:null}
    <Text>{statusLabel[q.data.status]?L(l,statusLabel[q.data.status]):q.data.status}</Text>
    <Text>ID: {q.data.id}</Text>
    {target==='proposal'?<Text>{L(l,['Աջակցությունը իրավական քվե չէ։','Поддержка обсуждения не является юридическим голосованием.','Discussion support is not a legal vote.'])}</Text>:null}
   </>:null}
   <Btn kind="secondary" label={L(l,['Փակել','Закрыть','Close'])} onPress={()=>setTarget(undefined)}/>
  </Card>:null}
 </View>;
}
