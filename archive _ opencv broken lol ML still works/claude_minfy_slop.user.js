// ==UserScript==
// @name         4chan TCaptcha Debugger v14
// @namespace    4chan-imgui-debugger
// @match        https://*.4chan.org/*
// @match        https://*.4channel.org/*
// @require      https://docs.opencv.org/4.x/opencv.js
// @grant        unsafeWindow
// @run-at       document-end
// @version      14.0
// ==/UserScript==

/**
 * TCaptcha Visual Debugger - Analyzes box-counting CAPTCHAs
 * Uses OpenCV for computer vision + logic parsing to predict answers
 */

(()=>{'use strict';
const W=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
const $=id=>document.getElementById(id);

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG & CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════
const CFG={
    cv:{mk:5,bs:11,tc:2,ma:100,ae:0.04,at:15,ef:0.1,ii:100,et:0.015,no:0.6},
    ui:{w:550,c:'#007acc,#ff3e3e,#1e1e1e,#252526,#000,#2d2d2d,#452121,#333,#444,#eee,#888,#6a9955,#b5cea8'.split(',')},
    t:{retry:250,delay:150}
};

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════
const el=(t,a={},c=[])=>{const e=document.createElement(t);Object.entries(a).forEach(([k,v])=>{if(k==='className')e.className=v;else if(k==='style')Object.assign(e.style,v);else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v);});c.forEach(x=>e.appendChild(typeof x==='string'?document.createTextNode(x):x));return e;};

const dist=(a,b)=>Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
const angle=(p1,p2,p3)=>{const v1={x:p1.x-p2.x,y:p1.y-p2.y},v2={x:p3.x-p2.x,y:p3.y-p2.y};return Math.acos((v1.x*v2.x+v1.y*v2.y)/(Math.sqrt(v1.x**2+v1.y**2)*Math.sqrt(v2.x**2+v2.y**2)+1e-7))*(180/Math.PI);};

// Mat memory manager
class M{constructor(){this.m=[];}add(...i){this.m.push(...i.flat());return i.length===1?i[0]:i;}free(){this.m.forEach(x=>{try{x?.delete&&!x.isDeleted?.()&&x.delete();}catch{}});this.m=[];}}

// ═════════════════════════════════════════════════════════════════════════════
// COMPUTER VISION - Box detection & analysis
// ═════════════════════════════════════════════════════════════════════════════
const CV={
    ready:()=>typeof cv!=='undefined'&&cv.Mat,

    analyze(img){
        if(!this.ready())return{empty:0,total:0};
        const m=new M();
        try{
            const src=m.add(cv.imread(img)),gray=m.add(new cv.Mat());
            cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);

            // Morphology + dual threshold
            const k=m.add(cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(CFG.cv.mk,CFG.cv.mk)));
            const bh=m.add(new cv.Mat());cv.morphologyEx(gray,bh,cv.MORPH_BLACKHAT,k);
            const to=m.add(new cv.Mat()),ta=m.add(new cv.Mat());
            cv.threshold(bh,to,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
            cv.adaptiveThreshold(bh,ta,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,CFG.cv.bs,CFG.cv.tc);
            const th=m.add(new cv.Mat());cv.bitwise_and(to,ta,th);

            // Find rectangular contours
            const ct=m.add(new cv.MatVector()),h=m.add(new cv.Mat());
            cv.findContours(th,ct,h,cv.RETR_TREE,cv.CHAIN_APPROX_SIMPLE);

            let boxes=[];
            for(let i=0;i<ct.size();i++){
                const c=ct.get(i),a=cv.contourArea(c);
                if(a<CFG.cv.ma)continue;
                const ap=new cv.Mat();
                cv.approxPolyDP(c,ap,CFG.cv.ae*cv.arcLength(c,true),true);
                if(ap.rows===4&&cv.isContourConvex(ap)){
                    const pts=[...Array(4)].map((_,j)=>({x:ap.data32S[j*2],y:ap.data32S[j*2+1]}));
                    ap.delete();
                    if(pts.every((_,idx)=>Math.abs(angle(pts[(idx+3)%4],pts[idx],pts[(idx+1)%4])-90)<=CFG.cv.at)){
                        const M=cv.moments(c);
                        if(M.m00){
                            const r=cv.boundingRect(c);
                            boxes.push({c,cx:M.m10/M.m00,cy:M.m01/M.m00,w:Math.max(r.width,r.height),a});
                        }
                    }
                }else ap.delete();
            }

            // NMS
            boxes.sort((a,b)=>b.a-a.a);
            boxes=boxes.filter((b,i)=>!boxes.slice(0,i).some(k=>dist({x:b.cx,y:b.cy},{x:k.cx,y:k.cy})<k.w*CFG.cv.no));

            // Count empty
            let empty=0;
            for(const b of boxes){
                const mask=m.add(cv.Mat.zeros(gray.rows,gray.cols,cv.CV_8UC1));
                const v=m.add(new cv.MatVector());v.push_back(b.c);
                cv.drawContours(mask,v,0,new cv.Scalar(255),-1);
                const im=m.add(new cv.Mat());
                cv.erode(mask,im,m.add(cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(3,3))),new cv.Point(-1,-1),Math.max(~~(b.w*CFG.cv.ef),1));
                const mv=cv.mean(gray,im)[0];
                const it=m.add(new cv.Mat());cv.threshold(gray,it,Math.min(CFG.cv.ii,mv-10),255,cv.THRESH_BINARY_INV);
                const msk=m.add(new cv.Mat());cv.bitwise_and(it,it,msk,im);
                if((cv.countNonZero(msk)/cv.countNonZero(im))<CFG.cv.et)empty++;
            }
            return{empty,total:boxes.length};
        }catch(e){return{empty:0,total:0};}finally{m.free();}
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// PARSER - Extract logic from instructions (handles trick gates)
// ═════════════════════════════════════════════════════════════════════════════
const parse=html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('*').forEach(e=>{
        const s=(e.getAttribute('style')||'').split(';').some(r=>{
            const[p,v]=r.split(':').map(x=>x?.trim().toLowerCase());
            return(p==='display'&&v==='none')||(p==='visibility'&&v==='hidden');
        });
        if(s)e.remove();
    });
    const txt=doc.body.textContent.toLowerCase().replace(/\s+/g,' ').trim();
    const type=txt.includes('highest number')?'MAX':txt.includes('exactly')?'EXACT':'UNKNOWN';
    const target=type==='EXACT'?(txt.match(/exactly\s*(\d+)/)?.[1]|0):0;
    return{type,target,txt};
};

