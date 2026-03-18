// Dieform Studio — UXP Plugin
// Event listener'lar addEventListener ile tanımlandı

const state = {
  scanned: false,
  cutPaths: [], foldPaths: [], panels: [],
  selectedFace: null,
  dielineUrl: null,
  artworkUrl: null,
  settings: { cutLayerName:'Cut', foldLayerName:'Fold', cutColor:'#e03535', foldColor:'#3a9e6e', W:65, H:90, D:18 },
};

const FACE_COLORS = { front:'#c8b97a', back:'#a89850', left:'#7a9ec8', right:'#5a7ea8', top:'#7ac87a', bottom:'#5aa85a', flap:'#c87aa8', tuck_in:'#c8956a', tuck_out:'#a8756a', extra:'#666' };
const FACE_LABELS = { front:'Ön', back:'Arka', left:'Sol Yan', right:'Sağ Yan', top:'Üst Kapak', bottom:'Alt Kapak', flap:'Yapıştırma', tuck_in:'Tuck In', tuck_out:'Tuck Out', extra:'Ekstra' };

const FACE_OPTIONS = [
  {v:'front',    l:'Ön'},
  {v:'back',     l:'Arka'},
  {v:'left',     l:'Sol Yan'},
  {v:'right',    l:'Sağ Yan'},
  {v:'top',      l:'Üst Kapak'},
  {v:'bottom',   l:'Alt Kapak'},
  {v:'flap',     l:'Yapıştırma'},
  {v:'tuck_in',  l:'Tuck In'},
  {v:'tuck_out', l:'Tuck Out'},
  {v:'extra',    l:'Ekstra'},
];

// ─── TABS ─────────────────────────────────────────
function switchTab(name) {
  ['scan','preview','settings'].forEach(n => {
    document.getElementById('tab-'+n).classList.toggle('on', n===name);
    document.getElementById('tab-'+n+'-btn').classList.toggle('on', n===name);
  });
  if(name==='preview') setTimeout(initThreeIfNeeded, 50);
}

// ─── SETTINGS ─────────────────────────────────────
function saveSettings() {
  state.settings.cutLayerName  = document.getElementById('cutLayerName').value.trim() || 'Cut';
  state.settings.foldLayerName = document.getElementById('foldLayerName').value.trim() || 'Fold';
  state.settings.cutColor      = document.getElementById('cutColor').value || '#e03535';
  state.settings.foldColor     = document.getElementById('foldColor').value || '#3a9e6e';
  showStatus('Ayarlar kaydedildi.', 'ok');
}

