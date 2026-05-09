// @title Vector Pattern FX
// @description Generates editable vector pattern effects from selected Affinity artwork.
// @author S1m0nP1
// @version 1.0.0
// @affinity 3.2+
// @verified true
// @homepage https://s1m0np1.github.io/affinity-script-installer/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags vector, pattern, effects
// @image images/FX.png

"use strict";

const { Document } = require("/document");
const { Dialog, DialogResult } = require("/dialog");
const { AddChildNodesCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require("/commands");
const { BlendMode } = require("affinity:common");
const { ContainerNodeDefinition, PolyCurveNodeDefinition, ShapeNodeDefinition } = require("/nodes");
const { ShapeRectangle } = require("/shapes");
const { Selection } = require("/selections");
const { Transform, CurveBuilder, PolyCurve, Rectangle } = require("/geometry");
const { UnitType } = require("/units");
const { RGBA8 } = require("/colours");
const { FillDescriptor } = require("/fills");
const { LineStyleDescriptor, LineCap, LineJoin } = require("/linestyle");

function exec(doc,cmd,preview){return doc.executeCommand(cmd,!!preview);}
function clearDocumentPreviews(doc){
  try{
    if(typeof doc.clearPreviews==="function") doc.clearPreviews();
    else exec(doc,DocumentCommand.createClearPreviews(),false);
  }catch(e){
    try{exec(doc,DocumentCommand.createClearPreviews(),false);}catch(_e){}
  }
}
function makeRng(seed){let s=seed>>>0||1;return()=>{s+=0x6d2b79f5;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
function hslToRgb(h,s,l){const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;function ch(t){const tt=((t%1)+1)%1;if(tt<1/6)return p+(q-p)*6*tt;if(tt<1/2)return q;if(tt<2/3)return p+(q-p)*(2/3-tt)*6;return p;}return{r:Math.round(ch(h+1/3)*255),g:Math.round(ch(h)*255),b:Math.round(ch(h-1/3)*255)};}
function boxToPlain(b){
  if(!b)return null;
  const x=(typeof b.x==="number")?b.x:((typeof b.left==="number")?b.left:0);
  const y=(typeof b.y==="number")?b.y:((typeof b.top==="number")?b.top:0);
  const width=(typeof b.width==="number")?b.width:((typeof b.right==="number")?b.right-x:0);
  const height=(typeof b.height==="number")?b.height:((typeof b.bottom==="number")?b.bottom-y:0);
  return{x,y,width,height};
}
function nodeTypeName(n){try{return String(n.type||n.nodeType||n.kind||(n.constructor&&n.constructor.name)||"");}catch(e){return"";}}
function isLikelyArtboard(n){
  if(!n)return false;
  if(n.isArtboard===true)return true;
  const t=nodeTypeName(n).toLowerCase();
  if(t.indexOf("artboard")>=0)return true;
  try{if(String(n.name||n.label||"").toLowerCase().indexOf("artboard")>=0&&typeof n.getSpreadBaseBox==="function")return true;}catch(e){}
  return false;
}
function getNodeBox(n){
  if(!n)return null;
  let b=null;
  // Artboards must use spread coordinates. baseBox stays local after artboard translation.
  try{if(typeof n.getSpreadBaseBox==="function")b=n.getSpreadBaseBox(false);}catch(e){}
  if(!b){try{b=n.exactSpreadBaseBox;}catch(e){}}
  if(!b){try{if(typeof n.getSpreadBaseBox==="function")b=n.getSpreadBaseBox(true);}catch(e){}}
  if(!b){try{b=n.spreadVisibleBox;}catch(e){}}
  return boxToPlain(b);
}
function getChildren(container){
  if(!container)return[];
  const props=["children","childNodes","nodes"];
  for(let p=0;p<props.length;p++){
    let c=null;
    try{c=container[props[p]];}catch(e){}
    if(typeof c==="function"){try{c=c.call(container);}catch(e){c=null;}}
    if(!c)continue;
    if(Array.isArray(c))return c.filter(Boolean);
    if(typeof c.length==="number"){
      const out=[];
      for(let i=0;i<c.length;i++){
        try{out.push(typeof c.at==="function"?c.at(i):c[i]);}catch(e){}
      }
      return out.filter(Boolean);
    }
  }
  try{
    if(typeof container.childCount==="number"&&typeof container.childAt==="function"){
      const out=[];
      for(let i=0;i<container.childCount;i++)out.push(container.childAt(i));
      return out.filter(Boolean);
    }
  }catch(e){}
  return[];
}
function getArtboards(spread){
  return getChildren(spread).filter(isLikelyArtboard).sort((a,b)=>{
    const ab=getNodeBox(a)||{x:0,y:0},bb=getNodeBox(b)||{x:0,y:0};
    if(Math.abs(ab.y-bb.y)>2)return ab.y-bb.y;
    return ab.x-bb.x;
  });
}
function containsPoint(r,x,y){return r&&x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height;}
function findArtboardForNode(artboards,node){
  if(!artboards||!artboards.length)return null;
  if(isLikelyArtboard(node))return node;
  const bb=getNodeBox(node);
  if(!bb)return artboards[0];
  const cx=bb.x+bb.width/2,cy=bb.y+bb.height/2;
  for(let i=0;i<artboards.length;i++){
    const ab=getNodeBox(artboards[i]);
    if(containsPoint(ab,cx,cy))return artboards[i];
  }
  return artboards[0];
}
function createGroup(doc,name,preview){const b=AddChildNodesCommandBuilder.create();b.setInsertionTarget(doc.currentSpread);b.addContainerNode(ContainerNodeDefinition.create(name));const cmd=b.createCommand(false,NodeChildType.Main);exec(doc,cmd,preview);return cmd.newNodes[0];}
function moveInto(doc,nodes,container){const v=nodes.filter(Boolean);if(!v.length)return;exec(doc,DocumentCommand.createMoveNodes(Selection.create(doc,v),container,NodeMoveType.Inside,NodeChildType.Main));}
function rectToPlain(r){return boxToPlain(r)||{x:0,y:0,width:0,height:0};}
function rectCurveBuilder(r){const cb=CurveBuilder.create();cb.beginXY(r.x,r.y).lineToXY(r.x+r.width,r.y).lineToXY(r.x+r.width,r.y+r.height).lineToXY(r.x,r.y+r.height).close();return cb;}
function makeClipRectDefinition(r){
  // A real rectangle shape is safer as an Enclosure than a polycurve created during preview.
  // The docs/tests use NodeChildType.Enclosure to clip a container/layer.
  const brushFill=FillDescriptor.createSolid(RGBA8(0,0,0,255),BlendMode.Normal);
  const noFill=FillDescriptor.createNone();
  const noLine=LineStyleDescriptor.createDefault(0);
  const transFill=FillDescriptor.createNone();
  return ShapeNodeDefinition.create(ShapeRectangle.create(), new Rectangle(r.x,r.y,r.width,r.height), brushFill, noFill, noLine, transFill);
}
function addClipRectToGroup(doc,grp,area){
  const b=AddChildNodesCommandBuilder.create();
  b.setInsertionTarget(grp);
  b.addShapeNode(makeClipRectDefinition(area));
  const cmd=b.createCommand(false,NodeChildType.Enclosure);
  exec(doc,cmd,false);
  return cmd.newNodes&&cmd.newNodes.length?cmd.newNodes[0]:null;
}
function deleteNodeSafe(doc,node){
  if(!node)return;
  try{
    const sel=Selection.create(doc,[node]);
    exec(doc,DocumentCommand.createDeleteSelection(sel,false),false);
  }catch(e){
    try{doc.deleteSelection(Selection.create(doc,[node]),false);}catch(_e){}
  }
}
function expandedAreaForRotation(area,angleDeg,pad){
  const rad=Math.abs(angleDeg||0)*Math.PI/180,ca=Math.abs(Math.cos(rad)),sa=Math.abs(Math.sin(rad));
  const cx=area.x+area.width/2,cy=area.y+area.height/2;
  const w=area.width*ca+area.height*sa+pad*2;
  const h=area.width*sa+area.height*ca+pad*2;
  return{x:cx-w/2,y:cy-h/2,width:w,height:h};
}
function rotateCurveBuilders(curves,angleDeg,cx,cy){
  const ang=(angleDeg||0)*Math.PI/180;
  if(Math.abs(ang)<=0.001)return curves;
  const t=Transform.createRotate(ang,cx,cy);
  for(let i=0;i<curves.length;i++)curves[i].transform(t);
  return curves;
}

function makeCurveNodeDefinition(cb,strokeHSL,strokeWeight,fillHSL){
  const curve=cb.createCurve(),pc=PolyCurve.create();pc.addCurve(curve);
  const sRGB=hslToRgb(strokeHSL.h,strokeHSL.s,strokeHSL.l);

  // Docs/tests use FillDescriptor.createSolid(colour, BlendMode.Normal).
  const lineFD=FillDescriptor.createSolid(RGBA8(sRGB.r,sRGB.g,sRGB.b,255),BlendMode.Normal);

  let brushFD;
  if(fillHSL){
    const fRGB=hslToRgb(fillHSL.h,fillHSL.s,fillHSL.l);
    brushFD=FillDescriptor.createSolid(RGBA8(fRGB.r,fRGB.g,fRGB.b,255),BlendMode.Normal);
  }
  else brushFD=FillDescriptor.createNone();

  // Avoid LineStyle.create({...}) here: its default vector-brush path can fail.
  const lineDesc=LineStyleDescriptor.createDefault(strokeWeight);
  try{
    lineDesc.lineStyle.cap=LineCap.Round;
    lineDesc.lineStyle.join=LineJoin.Round;
  }catch(e){}

  const nodeDef=PolyCurveNodeDefinition.createDefault();
  nodeDef.setCurves(pc);
  nodeDef.setBrushFillDescriptor(0,brushFD);
  nodeDef.setLineDescriptors(0,lineFD,lineDesc);
  return nodeDef;
}

function makeMultiCurveNodeDefinition(curveBuilders,strokeHSL,strokeWeight,fillHSL){
  const pc=PolyCurve.create();
  for(let i=0;i<curveBuilders.length;i++){
    pc.addCurve(curveBuilders[i].createCurve());
  }

  const sRGB=hslToRgb(strokeHSL.h,strokeHSL.s,strokeHSL.l);
  const lineFD=FillDescriptor.createSolid(RGBA8(sRGB.r,sRGB.g,sRGB.b,255),BlendMode.Normal);

  let brushFD;
  if(fillHSL){
    const fRGB=hslToRgb(fillHSL.h,fillHSL.s,fillHSL.l);
    brushFD=FillDescriptor.createSolid(RGBA8(fRGB.r,fRGB.g,fRGB.b,255),BlendMode.Normal);
  }
  else brushFD=FillDescriptor.createNone();

  const lineDesc=LineStyleDescriptor.createDefault(strokeWeight);
  try{
    lineDesc.lineStyle.cap=LineCap.Round;
    lineDesc.lineStyle.join=LineJoin.Round;
  }catch(e){}

  const nodeDef=PolyCurveNodeDefinition.createDefault();
  nodeDef.setCurves(pc);
  nodeDef.setBrushFillDescriptor(0,brushFD);
  nodeDef.setLineDescriptors(0,lineFD,lineDesc);
  return nodeDef;
}



function rotatePoint(x,y,angleDeg,cx,cy){
  const a=(angleDeg||0)*Math.PI/180;
  if(Math.abs(a)<=0.000001)return{x,y};
  const dx=x-cx,dy=y-cy,ca=Math.cos(a),sa=Math.sin(a);
  return{x:cx+dx*ca-dy*sa,y:cy+dx*sa+dy*ca};
}
function rectsIntersect(a,b,pad){
  const p=Math.max(0,pad||0);
  if(!a||!b)return true;
  return !(a.x+a.width < b.x-p || a.x > b.x+b.width+p || a.y+a.height < b.y-p || a.y > b.y+b.height+p);
}
function boundsOfPoints(points){
  if(!points||!points.length)return null;
  let minX=points[0].x,maxX=points[0].x,minY=points[0].y,maxY=points[0].y;
  for(let i=1;i<points.length;i++){
    const p=points[i];
    if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.y<minY)minY=p.y;if(p.y>maxY)maxY=p.y;
  }
  return{x:minX,y:minY,width:maxX-minX,height:maxY-minY};
}
function makePathFromPreparedPoints(points,closed){
  const cb=CurveBuilder.create();
  if(!points||!points.length)return cb;
  cb.beginXY(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++)cb.lineToXY(points[i].x,points[i].y);
  if(closed)cb.close();
  return cb;
}
function pathFromPoints(points,closed,angle,cx,cy){
  if(!points||!points.length)return CurveBuilder.create();
  const out=[];
  for(let i=0;i<points.length;i++)out.push(rotatePoint(points[i].x,points[i].y,angle,cx,cy));
  return makePathFromPreparedPoints(out,closed);
}
function pathFromPointsIfVisible(points,closed,angle,cx,cy,clipArea,pad){
  if(!points||!points.length)return null;
  const out=[];
  for(let i=0;i<points.length;i++)out.push(rotatePoint(points[i].x,points[i].y,angle,cx,cy));
  if(clipArea&&!rectsIntersect(boundsOfPoints(out),clipArea,pad))return null;
  return makePathFromPreparedPoints(out,closed);
}
function pushVisiblePath(shapes,points,closed,angle,cx,cy,clipArea,pad){
  const cb=pathFromPointsIfVisible(points,closed,angle,cx,cy,clipArea,pad);
  if(cb)shapes.push(cb);
}
function polygonCirclePoints(cx,cy,r,count,startAngle){
  const pts=[],n=Math.max(12,count||24),a0=startAngle||0;
  for(let i=0;i<n;i++){
    const a=a0+i*Math.PI*2/n;
    pts.push({x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)});
  }
  return pts;
}

function hexagonCurves(area,scale,angle,gap,rowOffset,clipArea){
  const shapes=[],r=scale/2,w=r*Math.sqrt(3),h=r*2;
  const colStep=w+gap,rowStep=h*0.75+gap,extra=scale*2;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,colStep))+2,rows=Math.ceil((area.height+extra*2)/Math.max(1,rowStep))+2;
  const sx=area.x-extra,sy=area.y-extra,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const offX=(row%2)*colStep*0.5*(rowOffset/100),px=sx+col*colStep+offX,py=sy+row*rowStep;
    const pts=[];
    for(let i=0;i<6;i++){const a=i*Math.PI/3;pts.push({x:px+r*Math.cos(a),y:py+r*Math.sin(a)});}
    pushVisiblePath(shapes,pts,true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function triangleCurves(area,scale,angle,gap,clipArea){
  const shapes=[],h=scale*Math.sqrt(3)/2,colStep=scale+gap,rowStep=h+gap,extra=scale*2;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,colStep))+2,rows=Math.ceil((area.height+extra*2)/Math.max(1,rowStep))+3;
  const sx=area.x-extra,sy=area.y-extra,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const px=sx+col*colStep+(row%2===0?0:colStep*0.5),py=sy+row*rowStep,flip=(row+col)%2!==0;
    const pts=!flip?[{x:px,y:py+h},{x:px+scale/2,y:py},{x:px+scale,y:py+h}]:[{x:px,y:py},{x:px+scale/2,y:py+h},{x:px+scale,y:py}];
    pushVisiblePath(shapes,pts,true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function dotCurves(area,scale,angle,gap,rowOffset,clipArea){
  const shapes=[],r=scale/2,step=scale+gap,extra=scale*2;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,step))+2,rows=Math.ceil((area.height+extra*2)/Math.max(1,step))+2;
  const sx=area.x-extra,sy=area.y-extra,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const offX=(row%2)*step*0.5*(rowOffset/100),px=sx+col*step+offX,py=sy+row*step;
    pushVisiblePath(shapes,polygonCirclePoints(px,py,r,28),true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function stripeCurves(area,scale,angle,gap,clipArea){
  const shapes=[],step=scale+gap,extra=Math.max(area.width,area.height)*1.5,count=Math.ceil(extra*2/Math.max(1,step))+4,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  for(let i=-Math.floor(count/2);i<Math.ceil(count/2);i++){
    const x=cx+i*step;
    pushVisiblePath(shapes,[{x,y:cy-extra},{x,y:cy+extra}],false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function diamondCurves(area,scale,angle,gap,clipArea){
  const shapes=[],step=scale+gap,extra=scale*2;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,step))+2,rows=Math.ceil((area.height+extra*2)/Math.max(1,step))+2;
  const sx=area.x-extra,sy=area.y-extra,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2,hs=scale/2;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const offX=(row%2)*step*0.5,px=sx+col*step+offX,py=sy+row*step;
    pushVisiblePath(shapes,[{x:px,y:py-hs},{x:px+hs,y:py},{x:px,y:py+hs},{x:px-hs,y:py}],true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function chevronCurves(area,scale,angle,gap,rowOffset,clipArea){
  const shapes=[],cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  const w=Math.max(8,scale),h=w*0.58,thick=Math.max(1.5,Math.min(h*0.45,w*0.18));
  const stepX=Math.max(w*0.55,w+gap),stepY=Math.max(h*0.75,h+thick+gap);
  const extra=w*3,cols=Math.ceil((area.width+extra*2)/Math.max(1,stepX))+3,rows=Math.ceil((area.height+extra*2)/Math.max(1,stepY))+3;
  const sx=area.x-extra,sy=area.y-extra;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const offX=(row%2)*stepX*0.5*(rowOffset/100),x=sx+col*stepX+offX,y=sy+row*stepY;
    const pts=[{x,y},{x:x+w*0.5,y:y+h},{x:x+w,y},{x:x+w,y:y+thick},{x:x+w*0.5,y:y+h+thick},{x,y:y+thick}];
    pushVisiblePath(shapes,pts,true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function crosshatchCurves(area,scale,angle,gap,clipArea){
  const shapes=[],step=scale+gap,extra=Math.max(area.width,area.height)*1.5,count=Math.ceil(extra*2/Math.max(1,step))+4,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  for(let i=-Math.floor(count/2);i<Math.ceil(count/2);i++){
    const off=i*step;
    pushVisiblePath(shapes,[{x:cx+off,y:cy-extra},{x:cx+off,y:cy+extra}],false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
    pushVisiblePath(shapes,[{x:cx-extra,y:cy+off},{x:cx+extra,y:cy+off}],false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function pointDist(a,b){const dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy);} 
function polygonPerimeter(pts){let len=0;for(let i=0;i<pts.length;i++)len+=pointDist(pts[i],pts[(i+1)%pts.length]);return len;}
function polygonArea(pts){let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y;}return a/2;}
function polygonCentroid(pts){let a=0,cx=0,cy=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length],cross=p.x*q.y-q.x*p.y;a+=cross;cx+=(p.x+q.x)*cross;cy+=(p.y+q.y)*cross;}a*=0.5;if(Math.abs(a)<0.000001)return null;return{x:cx/(6*a),y:cy/(6*a)};}
function clipPolyToCloserHalfPlane(poly,p,q){const out=[];const A=2*(q.x-p.x),B=2*(q.y-p.y),C=q.x*q.x+q.y*q.y-p.x*p.x-p.y*p.y;function inside(pt){return A*pt.x+B*pt.y<=C+0.00001;}function intersect(a,b){const fa=A*a.x+B*a.y-C,fb=A*b.x+B*b.y-C,t=fa/(fa-fb);return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}for(let i=0;i<poly.length;i++){const cur=poly[i],prev=poly[(i+poly.length-1)%poly.length],curIn=inside(cur),prevIn=inside(prev);if(curIn){if(!prevIn)out.push(intersect(prev,cur));out.push(cur);}else if(prevIn)out.push(intersect(prev,cur));}return out;}
function cleanSmallPolySegments(pts){let p=pts.slice(),changed=true,guard=0;while(changed&&p.length>3&&guard++<6){changed=false;const min=Math.max(0.35,polygonPerimeter(p)/80);for(let i=p.length-1;i>=0&&p.length>3;i--){if(pointDist(p[i],p[(i+1)%p.length])<min){p.splice(i,1);changed=true;}}}return p;}
function shrinkPolygon(pts,gap){const g=Math.max(0,gap||0);if(g<=0)return pts;const c=polygonCentroid(pts);if(!c)return pts;let avg=0;for(let i=0;i<pts.length;i++)avg+=pointDist(pts[i],c);avg/=Math.max(1,pts.length);const f=Math.max(0.08,Math.min(1,(avg-g)/avg));return pts.map(p=>({x:c.x+(p.x-c.x)*f,y:c.y+(p.y-c.y)*f}));}
function beehiveVoronoiSites(area,cellCount,seed){const rng=makeRng(seed),target=Math.max(6,Math.min(220,Math.round(cellCount||40))),ratio=Math.max(0.25,area.width/Math.max(1,area.height));let cols=Math.max(2,Math.round(Math.sqrt(target*ratio))),rows=Math.max(2,Math.ceil(target/cols));const cellW=area.width/cols,cellH=area.height/rows,loose=0.42,sites=[];for(let row=-1;row<=rows;row++){for(let col=-1;col<=cols;col++){let x=area.x+col*cellW+cellW/2+(row%2?cellW/2:0),y=area.y+row*cellH+cellH/2;x+=(rng()-0.5)*cellW*loose;y+=(rng()-0.5)*cellH*loose;sites.push({x,y,inside:row>=0&&row<rows&&col>=0&&col<cols});}}return sites;}
function curveFromPolygon(pts,angle,cx,cy,clipArea,pad){return pathFromPointsIfVisible(pts,true,angle,cx,cy,clipArea,pad);}
function voronoiCurves(area,scale,cells,seed,angle,gap,clipArea){
  const shapes=[],sites=beehiveVoronoiSites(area,cells,seed),bounds=[{x:area.x,y:area.y},{x:area.x+area.width,y:area.y},{x:area.x+area.width,y:area.y+area.height},{x:area.x,y:area.y+area.height}],cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2,minArea=Math.max(8,(scale||20)*(scale||20)*0.015);
  for(let i=0;i<sites.length;i++){
    const p=sites[i];if(!p.inside)continue;let poly=bounds.slice();
    for(let j=0;j<sites.length;j++){if(i===j)continue;poly=clipPolyToCloserHalfPlane(poly,p,sites[j]);if(poly.length<3)break;}
    if(poly.length<3)continue;
    poly=cleanSmallPolySegments(shrinkPolygon(poly,gap));
    if(poly.length<3||Math.abs(polygonArea(poly))<minArea)continue;
    const cb=curveFromPolygon(poly,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
    if(cb)shapes.push(cb);
  }
  return shapes;
}
function rosetteCurves(area,scale,angle,gap,rowOffset,clipArea){
  const shapes=[],cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  const r=Math.max(4,scale*0.45),step=Math.max(r*1.25,scale+gap),rowStep=Math.max(r*1.25,scale+gap);
  const petals=6,depth=0.34,ptsN=Math.max(32,Math.min(72,Math.round(scale))),extra=scale*2;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,step))+3,rows=Math.ceil((area.height+extra*2)/Math.max(1,rowStep))+3,sx=area.x-extra,sy=area.y-extra;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const offX=(row%2)*step*0.5*(rowOffset/100),mx=sx+col*step+offX,my=sy+row*rowStep,phase=((row+col)%2)*Math.PI/petals;
    const pts=[];
    for(let i=0;i<ptsN;i++){const t=(i/ptsN)*Math.PI*2,rr=r*(1+depth*Math.cos(petals*t));pts.push({x:mx+rr*Math.cos(t+phase),y:my+rr*Math.sin(t+phase)});}
    pushVisiblePath(shapes,pts,true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function guillocheCurves(area,scale,angle,gap,clipArea){
  const shapes=[],cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2;
  const maxDim=Math.max(area.width,area.height),amp=Math.max(2,scale*0.22),wave=Math.max(18,scale*1.65),spacing=Math.max(5,scale*0.35+gap);
  const extra=maxDim*0.35+scale*2,x0=area.x-extra,x1=area.x+area.width+extra,rows=Math.ceil((area.height+extra*2)/Math.max(1,spacing))+3;
  const dx=Math.max(6,scale/8),sy=area.y-extra;
  for(let row=0;row<rows;row++){
    const baseY=sy+row*spacing,phase=row*0.75;
    for(let band=0;band<2;band++){
      const dir=band===0?1:-1,pts=[];
      for(let x=x0;x<=x1+0.001;x+=dx){const u=(x-x0)/wave;pts.push({x,y:baseY+dir*(Math.sin(u*Math.PI*2+phase)*amp+Math.sin(u*Math.PI*4.6+phase*1.37)*amp*0.32)});}
      pushVisiblePath(shapes,pts,false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
    }
  }
  return shapes;
}
function herringboneCurves(area,scale,angle,gap,clipArea){
  const shapes=[],cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2,w=scale,h=scale*0.45,step=w+gap,rowStep=(h+gap)*2,extra=scale*3;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,step))+4,rows=Math.ceil((area.height+extra*2)/Math.max(1,rowStep))+4,sx=area.x-extra,sy=area.y-extra;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const px=sx+col*step,py=sy+row*rowStep;
    pushVisiblePath(shapes,[{x:px,y:py},{x:px+w,y:py},{x:px+w,y:py+h},{x:px,y:py+h}],true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
    pushVisiblePath(shapes,[{x:px+w,y:py-h},{x:px+w+h,y:py-h},{x:px+w+h,y:py-h+w},{x:px+w,y:py-h+w}],true,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function basketweaveCurves(area,scale,angle,gap,clipArea){
  const shapes=[],cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2,s=scale,step=s*2+gap*2,extra=scale*3;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,step))+3,rows=Math.ceil((area.height+extra*2)/Math.max(1,step))+3,sx=area.x-extra,sy=area.y-extra;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const px=sx+col*step,py=sy+row*step,even=(row+col)%2===0;
    for(let k=0;k<2;k++){
      const off=k*(s*0.55);
      if(even)pushVisiblePath(shapes,[{x:px,y:py+off},{x:px+s*2,y:py+off}],false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
      else pushVisiblePath(shapes,[{x:px+off,y:py},{x:px+off,y:py+s*2}],false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
    }
  }
  return shapes;
}
function scalesCurves(area,scale,angle,gap,clipArea){
  const shapes=[],r=scale/2,colStep=scale+gap,rowStep=r*0.85+gap,cx=clipArea.x+clipArea.width/2,cy=clipArea.y+clipArea.height/2,extra=scale*2;
  const cols=Math.ceil((area.width+extra*2)/Math.max(1,colStep))+2,rows=Math.ceil((area.height+extra*2)/Math.max(1,rowStep))+2,sx=area.x-extra,sy=area.y-extra;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const offX=(row%2)*colStep*0.5,px=sx+col*colStep+offX,py=sy+row*rowStep,pts=[];
    for(let i=0;i<=16;i++){const a=Math.PI-(i/16)*Math.PI;pts.push({x:px+r*Math.cos(a),y:py+r*Math.sin(a)});}
    pushVisiblePath(shapes,pts,false,angle,cx,cy,clipArea,strokeCullPad(scale,gap));
  }
  return shapes;
}
function strokeCullPad(scale,gap){return Math.max(4,Math.abs(gap||0)+Math.max(1,scale||1)*0.8);}

const PATTERN_TYPES=["Hexagons","Triangles","Chevrons","Dots","Stripes","Diamonds","Voronoi","Rosettes","Guilloché","Crosshatch","Herringbone","Basketweave","Scales (fish)"];
const CLOSED_PATTERNS=new Set([0,1,2,3,5,6,7,10,11]);

function generateCurves(opts,area){
  const{patType,scale,angle,gap,rowOffset,seed,cells}=opts;
  const coverArea=expandedAreaForRotation(area,angle,Math.max(scale*3,Math.abs(gap)*2+scale));
  let curves;
  switch(patType){
    case 0:curves=hexagonCurves(coverArea,scale,angle,gap,rowOffset,area);break;
    case 1:curves=triangleCurves(coverArea,scale,angle,gap,area);break;
    case 2:curves=chevronCurves(coverArea,scale,angle,gap,rowOffset,area);break;
    case 3:curves=dotCurves(coverArea,scale,angle,gap,rowOffset,area);break;
    case 4:curves=stripeCurves(coverArea,scale,angle,gap,area);break;
    case 5:curves=diamondCurves(coverArea,scale,angle,gap,area);break;
    case 6:curves=voronoiCurves(coverArea,scale,cells,seed,angle,gap,area);break;
    case 7:curves=rosetteCurves(coverArea,scale,angle,gap,rowOffset,area);break;
    case 8:curves=guillocheCurves(coverArea,scale,angle,gap,area);break;
    case 9:curves=crosshatchCurves(coverArea,scale,angle,gap,area);break;
    case 10:curves=herringboneCurves(coverArea,scale,angle,gap,area);break;
    case 11:curves=basketweaveCurves(coverArea,scale,angle,gap,area);break;
    case 12:curves=scalesCurves(coverArea,scale,angle,gap,area);break;
    default:curves=hexagonCurves(coverArea,scale,angle,gap,rowOffset,area);break;
  }
  return curves;
}

function buildPatternGroupForArea(doc,opts,area,clipNode,clipToArea,isFinal,labelSuffix){
  const{strokeHue,strokeSat,strokeLit,strokeWidth,colourVar,varSeed,fillClosed,opacity,patType}=opts;
  const baseH=strokeHue/360,baseS=strokeSat/100,baseL=strokeLit/100,varRng=makeRng(varSeed);
  const curves=generateCurves(opts,area);
  let failures=0,added=0,layerNodes=0;

  const name=(isFinal?`${PATTERN_TYPES[patType]} Pattern`:`Preview — ${PATTERN_TYPES[patType]}`)+(labelSuffix?` — ${labelSuffix}`:"");
  const grp=createGroup(doc,name,false);
  if(!grp) throw new Error("Could not create pattern group");

  if(clipToArea) addClipRectToGroup(doc,grp,area);

  const b=AddChildNodesCommandBuilder.create();
  b.setInsertionTarget(grp);

  // Fast path: when colour variation is off, combine all curves into one vector node.
  if(curves.length>0 && colourVar<=0){
    const fillHSL=(fillClosed&&CLOSED_PATTERNS.has(patType))?{h:baseH,s:baseS,l:Math.min(1,baseL+0.15)}:null;
    try{
      b.addPolyCurveNode(makeMultiCurveNodeDefinition(curves,{h:baseH,s:baseS,l:baseL},strokeWidth,fillHSL));
      added=curves.length;
      layerNodes=1;
    }catch(e){
      failures++;
      console.log("Vector Pattern FX multi-node-def error: "+(e&&e.stack?e.stack:e));
    }
  }else{
    for(let i=0;i<curves.length;i++){
      const vAmt=colourVar/100,h=((baseH+(varRng()-0.5)*vAmt*0.5)+1)%1,s=Math.max(0,Math.min(1,baseS+(varRng()-0.5)*vAmt*0.3)),l=Math.max(0,Math.min(1,baseL+(varRng()-0.5)*vAmt*0.3));
      const fillHSL=(fillClosed&&CLOSED_PATTERNS.has(patType))?{h,s,l:Math.min(1,l+0.15)}:null;
      try{b.addPolyCurveNode(makeCurveNodeDefinition(curves[i],{h,s,l},strokeWidth,fillHSL));added++;layerNodes++;}
      catch(e){failures++;if(failures===1)console.log("Vector Pattern FX node-def error: "+(e&&e.stack?e.stack:e));}
    }
  }

  if(layerNodes>0){
    const cmd=b.createCommand(false,NodeChildType.Main);
    exec(doc,cmd,false);
  }

  if(clipNode){exec(doc,DocumentCommand.createMoveNodes(Selection.create(doc,[grp]),clipNode,NodeMoveType.Inside,NodeChildType.Main),false);}
  if(opacity<100){try{exec(doc,DocumentCommand.createSetOpacity(Selection.create(doc,[grp]),opacity/100),false);}catch(e){}}
  return{group:grp,groups:[grp],nodes:added,layerNodes,failures};
}

function generate(doc,opts,target,isFinal){
  const spread=doc.currentSpread,spreadBox=rectToPlain(spread.getSpreadExtents({includeSpread:true}));
  target=target||{mode:"spread",area:spreadBox,label:"page"};

  if(target.mode==="allArtboards"){
    const totals={group:null,groups:[],nodes:0,layerNodes:0,failures:0,targetLabel:"all artboards"};
    const abs=target.artboards||[];
    for(let i=0;i<abs.length;i++){
      const area=getNodeBox(abs[i]);
      if(!area||area.width<=0||area.height<=0)continue;
      const res=buildPatternGroupForArea(doc,opts,area,abs[i],true,isFinal,`Artboard ${i+1}`);
      if(!totals.group)totals.group=res.group;
      totals.groups=totals.groups.concat(res.groups);
      totals.nodes+=res.nodes;totals.layerNodes+=res.layerNodes;totals.failures+=res.failures;
    }
    if(!totals.group)throw new Error("No usable artboards found");
    return totals;
  }

  let area=target.area;
  let clipNode=target.node||null;
  let clipToArea=target.clipToArea!==false;
  if(!area){
    if(clipNode)area=getNodeBox(clipNode);
    if(!area)area=spreadBox;
  }
  const res=buildPatternGroupForArea(doc,opts,rectToPlain(area),clipNode,clipToArea,isFinal,"");
  res.targetLabel=target.label||"page";
  return res;
}


function main(){
  const doc=Document.current;
  if(!doc){const d=Dialog.create("Error");d.addColumn().addGroup("").addStaticText("","No document open.").isFullWidth=true;d.runModal();return;}
  const sel=doc.selection;
  const targetNode=(sel&&sel.length>0)?sel.at(0).node:null;
  const artboards=getArtboards(doc.currentSpread);
  const currentArtboard=findArtboardForNode(artboards,targetNode);

  const VORONOI_INDEX=6;
  const DIALOG_INITIAL_WIDTH=340; // Edit this value if you want a wider or narrower dialog.
  const dlg=Dialog.create("Vector Pattern FX");
  dlg.initialWidth=DIALOG_INITIAL_WIDTH;

  const leftCol=dlg.addColumn();
  const rightCol=dlg.addColumn();

  function addNote(group,text){const s=group.addStaticText("",text);s.isFullWidth=true;return s;}
  function sliderEditor(group,label,initial,min,max,precision,desc){const c=group.addUnitValueEditor(label,UnitType.Number,UnitType.Number,initial,min,max);c.precision=precision;c.showPopupSlider=true;if(desc)c.description=desc;return c;}
  function numericEditor(group,label,initial,min,max,precision,desc){const c=group.addUnitValueEditor(label,UnitType.Number,UnitType.Number,initial,min,max);c.precision=precision;if(desc)c.description=desc;return c;}

  // LEFT COLUMN: where and what to generate.
  const tgtGrp=leftCol.addGroup("Target");
  const targetOptions=[artboards.length?"Page / Artboard":"Page"];
  const targetModes=["pageArtboard"];
  if(targetNode){targetOptions.push("Current Selection");targetModes.push("selection");}
  const tgtCtrl=tgtGrp.addComboBox("Fill",targetOptions,0);
  tgtCtrl.isFullWidth=true;
  tgtCtrl.description="Generate on the page/artboard, or inside the current selection when one is selected.";

  const typeGrp=leftCol.addGroup("Pattern");
  const typeCtrl=typeGrp.addComboBox("Type",PATTERN_TYPES,VORONOI_INDEX);
  typeCtrl.isFullWidth=true;
  typeCtrl.description="Select the pattern family to generate.";
  const cellsCtrl=sliderEditor(typeGrp,"Cells",42,6,220,0,"Voronoi only. Higher values create more closed cells.");
  const seedCtrl=numericEditor(typeGrp,"Seed",42,1,9999,0,"Voronoi only. Change this for a different cell layout.");

  const geomGrp=leftCol.addGroup("Geometry");
  const scaleCtrl=sliderEditor(geomGrp,"Size",60,4,500,1,"Size of repeated elements. Voronoi mainly uses Cells instead.");
  const gapCtrl=sliderEditor(geomGrp,"Gap",8,-100,500,1,"Spacing between repeated elements. For Voronoi this shrinks each cell to create mosaic gaps.");
  const strokeCtrl=sliderEditor(geomGrp,"Stroke",1.5,0.1,50,1,"Line width for the generated shapes.");
  const angleCtrl=sliderEditor(geomGrp,"Rotate (°)",0,-180,180,1,"Rotate the pattern layout while keeping it clipped to the page or selection.");

  // RIGHT COLUMN: how the generated artwork looks.
  const colGrp=rightCol.addGroup("Colour");
  const hueCtrl=sliderEditor(colGrp,"Hue (°)",150,0,360,0,"Base hue for the stroke colour.");
  const satCtrl=sliderEditor(colGrp,"Sat %",75,0,100,0,"Base saturation for the stroke colour.");
  const litCtrl=sliderEditor(colGrp,"Lit %",42,0,100,0,"Base lightness for the stroke colour.");
  const colVarCtrl=sliderEditor(colGrp,"Colour Var %",45,0,100,0,"Amount of random colour variation.");
  const fillClosedCtrl=colGrp.addCheckBox("Fill closed shapes",true);
  fillClosedCtrl.description="Add a fill to closed motifs where applicable.";

  const layoutGrp=rightCol.addGroup("Extra Options");
  const rowOffCtrl=sliderEditor(layoutGrp,"Row Offset %",0,0,100,0,"Shift alternating rows for patterns that support row staggering, including Chevrons and Rosettes.");
  const opacityCtrl=sliderEditor(layoutGrp,"Opacity %",100,1,100,0,"Opacity of the final pattern group.");
  const varSeedCtrl=numericEditor(layoutGrp,"Var Seed",7,1,9999,0,"Random seed used for colour variation.");

  const actGrp=rightCol.addGroup("Action");

  // Affinity dialogs cannot reliably hide/show controls, so Voronoi-only controls are disabled when another pattern is selected.
  seedCtrl.setIsEnabledByWithSelectedIndex(typeCtrl,VORONOI_INDEX);
  cellsCtrl.setIsEnabledByWithSelectedIndex(typeCtrl,VORONOI_INDEX);

  const statusTxt=actGrp.addStaticText("","");statusTxt.isFullWidth=true;
  const btns=actGrp.addButtonSet("",["↺ Preview","✓ Apply"],0);btns.isFullWidth=true;

  function getOpts(){return{patType:typeCtrl.selectedIndex,scale:scaleCtrl.value,strokeWidth:strokeCtrl.value,angle:angleCtrl.value,seed:Math.round(seedCtrl.value),cells:Math.round(cellsCtrl.value),strokeHue:hueCtrl.value,strokeSat:satCtrl.value,strokeLit:litCtrl.value,fillClosed:fillClosedCtrl.value,gap:gapCtrl.value,rowOffset:rowOffCtrl.value,opacity:opacityCtrl.value,colourVar:colVarCtrl.value,varSeed:Math.round(varSeedCtrl.value)};}
  function getTargetSpec(){
    const mode=targetModes[tgtCtrl.selectedIndex]||"pageArtboard";
    const spreadBox=rectToPlain(doc.currentSpread.getSpreadExtents({includeSpread:true}));
    if(mode==="selection"&&targetNode){
      return{mode:"selection",node:targetNode,area:getNodeBox(targetNode),clipToArea:false,label:"selection"};
    }
    const ab=currentArtboard||artboards[0];
    if(ab){
      return{mode:"artboard",node:ab,area:getNodeBox(ab),clipToArea:true,label:"artboard"};
    }
    return{mode:"spread",area:spreadBox,clipToArea:true,label:"page"};
  }


  let previewGroups=[];
  function clearPreview(){
    for(let i=previewGroups.length-1;i>=0;i--)deleteNodeSafe(doc,previewGroups[i]);
    previewGroups=[];
    clearDocumentPreviews(doc);
  }
  function showPreview(initial){
    clearPreview();
    try{
      const opts=getOpts(),target=getTargetSpec(),res=generate(doc,opts,target,false);
      previewGroups=res.groups||[res.group];
      statusTxt.text=(initial?"Initial preview":"Preview")+`: ${PATTERN_TYPES[opts.patType]} — ${res.nodes} objects in ${res.layerNodes} layer node(s), clipped to ${res.targetLabel||target.label}`;
    }catch(e){
      previewGroups=[];
      statusTxt.text="✖ Preview error: "+(e&&e.message?e.message:e);
    }
  }

  statusTxt.text="Building initial preview…";
  showPreview(true);

  let running=true;
  while(running){
    btns.selectedIndex=0;
    const result=dlg.runModal(),mode=btns.selectedIndex;
    if(result.value!==DialogResult.Ok.value){clearPreview();running=false;}
    else if(mode===1){clearPreview();try{const res=generate(doc,getOpts(),getTargetSpec(),true);exec(doc,DocumentCommand.createSetSelection(Selection.create(doc,res.groups||[res.group])),false);running=false;}catch(e){statusTxt.text="✖ Error: "+(e&&e.message?e.message:e);}}
    else{showPreview(false);}
  }
}

try{main();}catch(err){const d=Dialog.create("Vector Pattern FX – Crash");d.initialWidth=420;d.addColumn().addGroup("Error").addStaticText("",String(err)).isFullWidth=true;d.runModal();}
