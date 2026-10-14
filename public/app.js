"use strict";
/* ================= utilities ================= */
const $=id=>document.getElementById(id);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store={
  get(k,d){try{const v=localStorage.getItem("sw."+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem("sw."+k,JSON.stringify(v));}catch(e){}},
  del(k){try{localStorage.removeItem("sw."+k);}catch(e){}}
};
let toastT=0;
function toast(m){const t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2600);}
const DOTS='<svg viewBox="0 0 64 40" fill="none"><circle cx="11" cy="27" r="9" fill="#F2A98C"/><circle cx="32" cy="13" r="12" fill="#E07A52"/><circle cx="53" cy="27" r="9" fill="#C96A44"/></svg>';
const logoHTML=cls=>'<span class="ai-logo'+(cls?" "+cls:"")+'">'+DOTS+'</span>';
$("gateLogo").innerHTML=DOTS;$("brandLogo").innerHTML=DOTS;

// Conversations are namespaced per token: two people sharing one browser
// must never see each other's chats. The key is a hash of the token
// (separation, not secrecy — the token itself already lives in storage).
function hashTok(t){let h=5381;const s=String(t||"");for(let i=0;i<s.length;i++){h=((h*33)^s.charCodeAt(i))>>>0;}return h.toString(36);}
function convosKey(){return "convos:"+hashTok(state.token||"");}
function loadConvos(){
  if(!state.token)return [];
  const k=convosKey();let c=store.get(k,null);
  if(c===null){
    // One-time adoption: history saved before namespacing belongs to the
    // token that is logged in now. Afterwards the shared key is deleted.
    c=store.get("convos",[])||[];store.set(k,c);store.del("convos");
  }
  return Array.isArray(c)?c:[];
}
const state={token:store.get("token",null),name:"",conversations:[],
  activeId:null,sending:false,theme:store.get("theme","auto"),dir:store.get("dir","ltr"),
  modelChoice:store.get("modelChoice",null)};
state.conversations=loadConvos();
function persist(){if(state.token)store.set(convosKey(),state.conversations);store.set("theme",state.theme);store.set("dir",state.dir);store.set("modelChoice",state.modelChoice);}
const active=()=>state.conversations.find(c=>c.id===state.activeId)||null;

/* ================= theme / dir ================= */
function applyTheme(){const t=state.theme;
  document.documentElement.dataset.theme=t==="dark"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";}
function applyDir(){document.documentElement.dir=state.dir;}
$("themeBtn").addEventListener("click",()=>{state.theme=state.theme==="dark"?"light":state.theme==="light"?"auto":"dark";
  persist();applyTheme();toast(state.theme==="auto"?"Theme: system":state.theme==="dark"?"Dark mode":"Light mode");});
if(matchMedia("(prefers-color-scheme: dark)").addEventListener)
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{if(state.theme==="auto")applyTheme();});
$("dirBtn").addEventListener("click",()=>{state.dir=state.dir==="ltr"?"rtl":"ltr";persist();applyDir();});
$("menuBtn").addEventListener("click",()=>{
  if(matchMedia("(max-width:860px)").matches)$("app").classList.toggle("sb-open");
  else $("app").classList.toggle("sb-collapsed");});
$("scrim").addEventListener("click",()=>$("app").classList.remove("sb-open"));
$("logoutBtn").addEventListener("click",()=>{store.del("token");location.reload();});

/* ================= gate ================= */
async function verifyToken(tok){
  const r=await fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:tok})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||"Invalid token");
  return j.name;
}
async function enter(){
  const tok=$("gateToken").value.trim();
  if(!tok){$("gateErr").textContent="Enter your token first.";return;}
  $("gateBtn").disabled=true;$("gateErr").textContent="";
  try{const name=await verifyToken(tok);
    state.token=tok;state.name=name;store.set("token",tok);
    // Switching tokens switches history: never show the previous
    // token's conversations to this token.
    state.conversations=loadConvos();state.activeId=null;
    $("gate").hidden=true;$("app").hidden=false;bootChat();
  }catch(e){$("gateErr").textContent=e.message||"Invalid token.";}
  $("gateBtn").disabled=false;
}
$("gateBtn").addEventListener("click",enter);
$("gateToken").addEventListener("keydown",e=>{if(e.key==="Enter")enter();});