function updateDot(type) {
  const color = document.getElementById(type+'Color').value;
  if(/^#[0-9a-fA-F]{6}$/.test(color)) document.getElementById(type+'Dot').style.background = color;
}

// ─── SCAN ─────────────────────────────────────────
async function scanDocument() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.textContent = 'Taranıyor...';
  showStatus('Döküman taranıyor...', '');
  try {
    const result = await readDocument();
    state.cutPaths = result.cutPaths;
    state.foldPaths = result.foldPaths;
    state.panels = result.panels;
    state.scanned = true;
    showResults(result);
    if(boxInit) buildBoxFrom(result);
  } catch(e) {
    showStatus('Hata: ' + (e.message || String(e)), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Dökümanı Tara';
  }
}

async function readDocument() {
  let appModule = null;
  try { appModule = require('photoshop'); } catch(e) {}
  if(!appModule) try { appModule = require('illustrator'); } catch(e) {}

  if(appModule) {
    try {
      const doc = appModule.app.activeDocument;
      if(doc) return await parseDoc(doc);
    } catch(e) {}
  }
  return simulateScan();
}

async function parseDoc(doc) {
  const cutPaths = [], foldPaths = [];
  const cutName  = state.settings.cutLayerName.toLowerCase();
  const foldName = state.settings.foldLayerName.toLowerCase();
  const cutRgb   = hexToRgb(state.settings.cutColor);
  const foldRgb  = hexToRgb(state.settings.foldColor);
  try {
    const layers = doc.layers;
    for(let i=0;i<layers.length;i++) {
      const layer = layers[i];
      const lname = (layer.name||'').toLowerCase();
      const isCutL = lname.includes(cutName), isFoldL = lname.includes(foldName);
      const items = layer.pageItems||[];
      for(let j=0;j<items.length;j++) {
        const item = items[j];
        const bounds = item.geometricBounds||item.bounds;
        if(!bounds) continue;
        const pd = { left:bounds[0], top:bounds[1], right:bounds[2], bottom:bounds[3], width:Math.abs(bounds[2]-bounds[0]), height:Math.abs(bounds[3]-bounds[1]) };
        const sc = getStrokeRgb(item);
        if(isCutL  || colorMatch(sc,cutRgb))  cutPaths.push(pd);
        if(isFoldL || colorMatch(sc,foldRgb)) foldPaths.push(pd);
      }
    }
  } catch(e) {}
  return { success:true, cutPaths, foldPaths, panels:detectPanels(cutPaths,foldPaths) };
}

function getStrokeRgb(item) {
  try {
    const c = item.strokeColor;
    if(!c) return null;
    if(c.red !== undefined) return { r:Math.round(c.red), g:Math.round(c.green), b:Math.round(c.blue) };
    if(c.cyan !== undefined) return cmykToRgb(c.cyan,c.magenta,c.yellow,c.black);
  } catch(e) {}
  return null;
}

function hexToRgb(hex) { return { r:parseInt(hex.slice(1,3),16), g:parseInt(hex.slice(3,5),16), b:parseInt(hex.slice(5,7),16) }; }
function cmykToRgb(c,m,y,k) { return { r:Math.round(255*(1-c/100)*(1-k/100)), g:Math.round(255*(1-m/100)*(1-k/100)), b:Math.round(255*(1-y/100)*(1-k/100)) }; }
function colorMatch(a,b,t=40) { return a&&b&&Math.abs(a.r-b.r)<t&&Math.abs(a.g-b.g)<t&&Math.abs(a.b-b.b)<t; }

function detectPanels(cutPaths, foldPaths) {
  const all = [...cutPaths,...foldPaths];
  if(!all.length) return [];
  const minX=Math.min(...all.map(p=>p.left)), maxX=Math.max(...all.map(p=>p.right));
  const minY=Math.min(...all.map(p=>Math.min(p.top,p.bottom))), maxY=Math.max(...all.map(p=>Math.max(p.top,p.bottom)));
  const vS=[], hS=[];
  foldPaths.forEach(p => {
    if(p.width<p.height*0.2) vS.push((p.left+p.right)/2);
    if(p.height<p.width*0.2) hS.push((p.top+p.bottom)/2);
  });
  const vU=[...new Set(vS.map(v=>Math.round(v)))].sort((a,b)=>a-b);
  const hU=[...new Set(hS.map(v=>Math.round(v)))].sort((a,b)=>a-b);
  const xB=[minX,...vU,maxX], yB=[minY,...hU,maxY];

  // Ham panelleri çıkar
  const raw=[]; let idx=0;
  for(let yi=0;yi<yB.length-1;yi++) for(let xi=0;xi<xB.length-1;xi++) {
    const pw=Math.abs(xB[xi+1]-xB[xi]), ph=Math.abs(yB[yi+1]-yB[yi]);
    if(pw<2||ph<2) continue;
    raw.push({id:idx++, x:xB[xi], y:yB[yi], w:pw, h:ph, face:'extra', label:'Ekstra'});
  }
  if(!raw.length) return [];

  // Ana gövde satırını bul: en yüksek ortalama panel yüksekliğine sahip yatay bant
  const rowBuckets={};
  raw.forEach(p=>{
    const key=Math.round((p.y+p.h/2)/5)*5;
    if(!rowBuckets[key]) rowBuckets[key]=[];
    rowBuckets[key].push(p);
  });
  let mainKey=null, maxAvgH=0;
  Object.keys(rowBuckets).forEach(k=>{
    const avg=rowBuckets[k].reduce((s,p)=>s+p.h,0)/rowBuckets[k].length;
    if(avg>maxAvgH){maxAvgH=avg;mainKey=k;}
  });
  const mainRow=(rowBuckets[mainKey]||[]).sort((a,b)=>a.x-b.x);
  const mainMinY=Math.min(...mainRow.map(p=>p.y));
  const mainMaxY=Math.max(...mainRow.map(p=>p.y+p.h));

  // Ana satır yüz ataması: sol→sağ: flap, front, right, back, left
  const MAIN_FACES=['flap','front','right','back','left'];
  mainRow.forEach((p,i)=>{ p.face=MAIN_FACES[i]||'extra'; p.label=FACE_LABELS[p.face]||'Panel'; });

  // Üst/alt kapaklar
  raw.filter(p=>!mainRow.includes(p)).forEach(p=>{
    if(p.y+p.h <= mainMinY+5) { p.face='top';    p.label=FACE_LABELS['top']; }
    else if(p.y >= mainMaxY-5) { p.face='bottom'; p.label=FACE_LABELS['bottom']; }
    else                        { p.face='extra';  p.label='Ekstra'; }
  });

  return raw;
}

function simulateScan() {
  const {W,H,D}=state.settings, TH=D*1.1, GF=D*0.6;
  return {
    success:true, simulated:true,
    cutPaths:[{left:0,top:0,right:GF+W+D+W,bottom:TH*2+H,width:GF+W+D+W,height:TH*2+H}],
    foldPaths:[
      {left:GF,top:0,right:GF,bottom:TH*2+H,width:0,height:TH*2+H},
      {left:GF+W,top:0,right:GF+W,bottom:TH*2+H,width:0,height:TH*2+H},
      {left:GF+W+D,top:0,right:GF+W+D,bottom:TH*2+H,width:0,height:TH*2+H},
      {left:0,top:TH,right:GF+W+D+W,bottom:TH,width:GF+W+D+W,height:0},
      {left:0,top:TH+H,right:GF+W+D+W,bottom:TH+H,width:GF+W+D+W,height:0},
    ],
    panels:[
      {id:0,x:0,y:TH,w:GF,h:H,face:'flap',label:'Yapıştırma'},
      {id:1,x:GF,y:TH,w:W,h:H,face:'front',label:'Ön'},
      {id:2,x:GF+W,y:TH,w:D,h:H,face:'right',label:'Sağ Yan'},
      {id:3,x:GF+W+D,y:TH,w:W,h:H,face:'back',label:'Arka'},
      {id:4,x:GF,y:0,w:W,h:TH,face:'top',label:'Üst Kapak'},
      {id:5,x:GF+W+D,y:TH+H,w:W,h:TH,face:'bottom',label:'Alt Kapak'},
    ],
  };
}

function showPanelEditor(panels) {
  const img = document.getElementById('dieEditorImg');
  if (!img || !img.naturalWidth) return;
  const natW = img.naturalWidth, natH = img.naturalHeight;
  const overlays = document.getElementById('panelOverlays');
  if (!overlays) return;
  overlays.innerHTML = '';

  panels.forEach(p => {
    const col = FACE_COLORS[p.face] || '#666';
    const l = (p.x / natW * 100).toFixed(3);
    const t = (p.y / natH * 100).toFixed(3);
    const w = (p.w / natW * 100).toFixed(3);
    const h = (p.h / natH * 100).toFixed(3);

    const div = document.createElement('div');
    div.style.cssText = `position:absolute;left:${l}%;top:${t}%;width:${w}%;height:${h}%;background:${col}33;border:1.5px solid ${col}cc;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s`;
    div.dataset.id = p.id;

    const lbl = document.createElement('span');
    lbl.className = 'overlay-label';
    lbl.style.color = col;
    lbl.textContent = p.label;
    div.appendChild(lbl);

    div.addEventListener('mouseenter', () => div.style.background = col+'55');
    div.addEventListener('mouseleave', () => div.style.background = col+'33');
    div.addEventListener('click', e => { e.stopPropagation(); showFacePopup(p.id, div); });
    overlays.appendChild(div);
  });
}

function showFacePopup(panelId, anchorEl) {
  const popup = document.getElementById('facePopup');
  if (!popup) return;
  const panel = state.panels.find(p => p.id === panelId);
  if (!panel) return;

  popup.innerHTML = FACE_OPTIONS.map(o =>
    `<button class="fpbtn${panel.face===o.v?' active':''}" data-v="${o.v}">${o.l}</button>`
  ).join('');

  popup.querySelectorAll('.fpbtn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.face  = btn.dataset.v;
      panel.label = FACE_LABELS[panel.face] || panel.face;
      popup.style.display = 'none';
      showPanelEditor(state.panels);
      if (boxInit) buildBoxFrom({panels: state.panels});
    });
  });

  // Popup'ı anchor'a göre konumlandır
  const wrap = document.getElementById('dieEditorWrap');
  const wRect = wrap.getBoundingClientRect();
  const aRect = anchorEl.getBoundingClientRect();
  popup.style.display = 'block';
  let top  = aRect.bottom - wRect.top + 2;
  let left = aRect.left   - wRect.left;
  popup.style.top  = top + 'px';
  popup.style.left = left + 'px';
  // Sağ taşmayı önle
  const pw = popup.offsetWidth, ww = wrap.offsetWidth;
  if (left + pw > ww) popup.style.left = Math.max(0, ww - pw) + 'px';
  // Alt taşmayı önle
  const ph = popup.offsetHeight, wh = wrap.offsetHeight;
  if (top + ph > wh) popup.style.top = Math.max(0, aRect.top - wRect.top - ph - 2) + 'px';
}

