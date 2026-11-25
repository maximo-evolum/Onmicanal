/** Genera el PDF de Broker OS desde las mismas filas autorizadas que la vista previa y el CSV. */
import PDFDocument from "pdfkit";
import {states,types,selection} from "../services/broker-executive-report.service.js";

export async function brokerReportPdf(r) {
  const doc=new PDFDocument({size:"A4",margin:0,autoFirstPage:false,info:{Title:"Broker OS | Reporte ejecutivo de negocios"}});
  const result=new Promise((resolve,reject)=>{const parts=[];doc.on("data",chunk=>parts.push(chunk));doc.once("end",()=>resolve(Buffer.concat(parts)));doc.once("error",reject);});
  const x=42,w=511,bottom=786;
  let page=0,y=0;
  function newPage(){
    doc.addPage();page++;y=65;
    doc.rect(0,0,596,43).fill("#163c42");doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text("BROKER OS   /   DIRECCIÓN",x,17,{lineBreak:false});
    doc.font("Helvetica").fontSize(9).fillColor("#4e676b").text("Reporte ejecutivo  |  "+r.generatedAt.slice(0,10)+" UTC",x,808,{lineBreak:false});
    doc.text("Página "+page,485,808,{width:68,align:"right"});
  }
  function line(value,size=10,bold=false,color="#244046",space=4){
    const s=String(value).replace(/[\r\n\t]/g," ");doc.font(bold?"Helvetica-Bold":"Helvetica").fontSize(size);
    const h=doc.heightOfString(s,{width:w});
    if(y+h>bottom){newPage();doc.font(bold?"Helvetica-Bold":"Helvetica").fontSize(size);}
    doc.fillColor(color).text(s,x,y,{width:w});y+=h+space;
  }
  newPage();line("Reporte ejecutivo de negocios",23,true);line(r.scope+"  |  Emitido "+r.generatedAt.slice(11,16)+" UTC",10,false,"#547175",12);
  line(selection(r).join("   ·   "),10,true);line(r.notice,10,false,"#547175",12);
  const s=r.summary;
  line(s.total+" negocios   ·   "+s.counts.OPEN+" en curso   ·   "+s.counts.CLOSED+" finalizados",14,true);
  line(s.counts.LOST+" perdidos o cancelados   ·   "+s.counts.REVIEW+" por revisar   ·   "+s.incomplete+" con datos incompletos");
  line("Monto declarado en curso: "+(s.openAmounts.map(v=>v.basis+": "+v.currency+" "+new Intl.NumberFormat("es-CL",{maximumFractionDigits:6}).format(v.amount)).join("  /  ")||"sin montos con moneda informada"),10,true,"#12645f",14);
  line("Detalle y evidencia",14,true);
  if(!r.rows.length)line("No hay negocios que coincidan con el período, los filtros y el alcance autorizado.");
  for(const item of r.rows){
    const entries=[[item.title,12,true],[item.company+"  ·  "+types[item.type]+"  ·  "+states[item.state]+"  ·  "+(item.stage||"Sin etapa").replaceAll("_"," "),10],
      [item.broker+"  /  "+(item.office||"Sin oficina")+"  ·  Creación: "+item.opened,10],
      [item.amount!==null?(item.amountSource+": "+new Intl.NumberFormat("es-CL",{maximumFractionDigits:6}).format(item.amount)+" "+(item.currency||"(moneda no informada)") ):"Monto no informado",10],
      ["ID fuente: "+item.id+"   ·   Actualizado: "+item.updated.slice(0,16).replace("T"," ")+" UTC",9],
      ...(item.warnings.length?[["Revisar: "+item.warnings.join("; "),9,false,"#834c14"]]:[])];
    const height=entries.reduce((n,[value,size,bold])=>n+doc.font(bold?"Helvetica-Bold":"Helvetica").fontSize(size).heightOfString(value,{width:w})+4,14);
    if(y+height>bottom)newPage();
    doc.moveTo(x,y).lineTo(x+w,y).strokeColor("#c9d9d8").stroke();y+=8;
    for(const e of entries)line(...e);y+=6;
  }
  doc.end();return result;
}