/* ================= config (announcement / model) ================= */
async function loadConfig(){
  try{const j=await (await fetch("/api/config")).json();
    if(j.announcement&&store.get("annSeen","")!==""+j.announcement){
      $("announceTxt").textContent=j.announcement;$("announce").hidden=false;
      $("announceX").onclick=()=>{$("announce").hidden=true;store.set("annSeen",""+j.announcement);};
    }
    if(Array.isArray(j.models)&&j.models.length){
      const sel=$("modelSel");sel.innerHTML="";
      const groups={};
      j.models.forEach(m=>{(groups[m.provider]=groups[m.provider]||[]).push(m);});
      Object.keys(groups).forEach(p=>{
        const og=document.createElement("optgroup");og.label=p==="groq"?"Groq":"Gemini";
        groups[p].forEach(m=>{const o=document.createElement("option");
          o.value=p+":"+m.model;o.textContent=m.label||m.model;og.appendChild(o);});
        sel.appendChild(og);
      });
      const def=(j.provider||"gemini")+":"+(j.model||"");
      const sv=state.modelChoice&&state.modelChoice.provider&&state.modelChoice.model
        ?state.modelChoice.provider+":"+state.modelChoice.model:null;
      const has=v=>v&&Array.from(sel.options).some(o=>o.value===v);
      sel.value=has(sv)?sv:has(def)?def:sel.options[0].value;
      state.modelChoice={provider:sel.value.split(":")[0],model:sel.value.slice(sel.value.indexOf(":")+1)};
      persist();
    }
  }catch(e){}
}
$("modelSel").addEventListener("change",()=>{
  const v=$("modelSel").value;
  state.modelChoice={provider:v.split(":")[0],model:v.slice(v.indexOf(":")+1)};
  persist();
});

/* ================= history ================= */
function dayGroup(ts){const d=new Date(ts),n=new Date();
  const day=x=>{const t=new Date(x);t.setHours(0,0,0,0);return t.getTime();};
  const df=(day(n)-day(d))/864e5;
  if(df<=0)return "Today";if(df<=1)return "Yesterday";if(df<7)return "Previous 7 days";return "Older";}
function newChat(){const c={id:uid(),title:"New conversation",messages:[],created:Date.now(),updated:Date.now()};
  state.conversations.unshift(c);state.activeId=c.id;persist();renderHistory();renderChat();
  if(matchMedia("(max-width:860px)").matches)$("app").classList.remove("sb-open");
  $("prompt").focus();}
function renderHistory(){
  const q=$("histSearch").value.trim().toLowerCase(),box=$("history");box.innerHTML="";
  const list=state.conversations.filter(c=>!q||c.title.toLowerCase().includes(q)||c.messages.some(m=>m.text.toLowerCase().includes(q)));
  if(!list.length){box.innerHTML='<div class="hist-empty">No conversations yet</div>';return;}
  let lg="";
  list.forEach(c=>{const g=dayGroup(c.updated);
    if(g!==lg){lg=g;const h=document.createElement("div");h.className="hist-group";h.textContent=g;box.appendChild(h);}
    const b=document.createElement("button");b.className="hist-item"+(c.id===state.activeId?" active":"");
    const t=document.createElement("span");t.className="t";t.textContent=c.title;b.appendChild(t);
    const del=document.createElement("span");del.className="del";del.title="Delete";del.setAttribute("role","button");del.tabIndex=0;
    del.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/></svg>';
    const rm=e=>{e.stopPropagation();state.conversations=state.conversations.filter(x=>x.id!==c.id);
      if(state.activeId===c.id)state.activeId=state.conversations[0]?state.conversations[0].id:null;
      persist();renderHistory();renderChat();toast("Chat deleted");};
    del.addEventListener("click",rm);
    del.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();rm(e);}});
    b.appendChild(del);
    b.addEventListener("click",()=>{state.activeId=c.id;persist();renderHistory();renderChat();
      if(matchMedia("(max-width:860px)").matches)$("app").classList.remove("sb-open");});
    box.appendChild(b);});
}
$("newChatTop").addEventListener("click",newChat);
$("histSearch").addEventListener("input",renderHistory);

