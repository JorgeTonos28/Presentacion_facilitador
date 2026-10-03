(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let pin = sessionStorage.getItem('facilitatorPin') || '';
  let guide = null;
  let serverState = null;
  let clockOffset = 0;
  let busy = false;

  const fmt = seconds => {
    seconds = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  };
  const signed = seconds => `${seconds > 0 ? '+' : '−'}${fmt(Math.abs(seconds))}`;

  function authHeaders(extra={}) { return {'x-facilitator-pin':pin,...extra}; }

  async function loadGuide(candidatePin) {
    pin = candidatePin;
    const r = await fetch('/api/guide',{headers:{'x-facilitator-pin':pin},cache:'no-store'});
    if(!r.ok) throw new Error('PIN incorrecto');
    const data = await r.json();
    guide = data.guide;
    sessionStorage.setItem('facilitatorPin',pin);
    populateJump();
    $('login').classList.add('hidden');
    $('console').classList.remove('hidden');
    await sync();
  }

  function populateJump(){
    $('jump').replaceChildren(...guide.slides.map(s=>{
      const o=document.createElement('option');
      o.value=s.slide;
      o.textContent=`${String(s.slide).padStart(2,'0')} · ${s.title}`;
      return o;
    }));
  }

  function timerSnapshot(){
    if(!serverState) return {elapsed:0,slideElapsed:0};
    const now=Date.now()+clockOffset;
    const live=serverState.running&&serverState.startedAt?Math.max(0,now-serverState.startedAt):0;
    const slideLive=serverState.running&&serverState.slideStartedAt?Math.max(0,now-serverState.slideStartedAt):0;
    return {
      elapsed:(serverState.accumulatedMs+live)/1000,
      slideElapsed:(serverState.slideAccumulatedMs+slideLive)/1000
    };
  }

  function currentGuide(){
    return guide?.slides?.[Math.max(0,(serverState?.slide||1)-1)];
  }

  function paint(){
    if(!guide||!serverState) return;
    const g=currentGuide(), snap=timerSnapshot();
    $('section').textContent=g.section;
    $('slide-title').textContent=g.title;
    $('slide-number').textContent=g.slide;
    $('sticky-slide-number').textContent=g.slide;
    $('script').textContent=g.script;
    $('action').textContent=g.action||'—';
    $('transition').textContent=g.transition||'—';
    $('action-card').style.display=g.action?'block':'none';
    $('transition-card').style.display=g.transition?'block':'none';
    $('next-title').textContent=guide.slides[g.slide]?.title||'Fin de la presentación';
    $('jump').value=String(g.slide);

    const atSessionStart = snap.elapsed <= 0.001 && !serverState.running;
    const slideEntryElapsed = Math.max(0, snap.elapsed - snap.slideElapsed);
    const effectiveBudget = atSessionStart
      ? g.durationSec
      : Math.max(0, g.endSec - slideEntryElapsed);
    const remain = g.endSec - snap.elapsed;

    $('slide-time').textContent=`${fmt(snap.slideElapsed)} / ${fmt(effectiveBudget)}`;
    $('sticky-slide-time').textContent=`${fmt(snap.slideElapsed)} / ${fmt(effectiveBudget)}`;
    $('session-time').textContent=`${fmt(snap.elapsed)} / ${fmt(guide.totalDurationSec)}`;
    $('global-status').textContent=`Meta acumulada ${fmt(g.endSec)}`;

    const card=$('slide-time-card');
    const sticky=$('sticky-slide-status');
    card.classList.remove('ok','warn','over');
    sticky.classList.remove('ok','warn','over');
    if(remain<0){
      card.classList.add('over');
      sticky.classList.add('over');
      const status=`Pasado por ${fmt(-remain)}`;
      $('slide-status').textContent=status;
      $('sticky-slide-state').textContent=status;
    } else if(remain<=8){
      card.classList.add('warn');
      sticky.classList.add('warn');
      const status=`Quedan ${Math.ceil(remain)} s`;
      $('slide-status').textContent=status;
      $('sticky-slide-state').textContent=status;
    } else {
      card.classList.add('ok');
      sticky.classList.add('ok');
      $('slide-status').textContent='En tiempo';
      $('sticky-slide-state').textContent='En tiempo';
    }

    $('timer-toggle').textContent=serverState.running?'⏸ Pausar cronómetro':'▶ Iniciar cronómetro';
    $('prev').disabled=g.slide<=1;
    $('next').disabled=g.slide>=guide.slides.length;
  }

  async function sync(){
    try{
      const r=await fetch('/api/state',{cache:'no-store'});
      if(!r.ok) throw new Error('Sin conexión');
      const data=await r.json();
      clockOffset=Number(data.serverNow||Date.now())-Date.now();
      serverState=data.state;
      $('connection').textContent='● Sincronizado con la presentación';
      $('connection').classList.remove('bad');
      paint();
    }catch(_){
      $('connection').textContent='● Sin conexión. Reintentando…';
      $('connection').classList.add('bad');
    }
  }

  async function control(action,value){
    if(busy) return;
    busy=true;
    try{
      const r=await fetch('/api/control',{
        method:'POST',
        headers:authHeaders({'content-type':'application/json'}),
        body:JSON.stringify({action,value})
      });
      if(r.status===401){
        sessionStorage.removeItem('facilitatorPin');
        location.reload();
        return;
      }
      if(!r.ok) throw new Error('No se pudo ejecutar');
      const data=await r.json();
      clockOffset=Number(data.serverNow||Date.now())-Date.now();
      serverState=data.state;
      paint();
    }catch(_){
      $('connection').textContent='● No se pudo enviar el control';
      $('connection').classList.add('bad');
    } finally {
      busy=false;
    }
  }

  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault();
    $('login-error').textContent='';
    try{
      await loadGuide($('pin').value.trim());
    }catch(err){
      $('login-error').textContent=err.message||'No se pudo entrar';
    }
  });
  $('prev').addEventListener('click',()=>control('prev'));
  $('next').addEventListener('click',()=>control('next'));
  $('timer-toggle').addEventListener('click',()=>control('toggleTimer'));
  $('timer-reset').addEventListener('click',()=>{
    if(confirm('¿Reiniciar el cronómetro a 00:00?')) control('resetTimer');
  });
  $('jump').addEventListener('change',e=>control('goto',Number(e.target.value)));
  addEventListener('keydown',e=>{
    if($('console').classList.contains('hidden')) return;
    if(e.key==='ArrowRight') control('next');
    if(e.key==='ArrowLeft') control('prev');
  });

  setInterval(()=>{if(guide&&serverState)paint();},150);
  setInterval(()=>{if(guide)sync();},500);
  if(pin){
    loadGuide(pin).catch(()=>{
      sessionStorage.removeItem('facilitatorPin');
      pin='';
    });
  }
})();
