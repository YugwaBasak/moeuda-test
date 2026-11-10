(()=>{'use strict';
// Explicit, conflict-aware cloud transfer. Existing notes/photos keep their original workflow.
const MAP='moeuda-mindmaps-v1', LINKS='moeuda-map-shortcuts-v1', TRASH='moeuda-trash-v1', BASE='moeuda-map-cloud-base-v1';
const read=(key,def)=>{try{return JSON.parse(localStorage.getItem(key))??def}catch{return def}};
const clone=v=>JSON.parse(JSON.stringify(v));
const keyOf=(kind,id)=>kind+':'+id;
const normalize=s=>({maps:Array.isArray(s?.maps)?s.maps:[],shortcuts:s?.shortcuts&&typeof s.shortcuts==='object'&&!Array.isArray(s.shortcuts)?s.shortcuts:{},trash:Array.isArray(s?.trash)?s.trash.filter(x=>x.type==='map'):[]});
function local(){return normalize({maps:read(MAP,[]),shortcuts:read(LINKS,{}),trash:read(TRASH,[])})}
function entities(s){const out=new Map();for(const m of s.maps)if(m&&typeof m.id==='string')out.set(keyOf('map',m.id),m);for(const t of s.trash)if(t&&typeof t.id==='string')out.set(keyOf('trash',t.id),t);for(const [id,ids] of Object.entries(s.shortcuts))if(Array.isArray(ids))out.set(keyOf('link',id),ids);return out}
const stable=v=>JSON.stringify(v===undefined?null:v);
function merge(base,here,there){const b=entities(base),l=entities(here),r=entities(there),result=new Map(),conflicts=[];
for(const k of new Set([...b.keys(),...l.keys(),...r.keys()])){
 const bv=b.get(k),lv=l.get(k),rv=r.get(k),lc=stable(lv)!==stable(bv),rc=stable(rv)!==stable(bv);
 if(lc&&rc&&stable(lv)!==stable(rv))conflicts.push({key:k,local:lv,remote:rv});
 else{const v=lc?lv:rc?rv:lv;if(v!==undefined)result.set(k,v)}
}
return {result,conflicts}}
function snapshot(result){const out={maps:[],shortcuts:{},trash:[]};for(const [k,v] of result){const p=k.indexOf(':'),kind=k.slice(0,p),id=k.slice(p+1);if(kind==='map')out.maps.push(v);else if(kind==='trash')out.trash.push(v);else if(kind==='link')out.shortcuts[id]=v}return out}
function validate(s){if(!Array.isArray(s.maps)||!Array.isArray(s.trash)||!s.shortcuts||typeof s.shortcuts!=='object')throw Error('클라우드 마인드맵 데이터 형식이 올바르지 않습니다.');for(const m of s.maps)if(typeof m.id!=='string'||!Array.isArray(m.nodes)||!Array.isArray(m.edges)||!Array.isArray(m.groups))throw Error('마인드맵 데이터가 손상되었습니다.');}
function store(s){validate(s);const previous=read(TRASH,[]),nonMaps=previous.filter(x=>x.type!=='map');
// Preserve all non-map trash; never touch note/diary/photo keys.
localStorage.setItem(MAP,JSON.stringify(s.maps));localStorage.setItem(LINKS,JSON.stringify(s.shortcuts));localStorage.setItem(TRASH,JSON.stringify([...nonMaps,...s.trash]));}
function baseFor(user){const b=read(BASE,{});return b.user===user?b:null}
function saveBase(user,revision,s){localStorage.setItem(BASE,JSON.stringify({user,revision,snapshot:clone(s)}))}
async function get(client,user){const res=await client.from('mindmap_sync').select('user_id,revision,payload').eq('user_id',user).maybeSingle();if(res.error)throw res.error;return res.data}
async function commit(client,user,oldRevision,s){let result;if(oldRevision===null){result=await client.from('mindmap_sync').insert({user_id:user,revision:1,payload:s}).select('revision').single()}
else{result=await client.from('mindmap_sync').update({revision:oldRevision+1,payload:s,updated_at:new Date().toISOString()}).eq('user_id',user).eq('revision',oldRevision).select('revision').maybeSingle()}
if(result.error)throw result.error;if(!result.data)throw Error('다른 기기에서 먼저 수정했습니다. 다시 동기화해 주세요.');return result.data.revision}
async function synchronize(client,user,mode){const localState=local(),remoteRow=await get(client,user),remote=normalize(remoteRow?.payload),old=baseFor(user);
// No prior common ancestor: avoid silently replacing either copy.
let merged;if(!remoteRow){merged=localState}else if(!old){
 const a=entities(localState),b=entities(remote);merged=snapshot(new Map([...b,...a]));
 const overlap=[...a.keys()].filter(k=>b.has(k)&&stable(a.get(k))!==stable(b.get(k)));
 if(overlap.length&&!confirm(`이 기기와 클라우드에 서로 다른 마인드맵 데이터 ${overlap.length}개가 있습니다. 겹치는 항목은 이 기기 데이터를 우선할까요?\n취소하면 아무것도 변경하지 않습니다.`))return false;
}else{
 const {result,conflicts}=merge(normalize(old.snapshot),localState,remote);
 if(conflicts.length){const choice=confirm(`마인드맵 데이터 ${conflicts.length}개에서 충돌이 발견되었습니다.\n확인: 충돌 항목은 이 기기 버전 사용\n취소: 작업 중단 (클라우드 데이터 유지)\n계속하기 전에 파일 저장을 권장합니다.`);if(!choice)return false;for(const c of conflicts){if(c.local===undefined)result.delete(c.key);else result.set(c.key,c.local)}}
 merged=snapshot(result)
}
validate(merged);
// Download also performs a safe merge and writes the merged snapshot back, so no remote changes are lost.
const changed=stable(merged)!==stable(remote);let revision=remoteRow?.revision??null;
if(changed)revision=await commit(client,user,revision,merged);
// Never overwrite local state until the remote write succeeds.
store(merged);saveBase(user,revision,merged);window.moeudaMindmaps?.reloadFromStorage?.();return true}
window.moeudaMindmapCloud={upload:async(client,user)=>synchronize(client,user,'upload'),download:async(client,user)=>synchronize(client,user,'download')};
})();