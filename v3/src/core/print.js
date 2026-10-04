V3.print=(()=>{
  const hex=value=>Array.from(new TextEncoder().encode(String(value??''))).map(b=>b.toString(16).padStart(2,'0')).join('');
  async function barcode(code,{description='',quantity=1,telemetry}={}){
    const value=V3.base.clean(code);if(!value)throw new Error('Barcode required');
    const url='http://localhost:5965/printer?action=print&type=barcode&data='+hex(value)+'&text='+hex(value)+'&quantity='+V3.base.clamp(quantity,1,999)+'&desc='+hex(V3.base.clean(description))+'&seq='+Date.now();
    const result=await V3.transport.gm(url,{timeout:5000});
    telemetry?.emit('print',{code:V3.telemetry.mask(value),status:result.status,hasDescription:Boolean(description)});
    return result;
  }
  return Object.freeze({barcode});
})();