// ═════════════════════════════════════════════════════════════════════════════
// PREDICTOR
// ═════════════════════════════════════════════════════════════════════════════
const predict=(res,logic)=>{
    if(logic.type==='MAX'){
        const s=[...res].sort((a,b)=>b.empty-a.empty||a.total-b.total);
        return{idx:s[0]?.empty>0?s[0].i:-1,approx:false};
    }
    if(logic.type==='EXACT'){
        const ex=res.find(r=>r.empty===+logic.target);
        if(ex)return{idx:ex.i,approx:false};
        const cl=[...res].sort((a,b)=>Math.abs(a.empty-logic.target)-Math.abs(b.empty-logic.target))[0];
        return{idx:cl?.i??-1,approx:true};
    }
    return{idx:-1,approx:false};
};

// ═════════════════════════════════════════════════════════════════════════════
// UI SYSTEM
// ═════════════════════════════════════════════════════════════════════════════
const UI={
    init(){
        const[P,R,BG,HD,LOG,CD,PCD,BR,BRC,TX,TXM,TXS,TXL]=CFG.ui.c;
        document.head.appendChild(el('style',{html:`
#d{position:fixed;top:60px;right:20px;width:${CFG.ui.w}px;background:${BG};border:1px solid ${BR};border-top:4px solid ${P};box-shadow:0 10px 30px rgba(0,0,0,.8);z-index:2147483647;font-family:'Segoe UI',sans-serif;color:${TX};display:none}
#h{background:${HD};padding:8px 12px;cursor:move;display:flex;justify-content:space-between;font-size:12px;font-weight:bold;border-bottom:1px solid ${BR};user-select:none}
#h span:last-child{cursor:pointer}#h span:last-child:hover{color:${R}}
#b{padding:12px}
#l{background:${LOG};padding:10px;font-size:14px;color:${TXL};border:1px solid ${BRC};margin-bottom:12px;font-family:monospace;border-radius:2px;word-break:break-word}
#g{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:500px;overflow-y:auto;padding-right:5px}
.c{background:${CD};border:2px solid ${BRC};padding:6px;cursor:pointer;position:relative;border-radius:4px;transition:border-color .15s,transform .1s}
.c:hover{transform:scale(1.02)}.c img{width:100%;display:block;border-radius:2px}
.c.p{border-color:${R}!important;background:${PCD}}
.badge{position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:${R};color:white;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:bold}
.f{display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:${TXM}}
#s{margin-top:12px;font-size:11px;color:${TXS};display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid ${BR}}
#g::-webkit-scrollbar{width:4px}#g::-webkit-scrollbar-thumb{background:${BRC};border-radius:2px}
`}));

        const root=el('div',{id:'d'},[
            el('div',{id:'h'},[el('span',{text:'TCAPTCHA DEBUGGER v14'}),el('span',{id:'x',text:'[X]'})]),
            el('div',{id:'b'},[el('div',{id:'l',text:'READY'}),el('div',{id:'g'}),el('div',{id:'s'},[el('span',{id:'lg',text:'LOGIC: IDLE'}),el('span',{id:'st',text:'STEP: 0/0'})])])
        ]);
        document.body.appendChild(root);

        let pos={x:0,y:0},drag=0;
        $('h').onmousedown=e=>{if(e.target.id==='x')return;drag=1;pos.sx=e.clientX-pos.x;pos.sy=e.clientY-pos.y;};
        document.onmousemove=e=>{if(!drag)return;e.preventDefault();pos.x=e.clientX-pos.sx;pos.y=e.clientY-pos.sy;root.style.transform=`translate(${pos.x}px,${pos.y}px)`;};
        document.onmouseup=()=>drag=0;
        $('x').onclick=()=>root.style.display='none';
    },
    show:()=>$('d').style.display='block',
    hide:()=>$('d').style.display='none',
    set:(txt,step,tot,logic,tgt,sfx='')=>{
        $('l').textContent=`PROMPT: ${txt}`;
        $('st').textContent=`STEP: ${step} OF ${tot}`;
        $('lg').textContent=`LOGIC: ${logic}${tgt!=null?'_'+tgt:''}${sfx}`;
    },
    clear:()=>$('g').innerHTML='',
    card:(i,b64,click)=>{
        const img=new Image();img.src=`data:image/png;base64,${b64}`;
        const stats=el('span',{text:'...'});
        const card=el('div',{className:'c',onclick:click},[img,el('div',{className:'f'},[el('span',{text:`#${i}`}),stats])]);
        $('g').appendChild(card);
        return{card,img,stats};
    },
    mark:(card)=>{card.classList.add('p');card.appendChild(el('div',{className:'badge',text:'PREDICTION'}));}
};