// ─── IMAGE ANALYSIS ───────────────────────────────
async function analyzeImagePaths(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 800;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const cw = Math.round(img.width * scale);
        const ch = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        const px = ctx.getImageData(0, 0, cw, ch).data;
        const cutRgb  = hexToRgb(state.settings.cutColor);
        const foldRgb = hexToRgb(state.settings.foldColor);
        const TOL = 65;

        const cutRows  = new Int32Array(ch), cutCols  = new Int32Array(cw);
        const foldRows = new Int32Array(ch), foldCols = new Int32Array(cw);
        let cMinX=cw, cMinY=ch, cMaxX=0, cMaxY=0;

        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const i = (y * cw + x) * 4;
            if (px[i+3] < 30) continue;
            const c = {r:px[i], g:px[i+1], b:px[i+2]};
            if (colorMatch(c, cutRgb, TOL)) {
              cutRows[y]++; cutCols[x]++;
              if (x < cMinX) cMinX=x; if (x > cMaxX) cMaxX=x;
              if (y < cMinY) cMinY=y; if (y > cMaxY) cMaxY=y;
            }
            if (colorMatch(c, foldRgb, TOL)) {
              foldRows[y]++; foldCols[x]++;
            }
          }
        }

        const inv = 1 / scale;
        const cutPaths = [];
        if (cMaxX > cMinX && cMaxY > cMinY) {
          cutPaths.push({
            left: cMinX*inv, top: cMinY*inv,
            right: cMaxX*inv, bottom: cMaxY*inv,
            width: (cMaxX-cMinX)*inv, height: (cMaxY-cMinY)*inv
          });
        }

        const minHits = Math.max(4, Math.round(Math.min(cw, ch) * 0.04));
        const foldPaths = [];

        let inLine=false, lineStart=0;
        for (let y=0; y<=ch; y++) {
          const hit = y<ch && foldRows[y]>minHits;
          if (hit && !inLine)  { inLine=true; lineStart=y; }
          else if (!hit && inLine) {
            inLine=false;
            const ly = ((lineStart+y-1)/2)*inv;
            foldPaths.push({left:cMinX*inv, top:ly, right:cMaxX*inv, bottom:ly, width:(cMaxX-cMinX)*inv, height:0});
          }
        }
        inLine=false;
        for (let x=0; x<=cw; x++) {
          const hit = x<cw && foldCols[x]>minHits;
          if (hit && !inLine)  { inLine=true; lineStart=x; }
          else if (!hit && inLine) {
            inLine=false;
            const lx = ((lineStart+x-1)/2)*inv;
            foldPaths.push({left:lx, top:cMinY*inv, right:lx, bottom:cMaxY*inv, width:0, height:(cMaxY-cMinY)*inv});
          }
        }

        resolve({cutPaths, foldPaths});
      } catch(e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Görsel yüklenemedi'));
    img.src = imageUrl;
  });
}