/* ================= markdown ================= */
function md(src){
  const blocks=[];let t=String(src).replace(/\r/g,"");
  t=t.replace(/```(\w*)\n([\s\S]*?)(?:```|$)/g,(m,l,c)=>{blocks.push({l:l||"text",c:c.replace(/\n$/,"")});return "\u0000"+(blocks.length-1)+"\u0000";});
  const inl=s=>esc(s)
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  const html=t.split("\n").map(line=>{
    const bm=line.match(/^\u0000(\d+)\u0000$/);if(bm)return bm[0];
    let m;
    if(m=line.match(/^(#{1,3})\s+(.*)/))return "<h"+m[1].length+">"+inl(m[2])+"</h"+m[1].length+">";
    if(m=line.match(/^>\s?(.*)/))return "<blockquote>"+inl(m[1])+"</blockquote>";
    if(m=line.match(/^\s*[-*]\s+(.*)/))return "<li>"+inl(m[1])+"</li>";
    if(m=line.match(/^\s*\d+\.\s+(.*)/))return "<li>"+inl(m[1])+"</li>";
    if(!line.trim())return "";
    return "<p>"+inl(line)+"</p>";
  }).join("\n")
    .replace(/(<li>.*<\/li>\n?)+/g,s=>"<ul>"+s+"</ul>").replace(/<\/ul><ul>/g,"")
    .replace(/\u0000(\d+)\u0000/g,(m,i)=>{const b=blocks[+i];
      return '<pre><div class="code-head"><span>'+esc(b.l)+'</span><button class="code-copy" data-code="'+esc(b.c)+'">Copy</button></div><code>'+esc(b.c)+"</code></pre>";});
  return html;
}
document.addEventListener("click",e=>{const b=e.target.closest(".code-copy");if(!b)return;
  navigator.clipboard.writeText(b.dataset.code).then(()=>toast("Code copied")).catch(()=>toast("Copy failed"));});

/* ================= chat render ================= */
const CARDS=[["✍️","Help me write a professional email"],["💡","Explain a difficult concept simply"],
  ["💻","Give me startup ideas for 2026"],["🚀","Write a workout plan for beginners"]];
function renderChat(){
  const col=$("chatCol");col.innerHTML="";
  const c=active();$("chatTitle").textContent=c?c.title:"New conversation";
  if(!c||!c.messages.length){
    const h=document.createElement("div");h.id="home";
    h.innerHTML=logoHTML("")+"<h1>How can I help you today?</h1><p>I'm SOL.ai, your AI assistant"+(state.name?", "+esc(state.name):"")+". Ask me anything.</p>";
    const cw=document.createElement("div");cw.className="cards";
    CARDS.forEach(([ic,tx])=>{const b=document.createElement("button");b.className="card";
      const s1=document.createElement("span");s1.className="ci";s1.textContent=ic;
      const s2=document.createElement("span");s2.textContent=tx;
      b.appendChild(s1);b.appendChild(s2);
      b.addEventListener("click",()=>{$("prompt").value=tx;autosize();$("prompt").focus();});
      cw.appendChild(b);});
    h.appendChild(cw);col.appendChild(h);return;
  }
  c.messages.forEach(m=>col.appendChild(buildMsg(m)));
  requestAnimationFrame(()=>{$("chat").scrollTop=$("chat").scrollHeight;});
}
function buildMsg(m){
  const d=document.createElement("div");d.className="msg "+m.role;
  if(m.role==="user"){const b=document.createElement("div");b.className="bubble";b.textContent=m.text;d.appendChild(b);}
  else{
    d.innerHTML=logoHTML("");
    const body=document.createElement("div");body.className="body";body.dir="auto";body.innerHTML=md(m.text);
    const acts=document.createElement("div");acts.className="msg-actions";
    acts.innerHTML=
      '<button class="act-btn" data-a="copy" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>'+
      '<button class="act-btn" data-a="retry" title="Retry"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>'+
      '<button class="act-btn" data-a="like" title="Like"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2Z"/></svg></button>';
    body.appendChild(acts);d.appendChild(body);
  }
  return d;
}
$("chatCol").addEventListener("click",e=>{
  const b=e.target.closest(".act-btn");if(!b)return;
  const msgEl=b.closest(".msg"),col=$("chatCol");
  const idx=Array.from(col.querySelectorAll(".msg.assistant")).indexOf(msgEl);
  const c=active();if(!c)return;
  const m=c.messages.filter(x=>x.role==="assistant")[idx];if(!m)return;
  if(b.dataset.a==="copy")navigator.clipboard.writeText(m.text).then(()=>toast("Copied")).catch(()=>toast("Copy failed"));
  else if(b.dataset.a==="like")b.classList.toggle("liked");
  else if(b.dataset.a==="retry"){
    c.messages=c.messages.filter(x=>x!==m);
    const li=c.messages.map((x,i)=>x.role==="user"?i:-1).filter(i=>i>=0).pop();
    let ut="";if(li!==undefined&&li>=0){ut=c.messages[li].text;c.messages.splice(li,1);}
    persist();renderChat();if(ut)send(ut);
  }
});

/* ================= send (SSE via server) ================= */
function autosize(){const p=$("prompt");p.style.height="auto";p.style.height=Math.min(p.scrollHeight,180)+"px";
  $("sendBtn").disabled=!p.value.trim()||state.sending;}
$("prompt").addEventListener("input",autosize);
$("prompt").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();trySend();}});
$("sendBtn").addEventListener("click",trySend);
function trySend(){const t=$("prompt").value.trim();if(!t||state.sending)return;send(t);}
async function send(text){
  let c=active();if(!c){newChat();c=active();}
  c.messages.push({role:"user",text});c.updated=Date.now();
  if(c.messages.filter(m=>m.role==="user").length===1)c.title=text.slice(0,42)+(text.length>42?"…":"");
  persist();renderHistory();renderChat();
  $("prompt").value="";autosize();
  state.sending=true;$("sendBtn").disabled=true;
  const col=$("chatCol");
  const think=document.createElement("div");think.className="msg assistant";
  think.innerHTML=logoHTML("thinking")+'<div style="flex:1;min-width:0"><div class="ai-thinking"><span class="wave"><i></i><i></i><i></i></span></div></div>';
  col.appendChild(think);$("chat").scrollTop=$("chat").scrollHeight;
  const body=document.createElement("div");body.className="body";body.dir="auto";
  const caret=document.createElement("span");caret.className="caret";
  let started=false,streamed="",paintId=0,lastPaint=0;
  const paint=()=>{paintId=0;const now=Date.now();
    if(now-lastPaint<90){paintId=requestAnimationFrame(paint);return;}
    lastPaint=now;body.innerHTML=md(streamed);body.appendChild(caret);
    const ch=$("chat");if(ch.scrollHeight-ch.scrollTop-ch.clientHeight<120)ch.scrollTop=ch.scrollHeight;};
  const schedule=()=>{if(!paintId)paintId=requestAnimationFrame(paint);};
  const actionsHTML=
    '<button class="act-btn" data-a="copy" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>'+
    '<button class="act-btn" data-a="retry" title="Retry"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>'+
    '<button class="act-btn" data-a="like" title="Like"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2Z"/></svg></button>';
  const settle=html=>{if(paintId)cancelAnimationFrame(paintId);
    think.innerHTML=logoHTML("");
    const wrap=document.createElement("div");wrap.style.flex="1";wrap.style.minWidth="0";
    wrap.appendChild(body);body.innerHTML=html;
    const acts=document.createElement("div");acts.className="msg-actions";acts.innerHTML=actionsHTML;
    wrap.appendChild(acts);think.appendChild(wrap);
    $("chat").scrollTop=$("chat").scrollHeight;};
  try{
    const msgs=c.messages.filter(m=>!m.text.startsWith("Error:")).map(m=>({role:m.role,text:m.text}));
    const mc=state.modelChoice||{};
    const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:state.token,messages:msgs,provider:mc.provider,model:mc.model})});
    if(!res.ok){let em="Request failed";try{const j=await res.json();if(j.error)em=j.error;}catch(e){}
      if(res.status===403){store.del("token");em+=" — token invalid. Reload and enter a valid token.";}
      throw new Error(em);}
    const reader=res.body.getReader(),dec=new TextDecoder();let buf="";
    for(;;){const r=await reader.read();if(r.done)break;
      buf+=dec.decode(r.value,{stream:true});
      const lines=buf.split("\n");buf=lines.pop();
      for(const ln of lines){const t=ln.trim();if(!t.startsWith("data:"))continue;
        const p=t.slice(5).trim();if(!p||p==="[DONE]")continue;
        try{const j=JSON.parse(p);
          const ps=j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts;
          if(ps)ps.forEach(x=>{if(x.text)streamed+=x.text;});
          if(streamed){if(!started){started=true;
              think.innerHTML=logoHTML("");
              const w=document.createElement("div");w.style.flex="1";w.style.minWidth="0";w.appendChild(body);think.appendChild(w);}
            schedule();}
        }catch(e){}}
    }
    settle(md(streamed)||"<p><em>Empty response.</em></p>");
    c.messages.push({role:"assistant",text:streamed});
  }catch(err){
    const em=(err&&err.message)||"Something went wrong";
    streamed="Error: "+em;settle("<p><em>Error: "+esc(em)+"</em></p>");
    c.messages.push({role:"assistant",text:streamed});
  }
  c.updated=Date.now();persist();renderHistory();
  state.sending=false;$("sendBtn").disabled=false;autosize();
}

/* ================= boot ================= */
function bootChat(){loadConfig();renderHistory();renderChat();autosize();}
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();if(!$("app").hidden)newChat();}
  if(e.key==="Escape")$("app").classList.remove("sb-open");
});
applyTheme();applyDir();
(async()=>{
  if(state.token){
    try{state.name=await verifyToken(state.token);
      $("gate").hidden=true;$("app").hidden=false;bootChat();return;
    }catch(e){store.del("token");state.token=null;}
  }
  $("gate").hidden=false;
})();
