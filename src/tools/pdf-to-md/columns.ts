import type {TextPart} from './text';
import {detectTables} from './tables';
const size=(p:TextPart)=>Math.hypot(p.transform[2],p.transform[3])||p.height||12;
export function restoreReadingOrder(parts:TextPart[],width:number,height:number):{parts:TextPart[];reordered:boolean}{
 if(parts.some(p=>p.dir==='rtl'||p.dir==='ttb'))return {parts,reordered:false};
 const sizes=parts.filter(p=>p.str.trim()).map(size).sort((a,b)=>a-b);const body=sizes[Math.floor(sizes.length/2)]??12;
 const tableParts=new Set(detectTables(parts).flatMap(t=>[...t.parts]));
 const content=parts.filter(p=>p.str.trim()&&!tableParts.has(p)&&size(p)>=body*0.85&&size(p)<=body*1.25&&p.transform[5]>height*0.08&&p.transform[5]<height*0.9);
 let gutter:number|undefined;let best=-Infinity;
 for(let candidate=width*0.3;candidate<=width*0.7;candidate+=width*0.02){
  const left=content.filter(p=>p.transform[4]+p.width<candidate-body);const right=content.filter(p=>p.transform[4]>candidate+body);
  if(left.length+right.length!==content.length||left.length<3||right.length<3)continue;
  if(left.reduce((n,p)=>n+p.str.length,0)<60||right.reduce((n,p)=>n+p.str.length,0)<60)continue;
  const ys=(items:TextPart[])=>items.map(p=>p.transform[5]);
  if(Math.min(Math.max(...ys(left)),Math.max(...ys(right)))-Math.max(Math.min(...ys(left)),Math.min(...ys(right)))<body*2)continue;
  if(new Set(ys(left).map(y=>Math.round(y/2))).size<3||new Set(ys(right).map(y=>Math.round(y/2))).size<3)continue;
  const end=Math.max(...left.map(p=>p.transform[4]+p.width));const start=Math.min(...right.map(p=>p.transform[4]));
  const gap=start-end;if(gap<body*3)continue;
  if(Math.min(...left.map(p=>p.transform[4]))>width*0.3||Math.min(...right.map(p=>p.transform[4]))<width*0.45)continue;
  const score=gap-Math.abs((start+end)/2-width/2)*0.01;if(score>best){gutter=(start+end)/2;best=score;}
 }
 if(gutter===undefined)return {parts,reordered:false};
 const cut=gutter;const rows:{y:number;parts:TextPart[]}[]=[];
 for(const part of [...parts].sort((a,b)=>a.transform[5]-b.transform[5]||a.transform[4]-b.transform[4])){
  let row=rows.at(-1);if(!row||Math.abs(row.y-part.transform[5])>Math.max(2,size(part)*0.3)){row={y:part.transform[5],parts:[]};rows.push(row);}row.parts.push(part);
 }
 const result:TextPart[]=[];let band:TextPart[]=[];
 const flush=()=>{result.push(...band.filter(p=>p.transform[4]+p.width<=cut),...band.filter(p=>p.transform[4]+p.width>cut));band=[];};
 for(const row of rows){
  if(row.parts.some(p=>tableParts.has(p)||(p.transform[4]<cut&&p.transform[4]+p.width>cut))){flush();result.push(...row.parts);}else band.push(...row.parts);
 }
 flush();return {parts:result,reordered:true};
}
