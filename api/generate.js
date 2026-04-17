<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HWG Talent — Form Generator</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F9F6F1; font-family: 'DM Sans', sans-serif; color: #0F0F0F; }
    :root {
      --punch: #6C3BFF;
      --punch-light: #F0EBFF;
      --lime: #C8F135;
      --ink: #0F0F0F;
      --warm: #F9F6F1;
      --gray: #6B7280;
      --dark: #374151;
      --white: #ffffff;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
    .fade-in { animation: fadeIn 0.4s ease forwards; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useRef, useCallback } = React;

    let SUPABASE_URL = '';
    let SUPABASE_ANON_KEY = '';
    let APP_URL = 'https://hwg-app.vercel.app';

    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        SUPABASE_URL = cfg.supabaseUrl;
        SUPABASE_ANON_KEY = cfg.supabaseKey;
        APP_URL = cfg.appUrl;
      } catch(e) { console.error('Config error', e); }
    }
    loadConfig();

    function Spinner() {
      return (
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,padding:'40px 0'}}>
          <div style={{width:36,height:36,border:'3px solid #ebebeb',borderTopColor:'#6C3BFF',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          <span style={{color:'#888',fontSize:15}}>Claude está analizando el CV...</span>
        </div>
      );
    }

    // ── DOTS EDITABLES ──────────────────────────────────────────────────────────
    function EditableDots({ value, max, onChange }) {
      const getColor = (pts, total) => {
        const r = pts / total;
        if (r >= 0.67) return '#3B6D11';
        if (r >= 0.34) return '#BA7517';
        return '#E24B4A';
      };
      return (
        <div style={{display:'flex', gap:6, alignItems:'center'}}>
          {Array.from({length: max}).map((_, i) => (
            <div
              key={i}
              onClick={() => onChange(i + 1 === value ? 0 : i + 1)}
              title={`${i + 1} / ${max}`}
              style={{
                width: 13, height: 13, borderRadius: '50%', cursor: 'pointer',
                background: i < value ? getColor(value, max) : '#E5E7EB',
                border: '1.5px solid ' + (i < value ? getColor(value, max) : '#D1D5DB'),
                transition: 'all 0.15s',
              }}
            />
          ))}
        </div>
      );
    }

    // ── PREVIEW DEL PERFIL (vista del recruiter antes de publicar) ──────────────
    function ProfilePreview({ data, fitCriteria, onFitChange, storytelling, onStoryChange, gaps, onGapsChange, recommendation, onRecChange, personal, onPersonalChange }) {
      const today = new Date().toLocaleDateString('es-AR', {day:'2-digit',month:'long',year:'numeric'});
      const techFitTotal = (fitCriteria.expRol || 0) + (fitCriteria.stack || 0) + (fitCriteria.seniority || 0) + (fitCriteria.logros || 0);

      const recColor = recommendation.toLowerCase().includes('no recom') ? { bg: 'rgba(180,30,30,0.35)', color: '#FCA5A5' }
                     : recommendation.toLowerCase().includes('cautela')  ? { bg: 'rgba(0,0,0,0.25)', color: '#FAC775' }
                     : { bg: 'rgba(15,110,86,0.35)', color: '#6EE7B7' };

      const tools = Array.isArray(data.tools) ? data.tools : [];
      const experience = Array.isArray(data.experience) ? data.experience : [];

      const inputStyle = {
        border: 'none', borderBottom: '1.5px dashed #AFA9EC', outline: 'none',
        fontSize: 13, fontFamily: 'DM Sans,sans-serif', color: '#fff',
        background: 'transparent', padding: '2px 4px', width: '100%',
      };

      const sectionStyle = {
        background: '#fff', borderRadius: 12, padding: '1.25rem 1.5rem',
        border: '0.5px solid #E5E7EB', marginBottom: '1rem',
      };
      const sectionTitle = {
        fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: '#6B7280', marginBottom: 14, paddingBottom: 8, borderBottom: '0.5px solid #E5E7EB',
      };

      return (
        <div style={{maxWidth:720, margin:'0 auto', fontFamily:'DM Sans,sans-serif'}}>

          {/* HEADER */}
          <div style={{background:'#3C3489', borderRadius:14, padding:'1.5rem 2rem', marginBottom:'1rem'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem'}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:500,letterSpacing:'0.08em',color:'#CECBF6',textTransform:'uppercase',marginBottom:6}}>HWG Talent Consultants</div>
                <div style={{fontSize:26,fontWeight:600,color:'#fff',lineHeight:1.2,marginBottom:4}}>{data.name}</div>
                <div style={{fontSize:14,color:'#AFA9EC'}}>{data.role}{data.location ? ' · ' + data.location : ''}</div>
                <div style={{marginTop:10}}>
                  <select
                    value={recommendation}
                    onChange={e => onRecChange(e.target.value)}
                    style={{background:'rgba(0,0,0,0.25)',border:'none',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:500,color:recColor.color,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}
                  >
                    <option value="Recomendado/a para entrevistar">Recomendado/a para entrevistar</option>
                    <option value="Perfil a evaluar con cautela">Perfil a evaluar con cautela</option>
                    <option value="No recomendado/a para esta posición">No recomendado/a para esta posición</option>
                  </select>
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginLeft:'1rem'}}>
                <div style={{fontSize:11,color:'#CECBF6',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4}}>Presentado para</div>
                <div style={{fontSize:15,fontWeight:500,color:'#fff'}}>{data.role}</div>
                <div style={{fontSize:13,color:'#AFA9EC',marginTop:2}}>{personal.company || ''}</div>
                <div style={{fontSize:12,color:'#AFA9EC',marginTop:6}}>{today}</div>
              </div>
            </div>

            {/* CONTACTO EDITABLE */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10,paddingTop:'1rem',borderTop:'0.5px solid rgba(255,255,255,0.15)'}}>
              {[
                {label:'LinkedIn', key:'linkedin'},
                {label:'Teléfono', key:'phone'},
                {label:'Email', key:'email'},
                {label:'Pretensión salarial', key:'salary'},
              ].map(({label, key}) => (
                <div key={key} style={{display:'flex',flexDirection:'column',gap:3}}>
                  <span style={{fontSize:10,letterSpacing:'0.06em',textTransform:'uppercase',color:'#CECBF6'}}>{label}</span>
                  <input
                    style={inputStyle}
                    value={personal[key] || ''}
                    onChange={e => onPersonalChange(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* EVALUACIÓN */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Evaluación del candidato</div>
            <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'1.5rem',alignItems:'center'}}>
              <div style={{textAlign:'center',background:'#F5F4F8',borderRadius:10,padding:'16px 20px',minWidth:100}}>
                <div style={{fontSize:40,fontWeight:600,color:'#534AB7',lineHeight:1}}>{techFitTotal}</div>
                <div style={{fontSize:13,color:'#6B7280',marginTop:2}}>de 10</div>
                <div style={{fontSize:10,letterSpacing:'0.06em',textTransform:'uppercase',color:'#6B7280',marginTop:8}}>Fit técnico</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:12,width:'100%'}}>
                {[
                  {label:'Experiencia en el rol', key:'expRol', max:3},
                  {label:'Stack y herramientas', key:'stack', max:3},
                  {label:'Seniority vs posición', key:'seniority', max:2},
                  {label:'Logros medibles relevantes', key:'logros', max:2},
                ].map(({label, key, max}) => (
                  <div key={key} style={{display:'flex',flexDirection:'column',gap:5}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:12,color:'#374151'}}>{label}</span>
                      <span style={{fontSize:11,color:'#6B7280'}}>{fitCriteria[key]} / {max}</span>
                    </div>
                    <EditableDots value={fitCriteria[key]} max={max} onChange={v => onFitChange(key, v)} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,marginTop:12}}>
              {[
                {label:'Inglés', value: data.snapshot?.englishLevel || '—'},
                {label:'Disponibilidad', value: personal.availability || '—'},
                {label:'Años de experiencia', value: data.snapshot?.exp || '—'},
              ].map(({label, value}) => (
                <div key={label} style={{background:'#F5F4F8',borderRadius:8,padding:12,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'#6B7280',marginBottom:5}}>{label}</div>
                  <div style={{fontSize:15,fontWeight:500,color:'#111827'}}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* MIRADA DEL RECRUITER — EDITABLE */}
          <div style={sectionStyle}>
            <div style={sectionTitle}>Mirada del recruiter</div>
            <textarea
              value={storytelling}
              onChange={e => onStoryChange(e.target.value)}
              style={{
                width:'100%',minHeight:100,padding:'14px 16px',
                background:'#EEEDFE',borderLeft:'3px solid #534AB7',
                borderTop:'none',borderRight:'none',borderBottom:'none',
                borderRadius:'0 8px 8px 0',fontSize:14,lineHeight:1.75,
                color:'#3C3489',resize:'vertical',fontFamily:'DM Sans,sans-serif',outline:'none',
              }}
            />
          </div>

          {/* GAPS — EDITABLES */}
          {gaps.length > 0 && (
            <div style={sectionStyle}>
              <div style={sectionTitle}>Gaps a tener en cuenta</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {gaps.map((g, i) => (
                  <div key={i} style={{borderLeft:'2px solid #E24B4A',paddingLeft:12}}>
                    <input
                      value={g.title || ''}
                      onChange={e => { const updated = [...gaps]; updated[i] = {...g, title: e.target.value}; onGapsChange(updated); }}
                      style={{width:'100%',border:'none',borderBottom:'1px dashed #E24B4A',outline:'none',fontSize:13,fontWeight:500,color:'#A32D2D',marginBottom:4,background:'transparent',fontFamily:'DM Sans,sans-serif',padding:'2px 0'}}
                    />
                    <input
                      value={g.detail || ''}
                      onChange={e => { const updated = [...gaps]; updated[i] = {...g, detail: e.target.value}; onGapsChange(updated); }}
                      style={{width:'100%',border:'none',borderBottom:'1px dashed #D1D5DB',outline:'none',fontSize:13,color:'#6B7280',background:'transparent',fontFamily:'DM Sans,sans-serif',padding:'2px 0'}}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STACK */}
          {tools.length > 0 && (
            <div style={sectionStyle}>
              <div style={sectionTitle}>Stack técnico</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {tools.map((t,i) => (
                  <span key={i} style={{background:'#F5F4F8',border:'0.5px solid #E5E7EB',borderRadius:20,padding:'5px 13px',fontSize:13,color:'#374151'}}>
                    {t.tool}{t.years ? ' · ' + t.years : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* TRAYECTORIA */}
          {experience.length > 0 && (
            <div style={sectionStyle}>
              <div style={sectionTitle}>Trayectoria profesional</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {experience.map((e,i) => (
                  <div key={i} style={{display:'flex',flexDirection:'column',gap:2}}>
                    <div style={{fontSize:14,fontWeight:500,color:'#111827'}}>{e.role}</div>
                    <div style={{fontSize:12,color:'#6B7280'}}>{e.company}{e.period ? ' · ' + e.period : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FOOTER */}
          <div style={{paddingTop:12,borderTop:'0.5px solid #E5E7EB',display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
            <span style={{fontSize:12,fontWeight:500,color:'#6B7280'}}>HWG Talent Consultants</span>
            <span style={{fontSize:12,color:'#534AB7'}}>www.hwgtalent.com</span>
            <span style={{fontSize:12,color:'#6B7280'}}>{today}</span>
          </div>

          <div style={{marginTop:'1.25rem',fontSize:11,color:'#9CA3AF',lineHeight:1.75}}>
            * <strong style={{fontWeight:500,color:'#6B7280'}}>Cómo se calcula el fit técnico:</strong> el puntaje del 1 al 10 se construye sobre cuatro criterios evaluados contra la job description: experiencia directa en el rol (0–3 pts), dominio de herramientas y stack requerido (0–3 pts), nivel de seniority vs lo que pide la posición (0–2 pts), y logros medibles relevantes para el puesto (0–2 pts). Un puntaje de 7 o más indica recomendación para entrevistar. Entre 5 y 6, perfil a evaluar con cautela. Por debajo de 5, no recomendado para esta posición.
          </div>
        </div>
      );
    }

    // ── RESULT VIEW ─────────────────────────────────────────────────────────────
    function ResultView({data, lang, candidateId, positionId, recruiterId}) {
      const [fitCriteria, setFitCriteria] = useState({
        expRol:   data.fitCriteria?.expRol   ?? 0,
        stack:    data.fitCriteria?.stack    ?? 0,
        seniority:data.fitCriteria?.seniority?? 0,
        logros:   data.fitCriteria?.logros   ?? 0,
      });
      const [storytelling, setStorytelling] = useState(data.storytelling || '');
      const [gaps, setGaps] = useState(Array.isArray(data.gap) ? data.gap : []);
      const [recommendation, setRecommendation] = useState(data.recommendation || '');
      const [personal, setPersonal] = useState({
        linkedin:     data.personal?.linkedin     || '',
        phone:        data.personal?.phone        || '',
        email:        data.personal?.email        || '',
        salary:       data.personal?.salary       || '',
        availability: data.personal?.availability || '',
        company:      data.personal?.company      || '',
      });
      const [publishing, setPublishing] = useState(false);
      const [publishedUrl, setPublishedUrl] = useState(null);
      const [copied, setCopied] = useState(false);

      const updateFit = (key, val) => setFitCriteria(prev => ({...prev, [key]: val}));
      const updatePersonal = (key, val) => setPersonal(prev => ({...prev, [key]: val}));

      const techFitTotal = (fitCriteria.expRol||0) + (fitCriteria.stack||0) + (fitCriteria.seniority||0) + (fitCriteria.logros||0);

      const buildProfileData = () => ({
        ...data,
        storytelling,
        gap: gaps,
        recommendation,
        personal,
        snapshot: {
          ...data.snapshot,
          techFit: String(techFitTotal),
        },
        fitCriteria,
      });

      const publish = async () => {
        setPublishing(true);
        try {
          const profileData = buildProfileData();
          const res = await fetch('/api/save-profile', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              profile_data: profileData,
              candidate_id: candidateId || null,
              position_id:  positionId  || null,
              recruiter_id: recruiterId || null,
            })
          });
          const result = await res.json();
          if (!res.ok || result.error) throw new Error(result.error || 'Error al publicar');
          setPublishedUrl(result.url);
        } catch(e) {
          alert('Error al publicar: ' + e.message);
        } finally {
          setPublishing(false);
        }
      };

      const copyLink = () => {
        navigator.clipboard.writeText(publishedUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      };

      return (
        <div className="fade-in" style={{marginTop:24}}>

          {/* BARRA DE ACCIÓN */}
          <div style={{background:'#fff',borderRadius:12,padding:'16px 20px',marginBottom:20,border:'1.5px solid #6C3BFF',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:'#3C3489'}}>Vista previa — {data.name}</div>
              <div style={{fontSize:12,color:'#6B7280',marginTop:2}}>Editá los puntitos, el texto y la recomendación antes de publicar.</div>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {!publishedUrl ? (
                <button
                  onClick={publish}
                  disabled={publishing}
                  style={{padding:'10px 22px',background:publishing?'#ccc':'#3C3489',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:publishing?'not-allowed':'pointer',fontFamily:'DM Sans,sans-serif',whiteSpace:'nowrap'}}
                >
                  {publishing ? 'Publicando...' : 'Publicar y copiar link →'}
                </button>
              ) : (
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <div style={{background:'#F0EBFF',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#534AB7',fontWeight:500,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {publishedUrl}
                  </div>
                  <button
                    onClick={copyLink}
                    style={{padding:'9px 18px',background:copied?'#0F6E56':'#6C3BFF',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'DM Sans,sans-serif',whiteSpace:'nowrap',transition:'background 0.2s'}}
                  >
                    {copied ? '✓ Copiado' : 'Copiar link'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* PREVIEW */}
          <ProfilePreview
            data={data}
            fitCriteria={fitCriteria}
            onFitChange={updateFit}
            storytelling={storytelling}
            onStoryChange={setStorytelling}
            gaps={gaps}
            onGapsChange={setGaps}
            recommendation={recommendation}
            onRecChange={setRecommendation}
            personal={personal}
            onPersonalChange={updatePersonal}
          />
        </div>
      );
    }

    // ── APP ──────────────────────────────────────────────────────────────────────
    function App() {
      const params = new URLSearchParams(window.location.search);
      const [lang, setLang] = useState('es');
      const [file, setFile] = useState(null);
      const [fileText, setFileText] = useState('');
      const [notes, setNotes] = useState(params.get('notes')||'');
      const [position, setPosition] = useState(params.get('position')||'');
      const [interview, setInterview] = useState(null);
      const [drag, setDrag] = useState(false);
      const [dragInterview, setDragInterview] = useState(false);
      const [loading, setLoading] = useState(false);
      const [result, setResult] = useState(null);
      const [error, setError] = useState(null);
      const fileRef = useRef();
      const interviewRef = useRef();

      // IDs opcionales pasados por el ATS via query params
      const candidateId = params.get('candidate_id') || null;
      const positionId  = params.get('position_id')  || null;
      const recruiterId = params.get('recruiter_id') || null;

      const readFile = useCallback(async (f) => {
        setFile(f); setResult(null);
        if (f.type === 'application/pdf' || f.name.endsWith('.pdf')) {
          try {
            const pdfjsLib = window['pdfjs-dist/build/pdf'];
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const arrayBuffer = await f.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              fullText += content.items.map(item => item.str).join(' ') + '\n';
            }
            setFileText(fullText || `[Archivo: ${f.name}]`);
          } catch(e) {
            setFileText(`[Archivo: ${f.name} — no se pudo leer el PDF]`);
          }
        } else {
          const text = await f.text().catch(() => '');
          setFileText(text || `[Archivo: ${f.name}]`);
        }
      }, []);

      const onDrop = useCallback((e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) readFile(f);
      }, [readFile]);

      const generate = async () => {
        if (!file && !fileText) return alert('Subí el CV primero.');
        setLoading(true); setResult(null); setError(null);
        try {
          const formData = new FormData();
          formData.append('cv', file);
          formData.append('notes', notes);
          formData.append('lang', lang);
          formData.append('position', position);
          if (interview) formData.append('interview', interview);

          const res = await fetch('/api/generate', {
            method: 'POST',
            body: formData
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          const raw = (data.content||[]).map(c=>c.text||'').join('').replace(/```json|```/g,'').trim();
          const parsed = JSON.parse(raw);
          if (!parsed.personal) parsed.personal = {};
          parsed.personal.position = position || '';
          setResult(parsed);
        } catch(e) {
          setError(e.message || 'Hubo un error al procesar el CV. Intentá de nuevo.');
        } finally { setLoading(false); }
      };

      const btnStyle = (active) => ({
        flex:1, padding:'12px', borderRadius:10,
        border: active ? '2px solid #6C3BFF' : '2px solid #ebebeb',
        background: active ? '#F0EBFF' : '#fff',
        color: active ? '#6C3BFF' : '#666',
        fontWeight: active ? 700 : 400,
        fontSize:15, cursor:'pointer', fontFamily:'DM Sans,sans-serif', transition:'all 0.15s'
      });

      return (
        <div style={{minHeight:'100vh',background:'#F9F6F1'}}>
          <div style={{background:'#0F0F0F',padding:'18px 40px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontFamily:"'DM Serif Display',serif",fontWeight:700,fontSize:22,color:'#fff'}}>
              <span style={{color:'#C8F135'}}>HWG</span> Talent Consultants
            </div>
            <div style={{color:'#666',fontSize:13}}>CV → Presentación</div>
          </div>

          <div style={{maxWidth:760,margin:'0 auto',padding:'48px 24px 80px'}}>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:'clamp(28px,5vw,40px)',fontWeight:800,lineHeight:1.1,marginBottom:12}}>
              CV → Presentación<br/><span style={{color:'#6C3BFF'}}>en 10 segundos.</span>
            </div>
            <div style={{color:'#666',fontSize:16,marginBottom:40,lineHeight:1.6}}>
              Subí el CV, revisá el preview, editá lo que necesites y publicá el link para el cliente.
            </div>

            {position && (
              <div style={{background:'#F0EBFF',border:'1.5px solid #6C3BFF',borderRadius:12,padding:'12px 18px',marginBottom:20,display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:13,color:'#6C3BFF',fontWeight:700}}>📌 Posición precargada desde el ATS:</span>
                <span style={{fontSize:13,color:'#374151',fontWeight:600}}>{position}</span>
              </div>
            )}

            <div style={{background:'#fff',borderRadius:16,padding:28,marginBottom:20,border:'1.5px solid #ebebeb'}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#6C3BFF',marginBottom:14}}>Idioma de salida</div>
              <div style={{display:'flex',gap:12}}>
                <button style={btnStyle(lang==='es')} onClick={()=>setLang('es')}>🇦🇷 Español</button>
                <button style={btnStyle(lang==='en')} onClick={()=>setLang('en')}>🇺🇸 English</button>
              </div>
            </div>

            <div style={{background:'#fff',borderRadius:16,padding:28,marginBottom:20,border:'1.5px solid #ebebeb'}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#6C3BFF',marginBottom:14}}>CV</div>
              <div
                style={{border:`2px dashed ${drag?'#6C3BFF':'#d0d0d0'}`,borderRadius:12,padding:'36px 20px',textAlign:'center',background:drag?'#F0EBFF':'#F9F6F1',cursor:'pointer',transition:'all 0.2s'}}
                onDragOver={e=>{e.preventDefault();setDrag(true)}}
                onDragLeave={()=>setDrag(false)}
                onDrop={onDrop}
                onClick={()=>fileRef.current.click()}
              >
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{display:'none'}} onChange={e=>e.target.files[0]&&readFile(e.target.files[0])}/>
                <div style={{fontSize:32,marginBottom:8}}>📄</div>
                {file
                  ? <span style={{display:'inline-flex',alignItems:'center',gap:8,background:'#F0EBFF',color:'#6C3BFF',padding:'6px 14px',borderRadius:20,fontSize:13,fontWeight:700}}>✓ {file.name}</span>
                  : <div style={{color:'#666',fontSize:14,lineHeight:1.6}}>Arrastrá el archivo acá o <strong style={{color:'#6C3BFF'}}>hacé click para seleccionar</strong><br/><span style={{fontSize:12,color:'#aaa'}}>PDF, Word o TXT</span></div>
                }
              </div>

              <div style={{marginTop:20}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#999',marginBottom:10}}>
                  Entrevista <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,color:'#bbb'}}>— opcional</span>
                </div>
                <div
                  style={{border:`2px dashed ${dragInterview?'#6C3BFF':'#e0e0e0'}`,borderRadius:12,padding:'20px',textAlign:'center',background:dragInterview?'#F0EBFF':'#F9F6F1',cursor:'pointer',transition:'all 0.2s'}}
                  onDragOver={e=>{e.preventDefault();setDragInterview(true)}}
                  onDragLeave={()=>setDragInterview(false)}
                  onDrop={e=>{e.preventDefault();setDragInterview(false);const f=e.dataTransfer.files[0];if(f)setInterview(f);}}
                  onClick={()=>interviewRef.current.click()}
                >
                  <input ref={interviewRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{display:'none'}} onChange={e=>e.target.files[0]&&setInterview(e.target.files[0])}/>
                  {interview
                    ? <span style={{display:'inline-flex',alignItems:'center',gap:8,background:'#F0EBFF',color:'#6C3BFF',padding:'6px 14px',borderRadius:20,fontSize:13,fontWeight:700}}>✓ {interview.name} <span onClick={e=>{e.stopPropagation();setInterview(null);}} style={{cursor:'pointer',color:'#999',fontWeight:400}}>✕</span></span>
                    : <div style={{color:'#aaa',fontSize:13}}>📋 Subí la entrevista en PDF o Word</div>
                  }
                </div>
              </div>

              <div style={{marginTop:20}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#6C3BFF',marginBottom:10}}>
                  Posición para la que se presenta <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,color:'#bbb'}}>— opcional</span>
                </div>
                <input
                  type="text"
                  value={position}
                  onChange={e=>setPosition(e.target.value)}
                  placeholder="Ej: Data Analyst Senior · Empresa XYZ"
                  style={{width:'100%',padding:'12px 14px',border:'1.5px solid #e0e0e0',borderRadius:10,fontSize:14,fontFamily:'DM Sans,sans-serif',boxSizing:'border-box',outline:'none',marginBottom:16}}
                />
                <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#999',marginBottom:10}}>
                  Notas o contexto adicional <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,color:'#bbb'}}>— opcional</span>
                </div>
                <textarea
                  style={{width:'100%',minHeight:100,padding:14,border:'1.5px dashed #e0e0e0',borderRadius:10,fontSize:14,lineHeight:1.6,resize:'vertical',fontFamily:'DM Sans,sans-serif',color:'#0F0F0F',background:'#F9F6F1',outline:'none'}}
                  placeholder={lang==='es' ? 'Ej: Lo conozco de una búsqueda anterior, es muy proactivo. Busca proyecto con impacto real...' : 'E.g.: I know him from a previous search, very proactive. Looking for real impact...'}
                  value={notes}
                  onChange={e=>setNotes(e.target.value)}
                />
              </div>

              {error && <div style={{background:'#fff0f0',border:'1.5px solid #fca5a5',borderRadius:10,padding:'14px 18px',color:'#991b1b',fontSize:14,marginTop:16}}>{error}</div>}

              <button
                onClick={generate}
                disabled={loading}
                style={{width:'100%',padding:18,background:loading?'#ccc':'#0F0F0F',color:loading?'#888':'#C8F135',border:'none',borderRadius:12,fontSize:17,fontWeight:800,cursor:loading?'not-allowed':'pointer',fontFamily:"'DM Serif Display',serif",marginTop:16,transition:'all 0.2s'}}
              >
                {loading ? 'Generando...' : lang==='es' ? 'Generar presentación →' : 'Generate presentation →'}
              </button>
            </div>

            {loading && <Spinner />}
            {result && !loading && (
              <ResultView
                data={result}
                lang={lang}
                candidateId={candidateId}
                positionId={positionId}
                recruiterId={recruiterId}
              />
            )}
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