// ═════════════════════════════════════════════════════════════════════════════
// CONTROLLER
// ═════════════════════════════════════════════════════════════════════════════
const App={
    start(){
        if(!W.TCaptcha?.setTaskId||!CV.ready()){setTimeout(()=>this.start(),CFG.t.retry);return;}
        console.log('[TCaptcha] Ready');
        UI.init();

        const tc=W.TCaptcha;
        ['setTaskId','setChallenge','setTaskItem','toggleSlider'].forEach(m=>{
            const o=tc[m];if(o)tc[m]=(...a)=>{const r=o.apply(tc,a);setTimeout(()=>this.refresh(),CFG.t.delay);return r;};
        });
        const oc=tc.clearChallenge;
        tc.clearChallenge=(...a)=>{oc?.apply(tc,a);UI.hide();};

        if(tc.tasks?.length)this.refresh();
    },

    async refresh(){
        const tc=W.TCaptcha,task=tc?.getCurrentTask?.();
        if(!task){UI.hide();return;}

        UI.show();
        const logic=parse(task.str||'');
        UI.set(logic.txt,(tc.taskId||0)+1,tc.tasks.length,logic.type,logic.type==='EXACT'?logic.target:null);
        UI.clear();

        const res=await Promise.all(task.items.map((b64,i)=>new Promise(r=>{
            const{card,img,stats}=UI.card(i,b64,()=>{
                if(!tc.sliderNode)return;
                tc.sliderNode.value=i+1;
                tc.sliderNode.dispatchEvent(new Event('input',{bubbles:true}));
                tc.onNextClick();
            });
            img.onload=()=>{const{empty,total}=CV.analyze(img);stats.textContent=`E:${empty} T:${total}`;r({i,empty,total,card});};
            img.onerror=()=>{stats.textContent='E:? T:?';r({i,empty:0,total:0,card});};
        })));

        const{idx,approx}=predict(res,logic);
        if(idx>=0){
            const m=res.find(x=>x.i===idx);
            if(m){UI.mark(m.card);if(approx)UI.set(logic.txt,(tc.taskId||0)+1,tc.tasks.length,logic.type,logic.target,' (APPROX)');}
        }
    }
};

App.start();
})();
