import {clean}from'./ui-tools.mjs';
export function resolveIdentity(window,page=window){
 const normalize=value=>{const raw=clean(value).toLowerCase();return /^[a-z][a-z0-9-]{2,31}$/.test(raw)&&!/^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|signin|profile|account|settings|search)$/.test(raw)?raw:'';};
 const candidates=[];
 const add=(value,source)=>{const login=normalize(value);if(login)candidates.push({login,source});};
 for(const key of ['employeeLogin','userLogin','autoId','autoID'])add(page[key],'native-global:'+key);
 for(const name of ['currentUser','employee','bootstrapData','__INITIAL_STATE__']){
   const value=page[name];if(!value||typeof value!=='object')continue;
   for(const key of ['employeeLogin','userLogin','username','login','alias','autoId','autoID'])add(value[key],'native-state:'+name+'.'+key);
   for(const child of ['currentUser','user','employee','identity'])if(value[child]&&typeof value[child]==='object')for(const key of ['employeeLogin','userLogin','username','login','alias'])add(value[child][key],'native-state:'+name+'.'+child+'.'+key);
 }
 for(const node of window.document.querySelectorAll('[data-employee-login],[data-user-login],[data-username],[data-autoid],meta[name=employeeLogin],meta[name=username],meta[name=autoid],.app-user-name,.nav-user,.user-name,[data-test-id="user-name"]'))add(node.dataset.employeeLogin||node.dataset.userLogin||node.dataset.username||node.dataset.autoid||node.content||node.value||node.textContent,'native-dom');
 for(const raw of window.document.cookie.split(';')){const[key,...values]=raw.trim().split('=');if(['employeeLogin','userLogin','username','autoid'].includes(key)){let value=values.join('=');try{value=decodeURIComponent(value);}catch{}add(value,'native-cookie:'+key);}}
 const distinct=[...new Set(candidates.map(row=>row.login))];if(distinct.length!==1)throw new Error(distinct.length?'Authenticated identities conflict — refresh native session':'Authenticated employee identity unavailable');
 return{login:distinct[0],source:candidates.find(row=>row.login===distinct[0]).source};
}