async function scanFromImage() {
  if (!state.dielineUrl) { showStatus('Önce blank bıçak izi görseli yükleyin.', 'err'); return; }
  const btn = document.getElementById('scanImageBtn');
  btn.disabled = true; btn.textContent = 'Analiz ediliyor...';
  showStatus('Blank diecut piksel analizi yapılıyor...', '');
  try {
    const {cutPaths, foldPaths} = await analyzeImagePaths(state.dielineUrl);
    if (!cutPaths.length && !foldPaths.length) {
      showStatus(`Çizgi bulunamadı. Ayarlardaki kesim (${state.settings.cutColor}) ve kırım (${state.settings.foldColor}) renklerini kontrol edin.`, 'err');
      return;
    }
    const panels = detectPanels(cutPaths, foldPaths);
    state.cutPaths=cutPaths; state.foldPaths=foldPaths;
    state.panels=panels; state.scanned=true;
    showResults({cutPaths, foldPaths, panels, simulated:false});
    if (boxInit) buildBoxFrom({panels});
  } catch(e) {
    showStatus('Hata: '+(e.message||String(e)), 'err');
  } finally {
    btn.disabled=false; btn.textContent='Analiz Et';
  }
}

// ─── UI ───────────────────────────────────────────
function showStatus(msg, type) {
  const box = document.getElementById('statusBox');
  box.textContent = msg;
  box.className = 'status' + (type ? ' '+type : '');
}

