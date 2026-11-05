import {commentBody} from './comments.mjs';
export const REPO_API='https://api.github.com/repos/Yuqian1017/confidant-mockup';
export const CREDENTIAL_KEY='confidant.mockup.github.v1';
// GitHub documents these template fields; repository selection must be confirmed manually.
export const CONNECT_URL='https://github.com/settings/personal-access-tokens/new?name=Confidant+mockup+comments&description=Send+saved+design+comments+to+confidant-mockup&target_name=Yuqian1017&expires_in=90&issues=write';
export function connectionError(status){return ({401:'401: Token invalid or expired / 凭据无效或已过期，请重新连接',403:'403: Access denied or rate limited. Check Issues: Read and write and repository approval / 检查 Issues 读写权限、仓库批准或稍后重试',404:'404: Repository unavailable. Select confidant-mockup under Yuqian1017 / 请确认所选仓库和账号'})[status]||`GitHub ${status}: Not sent; retry on save / 未发送，保存时重试`;}
export async function githubRequest(fetch,credential,path='',method='GET',body){
 let response;try{response=await fetch(REPO_API+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:['Bearer',credential].join(' '),'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error',credentials:'omit',cache:'no-store'});}catch{throw Error('Offline or connection interrupted / 离线或连接中断，下次保存重试')}
 if(!response.ok)throw Error(connectionError(response.status));return response.json();
}
export function createSendQueue({getComments,getCredential,fetch=globalThis.fetch,persist=()=>{}}){
 let running;
 const flush=()=>{if(running)return running;running=drain().finally(()=>{running=null});return running};
 async function drain(){
  const credential=getCredential();if(!credential)return;
  const request=(path,method,body)=>{if(getCredential()!==credential)throw Error('Disconnected / 已断开');return githubRequest(fetch,credential,path,method,body)};
  async function pages(path){let all=[];for(let page=1;;page++){const rows=await request(path+(path.includes('?')?'&':'?')+'per_page=100&page='+page);all.push(...rows);if(rows.length<100)return all;}}
  for(const c of getComments()){
   if(c.sharedOnly||c.deleted&&c.closed||c.sentAt&&!c.issueNumber||c.deleted&&!c.issueNumber&&!c.createPending)continue;
   if(c.issueNumber&&!c.deleted&&c.syncedBody===commentBody(c))continue;
   c.sending=true;delete c.sendError;persist();
   try{
    if(!c.issueNumber){
     const found=(await pages('/issues?state=all')).find(i=>!i.pull_request&&i.body?.includes('#c-'+c.id+')'));
     if(found){c.issueNumber=found.number;c.syncedBody=c.createBody||found.body;persist()}
     else if(!c.deleted){const body=commentBody(c);c.createPending=true;c.createBody=body;persist();const issue=await request('/issues','POST',{title:'设计评论 · '+c.screen+' · '+[...c.text].slice(0,24).join(''),body});c.issueNumber=issue.number;c.syncedBody=body;c.createPending=false;persist()}
    }
    // Repeat if a save happened while the previous request was in flight.
    while(c.issueNumber&&(c.deleted&&!c.closed||!c.deleted&&c.syncedBody!==commentBody(c))){
     const snapshot=c.deleted?'已删除 / Deleted':commentBody(c);
     // The marker is deterministic, making retries after a lost POST response safe.
     const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshot+(c.deleted?'':c.editRevision||'')))),b=>b.toString(16).padStart(2,'0')).join('');
     const marker='<!-- confidant:'+c.id+':'+digest+' -->';
     if(!(await pages('/issues/'+c.issueNumber+'/comments')).some(n=>n.body?.includes(marker)))await request('/issues/'+c.issueNumber+'/comments','POST',{body:snapshot+'\n\n'+marker});
     if(snapshot==='已删除 / Deleted'){await request('/issues/'+c.issueNumber,'PATCH',{state:'closed'});c.closed=true}else c.syncedBody=snapshot;
     persist();
    }
   }catch(error){c.sendError=error.message}finally{c.sending=false;persist()}
  }
 }
 return {flush};
}
