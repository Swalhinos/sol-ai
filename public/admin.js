"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let toastT=0;
function toast(m){const t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2600);}
const DOTS='<svg viewBox="0 0 64 40" fill="none"><circle cx="11" cy="27" r="9" fill="#F2A98C"/><circle cx="32" cy="13" r="12" fill="#E07A52"/><circle cx="53" cy="27" r="9" fill="#C96A44"/></svg>';
$("adLogo").innerHTML=DOTS;$("loginLogo").innerHTML=DOTS;
const ses=()=>sessionStorage.getItem("sw_admin")||"";
const api=async(path,opts)=>{
  const r=await fetch(path,Object.assign({headers:{"Content-Type":"application/json","x-admin-session":ses()}},opts||{}));
  const j=await r.json().catch(()=>({}));
  if(r.status===401){sessionStorage.removeItem("sw_admin");showLogin();throw new Error("Session expired");}
  if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
  return j;
};
/* ---------- login ---------- */
function showLogin(){$("alogin").hidden=false;$("dash").hidden=true;}
function showDash(){$("alogin").hidden=true;$("dash").hidden=false;loadAll();}
async function doLogin(){
  const p=$("apass").value;if(!p){$("aerr").textContent="Enter the password.";return;}
  try{
    const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:p})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||"Login failed");
    sessionStorage.setItem("sw_admin",j.sid);$("apass").value="";$("aerr").textContent="";showDash();
  }catch(e){$("aerr").textContent=e.message;}
}
$("aloginBtn").addEventListener("click",doLogin);
$("apass").addEventListener("keydown",e=>{if(e.key==="Enter")doLogin();});
$("alogout").addEventListener("click",()=>{sessionStorage.removeItem("sw_admin");showLogin();});
/* ---------- tabs ---------- */
function goTab(name){
  document.querySelectorAll(".ad-tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
  ["overview","tokens","stats","settings"].forEach(t=>$("tab-"+t).hidden=t!==name);
  if(name==="overview"||name==="stats")loadStats();
  if(name==="tokens")loadTokens();
  if(name==="settings")loadSettings();
}
document.querySelectorAll(".ad-tab").forEach(b=>b.addEventListener("click",()=>goTab(b.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>goTab(b.dataset.goto)));
/* ---------- tokens ---------- */
async function loadTokens(){
  const list=await api("/api/admin/tokens");
  $("tokCount").textContent="("+list.length+")";
  const box=$("tokList");box.innerHTML="";
  if(!list.length){box.innerHTML='<p class="muted">No tokens yet — create one above and share it with whoever you choose.</p>';return;}
  list.forEach(t=>{
    const d=document.createElement("div");d.className="tok";
    d.innerHTML='<div class="inf"><div class="nm"></div><div class="meta"></div></div>'+
      '<span class="key" title="Click to copy"></span>'+
      '<span class="badge '+(t.revoked?"off":"on")+'">'+(t.revoked?"REVOKED":"ACTIVE")+"</span>"+
      '<div class="ops"><button class="mini-btn" data-op="rev">'+(t.revoked?"Unrevoke":"Revoke")+'</button>'+
      '<button class="mini-btn danger" data-op="del">Delete</button></div>';
    d.querySelector(".nm").textContent=t.name;
    d.querySelector(".meta").textContent=new Date(t.created).toLocaleDateString()+" · "+
      t.usedMsg+" msgs"+(t.maxMsg?" / "+t.maxMsg+" max":"")+" · ~"+(t.usedTok||0).toLocaleString()+" tokens";
    if(t.maxMsg){
      const pct=Math.min(100,Math.round((t.usedMsg||0)/t.maxMsg*100));
      const u=document.createElement("div");u.className="usage";
      u.innerHTML='<div class="bar"><i style="width:'+pct+'%"></i></div><span>'+(t.usedMsg||0)+" / "+t.maxMsg+" messages ("+pct+"%)</span>";
      d.appendChild(u);
    }
    const k=d.querySelector(".key");k.textContent=t.token;
    k.title="Click to copy token";
    k.addEventListener("click",()=>navigator.clipboard.writeText(t.token).then(()=>toast("Token copied")).catch(()=>toast("Copy failed")));
    d.querySelector('[data-op="rev"]').addEventListener("click",async()=>{
      await api("/api/admin/tokens-action",{method:"POST",body:JSON.stringify({id:t.id,op:"revoke"})});loadTokens();});
    d.querySelector('[data-op="del"]').addEventListener("click",async()=>{
      if(!confirm("Delete token for "+t.name+"?"))return;
      await api("/api/admin/tokens-action",{method:"POST",body:JSON.stringify({id:t.id,op:"delete"})});loadTokens();loadStats();});
    box.appendChild(d);
  });
}
$("ntCreate").addEventListener("click",async()=>{
  const name=$("ntName").value.trim()||"member";
  const maxMsg=Math.max(0,Math.floor(+$("ntMax").value||0));
  try{
    const j=await api("/api/admin/tokens",{method:"POST",body:JSON.stringify({name,maxMsg})});
    $("ntName").value="";$("ntMax").value="";
    await navigator.clipboard.writeText(j.token.token).catch(()=>{});
    toast("Token created & copied: "+j.token.token.slice(0,12)+"…");
    loadTokens();
  }catch(e){toast("Error: "+e.message);}
});
/* ---------- stats ---------- */
async function loadStats(){
  const s=await api("/api/admin/stats");
  const items=[["Tokens",s.tokens],["Active",s.activeTokens],["Messages",s.totalMsg],
    ["~Tokens used",(s.totalTok||0).toLocaleString()],["Last 24h msgs",s.last24h],["Model",String(s.model||"").split("/").pop()]];
  const html=items.map(([l,v])=>'<div class="stat"><div class="v">'+esc(String(v))+'</div><div class="l">'+l+"</div></div>").join("");
  $("statGrid").innerHTML=html;
  $("ovGrid").innerHTML=items.slice(0,4).map(([l,v])=>'<div class="stat"><div class="v">'+esc(String(v))+'</div><div class="l">'+l+"</div></div>").join("");
}
/* ---------- settings ---------- */
async function loadSettings(){
  const s=await api("/api/admin/settings");
  $("sModel").value=s.model||"";$("sSystem").value=s.system||"";
  $("sTemp").value=s.temp;$("sTokens").value=s.maxTokens;$("sAnn").value=s.announcement||"";
}
$("sSave").addEventListener("click",async()=>{
  try{
    await api("/api/admin/settings",{method:"POST",body:JSON.stringify({
      model:$("sModel").value,temp:$("sTemp").value,maxTokens:$("sTokens").value,system:$("sSystem").value})});
    toast("AI settings saved");
  }catch(e){toast("Error: "+e.message);}
});
$("sAnnSave").addEventListener("click",async()=>{
  try{
    await api("/api/admin/settings",{method:"POST",body:JSON.stringify({announcement:$("sAnn").value})});
    toast($("sAnn").value?"Announcement published":"Announcement cleared");
  }catch(e){toast("Error: "+e.message);}
});
/* ---------- boot ---------- */
async function loadAll(){await loadTokens();await loadStats();}
if(ses()){api("/api/admin/stats").then(()=>showDash()).catch(()=>showLogin());}
else showLogin();
