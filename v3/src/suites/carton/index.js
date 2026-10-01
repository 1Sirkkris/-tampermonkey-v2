V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('carton');
  const telemetry=V3.telemetry.create('carton',VERSION);
  const settings=V3.storage.create('carton.settings');
  const BARCODE_ID='input-page-barcode-container-tertiary-text';
  const BUTTON_ID='input-page-button-container-button';
  const BARCODE_RE=/(csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})/i;
  const COUNT_RE=/Barcodes scanned:\s*(\d+)/i;
  let enabled=settings.get('enabled',true)!==false;
  let completedIdentity='';
  let observer=null,observerTarget=null;

  const host=document.createElement('div');host.id='bwu2-v3-carton';host.dataset.bwu2V3Ui='1';
  const shadow=host.attachShadow({mode:'open'});
  document.body.appendChild(host);
  shadow.innerHTML='<style>:host{all:initial;position:fixed;z-index:2147482500;right:12px;bottom:12px;font:800 12px Arial}button{border:2px solid #66758a;border-radius:9px;padding:7px 10px;background:#151a22;color:#fff;cursor:pointer}button[data-on="1"]{border-color:#65f08f}button[data-on="0"]{border-color:#ff655d;color:#ffb5b1}</style><button data-toggle></button>';
  V3.screenshot.install({life,roots:[host]});
  const toggle=shadow.querySelector('[data-toggle]');
  const paint=()=>{toggle.dataset.on=enabled?'1':'0';toggle.textContent='Carton AutoComplete: '+(enabled?'ON':'OFF');};
  toggle.onclick=()=>{enabled=!enabled;settings.set('enabled',enabled);paint();inspect();};
  paint();

  const count=()=>{const m=String(document.body?.innerText||'').match(COUNT_RE);return m?Number(m[1]):0;};
  const click=button=>['pointerdown','mousedown','mouseup','click'].forEach(type=>button.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true})));
  const beep=()=>{
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      const ctx=new Audio();const base=ctx.currentTime+.01;
      for(const offset of [0,.22]){const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=850;g.gain.setValueAtTime(.08,base+offset);g.gain.exponentialRampToValueAtTime(.001,base+offset+.09);o.start(base+offset);o.stop(base+offset+.1);}
    }catch{}
  };
  function inspect(){
    if(!enabled)return;
    const barcodeEl=document.getElementById(BARCODE_ID);
    if(!barcodeEl)return;
    const barcode=V3.base.clean(barcodeEl.innerText||barcodeEl.textContent);
    const scanned=count();
    if(!barcode||!BARCODE_RE.test(barcode)||scanned<2)return;
    const identity=barcode+'|'+scanned;
    if(identity===completedIdentity)return;
    const button=document.getElementById(BUTTON_ID);
    if(!button){telemetry.emit('ready-no-button',{barcode:V3.telemetry.mask(barcode),scanned});return;}
    click(button);beep();completedIdentity=identity;
    telemetry.emit('complete',{barcode:V3.telemetry.mask(barcode),scanned});
  }
  function attach(){
    const barcode=document.getElementById(BARCODE_ID);
    const target=barcode?.parentElement||document.body;
    if(!target||target===observerTarget)return;
    observer?.disconnect();observerTarget=target;
    observer=life.observe(target,inspect,{subtree:true,childList:true,characterData:true});
    inspect();
  }
  // One bounded/narrow observer owner; no interaction watchdog or polling loop.
  life.observe(document.body,records=>{
    if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n?.id===BARCODE_ID||n?.querySelector?.('#'+BARCODE_ID))))attach();
    inspect();
  },{childList:true,subtree:true});
  attach();
  life.on(window,'pagehide',()=>observer?.disconnect(),{once:true});
};