function showResults(result) {
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsList').innerHTML = [
    {dot:state.settings.cutColor,  label:'Kesim çizgisi', count:result.cutPaths.length},
    {dot:state.settings.foldColor, label:'Kırım çizgisi', count:result.foldPaths.length},
    {dot:'#c8b97a', label:'Panel tespit', count:result.panels.length},
  ].map(item=>`
    <div class="rrow">
      <div class="rlabel"><div class="rdot" style="background:${item.dot}"></div>${item.label}</div>
      <div class="rcount">${item.count}</div>
    </div>
  `).join('');
  const msg = result.simulated
    ? `Demo mod — ${result.panels.length} panel. Döküman açıkken tara.`
    : `${result.cutPaths.length} kesim + ${result.foldPaths.length} kırım. ${result.panels.length} panel.`;
  showStatus(msg, result.panels.length>0?'ok':'');
  showPanelEditor(result.panels);
}

// ─── CSS 3D BOX ───────────────────────────────────
let tgt={x:0.4,y:0.6}, cur={x:0.4,y:0.6};
let isDrag=false, px0=0, py0=0, rotActive=true, boxInit=false, animRunning=false;
let lastBuildResult=null;
let zoomScale=1, zoomTgt=1;

function initThreeIfNeeded() {
  if(boxInit) return;
  boxInit=true;
  const scene=document.getElementById('scene3d');
  scene.addEventListener('mousedown',e=>{isDrag=true;px0=e.clientX;py0=e.clientY;});
  scene.addEventListener('mousemove',e=>{
    if(!isDrag)return;
    tgt.y+=(e.clientX-px0)*0.012; tgt.x+=(e.clientY-py0)*0.012;
    tgt.x=Math.max(-1.4,Math.min(1.4,tgt.x)); px0=e.clientX; py0=e.clientY;
  });
  scene.addEventListener('mouseup',()=>isDrag=false);
  scene.addEventListener('mouseleave',()=>isDrag=false);
  scene.addEventListener('wheel',e=>{
    zoomTgt = Math.max(0.3, Math.min(3, zoomTgt - e.deltaY * 0.001));
    e.preventDefault();
  },{passive:false});
  buildBoxFrom(state.scanned?{panels:state.panels}:simulateScan());
  if(!animRunning){animRunning=true;animLoop();}
}

