import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BusinessTable} from '../src/portal/Business';

type RequestRow={id:string;subject:string;status:string;priority:string;origin_discussion_title?:string;searchMarker?:string};

const rows:RequestRow[]=[
  {id:'discussion',subject:'A discussion-origin repair request',status:'new',priority:'urgent',origin_discussion_title:'Lobby Door Repair Source'},
  {id:'ordinary',subject:'Independent plumbing issue',status:'new',priority:'urgent',searchMarker:'priority recovery'},
  ...Array.from({length:8},(_,index)=>({
    id:`urgent-${index}`,subject:`Routine request ${String(index+2).padStart(2,'0')}`,
    status:'new',priority:'urgent',
  })),
  ...Array.from({length:10},(_,index)=>({
    id:`normal-${index}`,subject:`Follow-up request ${String(index+1).padStart(2,'0')}`,
    status:index===0?'new':'in_progress',priority:'normal',
    ...(index===1?{searchMarker:'priority recovery'}:{}),
  })),
];

function BusinessTableFixture(){
  const [priority,setPriority]=useState('');
  const filtered=rows.filter(row=>!priority||row.priority===priority);
  return <>
    <label>Priority
      <select aria-label="Priority" value={priority} onChange={event=>setPriority(event.target.value)}>
        <option value="">All priorities</option>
        <option value="urgent">Urgent</option>
        <option value="normal">Normal</option>
      </select>
    </label>
    <BusinessTable
      rows={filtered}
      columns={[['subject','subject'],['technician_name','technician'],['status','status']]}
      language="en"
    />
  </>;
}

export function mountBusinessTableFixture(){
  const host=document.getElementById('root');
  if(!host)throw new Error('BusinessTable fixture root is missing');
  createRoot(host).render(<BusinessTableFixture/>);
}
