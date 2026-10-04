V3.identity=(()=>{
  const LOGIN=/^[a-z][a-z0-9-]{2,31}$/i;
  const BAD=/^(?:login|username|user|employee|alias|logout|signin|profile|account|settings|search)$/i;
  const normalize=value=>{const v=V3.base.lower(value);return LOGIN.test(v)&&!BAD.test(v)?v:'';};
  const cookie=(doc,name)=>{
    try{for(const part of String(doc.cookie||'').split(';')){const i=part.indexOf('=');if(i<1||part.slice(0,i).trim().toLowerCase()!==name.toLowerCase())continue;let v=part.slice(i+1).trim();try{v=decodeURIComponent(v);}catch{}return v;}}catch{}
    return'';
  };
  function resolve({doc=document,pageWindow=window}={}){
    for(const key of ['employeeLogin','userLogin','autoId','autoID']){
      const value=normalize(pageWindow?.[key]);if(value)return{login:value,source:'global:'+key};
    }
    for(const selector of ['[data-employee-login]','[data-user-login]','[data-autoid]','meta[name="employeeLogin"]','meta[name="autoid"]']){
      const el=doc.querySelector(selector);if(!el)continue;
      const value=normalize(el.dataset?.employeeLogin||el.dataset?.userLogin||el.dataset?.autoid||el.content);if(value)return{login:value,source:'dom:'+selector};
    }
    for(const name of ['employeeLogin','userLogin','autoid']){
      const value=normalize(cookie(doc,name));if(value)return{login:value,source:'cookie:'+name};
    }
    const fc=normalize(cookie(doc,'fcmenu-employeeId'));if(fc)return{login:fc,source:'cookie:fcmenu-employeeId'};
    return{login:'',source:''};
  }
  return Object.freeze({normalize,resolve});
})();