function buildBoxFrom(result) {
  lastBuildResult = result;
  const box=document.getElementById('box3d');
  if(!box)return;
  box.innerHTML='';

  const panels=result?.panels||[];
  const faceMap={};
  panels.forEach(p=>{if(p.face)faceMap[p.face]=p;});

  // Boyutları doğrudan panel piksellerinden türet
  const fp=faceMap['front'], rp=faceMap['right']||faceMap['left'], tp=faceMap['top']||faceMap['bottom'];
  const W_px = fp?.w  || state.settings.W;
  const H_px = fp?.h  || state.settings.H;
  const D_px = rp?.w  || tp?.h || state.settings.D;
  const sc   = 150 / Math.max(W_px, H_px, D_px);
  const w=W_px*sc, h=H_px*sc, d=D_px*sc;

  // Flat layout bounds (görsel eşlemesi için)
  let flatMinX=Infinity,flatMinY=Infinity,flatMaxX=-Infinity,flatMaxY=-Infinity;
  panels.forEach(p=>{
    flatMinX=Math.min(flatMinX,p.x); flatMinY=Math.min(flatMinY,p.y);
    flatMaxX=Math.max(flatMaxX,p.x+p.w); flatMaxY=Math.max(flatMaxY,p.y+p.h);
  });
  const flatW=isFinite(flatMaxX)?flatMaxX-flatMinX:1;
  const flatH=isFinite(flatMaxY)?flatMaxY-flatMinY:1;

  [
    {name:'front',  fw:w,fh:h, tr:`translateZ(${d/2}px)`},
    {name:'back',   fw:w,fh:h, tr:`rotateY(180deg) translateZ(${d/2}px)`},
    {name:'right',  fw:d,fh:h, tr:`rotateY(90deg) translateZ(${w/2}px)`},
    {name:'left',   fw:d,fh:h, tr:`rotateY(-90deg) translateZ(${w/2}px)`},
    {name:'top',    fw:w,fh:d, tr:`rotateX(-90deg) translateZ(${h/2}px)`},
    {name:'bottom', fw:w,fh:d, tr:`rotateX(90deg) translateZ(${h/2}px)`},
  ].forEach(f=>{
    const col=FACE_COLORS[f.name]||'#666';
    const panel=faceMap[f.name];
    const label=panel?.label||FACE_LABELS[f.name]||'';
    const isSelected=state.selectedFace===f.name;
    const el=document.createElement('div');
    el.className='face3d';
    el.dataset.face=f.name;

    let bgStyle, showLabel=true;
    if(state.artworkUrl && panel) {
      const bgW=flatW*sc, bgH=flatH*sc;
      const bgX=-(panel.x-flatMinX)*sc, bgY=-(panel.y-flatMinY)*sc;
      bgStyle=`background-image:url('${state.artworkUrl}');background-size:${bgW}px ${bgH}px;background-position:${bgX}px ${bgY}px;background-repeat:no-repeat;`;
      showLabel=false;
    } else {
      bgStyle=`background:${col}22;`;
    }
    const borderStyle=isSelected?`border:2px solid #c8b97a;`:`border:1.5px solid ${col}bb;`;
    el.style.cssText=`width:${f.fw}px;height:${f.fh}px;margin-left:${-f.fw/2}px;margin-top:${-f.fh/2}px;transform:${f.tr};${bgStyle}${borderStyle}color:${col}dd;cursor:pointer;`;
    if(showLabel) el.textContent=label;

    el.addEventListener('click', e=>{
      e.stopPropagation();
      state.selectedFace=f.name;
      snap(f.name);
      buildBoxFrom(lastBuildResult);
      const info=document.getElementById('faceInfo');
      if(info) info.textContent=label;
    });
    box.appendChild(el);
  });
}

