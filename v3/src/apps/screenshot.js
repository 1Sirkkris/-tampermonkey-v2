V3.boot=()=>{
  if(window.top!==window)return;const GUARD='data-bwu2-v3-screenshot-installed';if(document.documentElement.hasAttribute(GUARD))return;document.documentElement.setAttribute(GUARD,'1');
  const ATTR='data-bwu2-v3-screenshot',STYLE='bwu2-v3-screenshot-style';
  const install=()=>{if(document.getElementById(STYLE))return;const s=document.createElement('style');s.id=STYLE;s.textContent='html['+ATTR+'="1"] [data-bwu2-ui]{display:none !important;}html['+ATTR+'="1"] [data-v3-sim-check-cell]::after{display:none !important;}';(document.head||document.documentElement).appendChild(s);};
  const toggle=()=>{install();const root=document.documentElement,on=root.getAttribute(ATTR)==='1';root.setAttribute(ATTR,on?'0':'1');};
  window.addEventListener('keydown',event=>{if(event.repeat||event.defaultPrevented||event.key.toLowerCase()!=='q'||!event.ctrlKey||event.shiftKey||event.altKey||event.metaKey)return;event.preventDefault();event.stopPropagation();toggle();},true);
};