function animLoop() {
  requestAnimationFrame(animLoop);
  if(rotActive&&!isDrag) tgt.y+=0.007;
  cur.x+=(tgt.x-cur.x)*0.1; cur.y+=(tgt.y-cur.y)*0.1;
  zoomScale+=(zoomTgt-zoomScale)*0.12;
  const box=document.getElementById('box3d');
  if(box) box.style.transform=`scale(${zoomScale.toFixed(3)}) rotateX(${(cur.x*180/Math.PI).toFixed(2)}deg) rotateY(${(cur.y*180/Math.PI).toFixed(2)}deg)`;
}

function snap(face) {
  const s={front:{x:0,y:0},back:{x:0,y:Math.PI},right:{x:0,y:-Math.PI/2},left:{x:0,y:Math.PI/2},top:{x:-Math.PI/2,y:0},bottom:{x:Math.PI/2,y:0}};
  if(s[face]){tgt.x=s[face].x;tgt.y=s[face].y;}
}

function toggleRot() {
  rotActive=!rotActive;
  document.getElementById('vbtn-rot').classList.toggle('on',rotActive);
  document.getElementById('vbtn-rot').textContent=rotActive?'↻ Döndür':'↻ Dur';
}

function resizeRenderer() {}

// ─── EVENT LISTENERS — inline onclick yok ─────────
window.addEventListener('load', () => {
  // Tab butonları
  document.getElementById('tab-scan-btn').addEventListener('click', () => switchTab('scan'));
  document.getElementById('tab-preview-btn').addEventListener('click', () => switchTab('preview'));
  document.getElementById('tab-settings-btn').addEventListener('click', () => switchTab('settings'));

  // Scan
  document.getElementById('scanBtn').addEventListener('click', scanDocument);
  document.getElementById('previewBtn').addEventListener('click', () => switchTab('preview'));

  // Settings
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('cutColor').addEventListener('input', () => updateDot('cut'));
  document.getElementById('foldColor').addEventListener('input', () => updateDot('fold'));

  // 3D view butonları
  ['front','top','right','back','bottom','left'].forEach(face => {
    document.getElementById('vbtn-'+face).addEventListener('click', () => snap(face));
  });
  document.getElementById('vbtn-rot').addEventListener('click', toggleRot);
  document.getElementById('vbtn-zoom-reset').addEventListener('click', () => { zoomTgt=1; });

  // Analiz Et butonu
  document.getElementById('scanImageBtn').addEventListener('click', scanFromImage);

  // Popup dışına tıklayınca kapat
  document.getElementById('dieEditorWrap')?.addEventListener('click', () => {
    document.getElementById('facePopup').style.display = 'none';
  });

  // 1 — Blank diecut yükleme (analiz için)
  document.getElementById('dielineInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', function(ev) {
      state.dielineUrl = ev.target.result;
      document.getElementById('dieEditorImg').src = ev.target.result;
      document.getElementById('dieEditor').style.display = 'block';
      document.getElementById('panelOverlays').innerHTML = '';
      document.getElementById('facePopup').style.display = 'none';
      document.getElementById('dielineUploadArea').style.borderColor = '#c8b97a';
    });
    reader.readAsDataURL(file);
  });

  // 2 — Tasarım görseli yükleme (texture için)
  document.getElementById('artworkInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', function(ev) {
      state.artworkUrl = ev.target.result;
      const prev = document.getElementById('artworkPreview');
      prev.src = ev.target.result;
      prev.style.display = 'block';
      document.getElementById('artworkUploadArea').style.borderColor = '#c8b97a';
      if(boxInit) buildBoxFrom(lastBuildResult || {panels: state.panels});
    });
    reader.readAsDataURL(file);
  });

  // Demo scan
  const result = simulateScan();
  state.cutPaths=result.cutPaths; state.foldPaths=result.foldPaths;
  state.panels=result.panels; state.scanned=true;
  showResults(result);
});

window.addEventListener('resize', resizeRenderer);
