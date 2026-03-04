import { useState, useRef, useCallback } from "react";

const PUNCH = "#6C3BFF";
const LIME  = "#C8F135";
const INK   = "#0F0F0F";
const WARM  = "#F9F6F1";

// ── Minimal CSS-in-JS helpers ──────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    background: WARM,
    fontFamily: "'Calibri', 'Georgia', serif",
    color: INK,
    padding: "0",
  },
  header: {
    background: INK,
    padding: "20px 40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    fontFamily: "Georgia, serif",
    fontWeight: "700",
    fontSize: "22px",
    color: "#fff",
    letterSpacing: "-0.5px",
  },
  logoAccent: { color: LIME },
  tagline: { color: "#888", fontSize: "13px" },
  main: {
    maxWidth: "780px",
    margin: "0 auto",
    padding: "48px 24px 80px",
  },
  heroTitle: {
    fontSize: "clamp(28px, 5vw, 42px)",
    fontWeight: "800",
    lineHeight: 1.1,
    marginBottom: "12px",
    fontFamily: "Georgia, serif",
  },
  heroSub: {
    color: "#666",
    fontSize: "16px",
    marginBottom: "40px",
    lineHeight: 1.6,
  },
  card: {
    background: "#fff",
    borderRadius: "16px",
    padding: "32px",
    marginBottom: "20px",
    border: "1.5px solid #ebebeb",
    boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
  },
  cardTitle: {
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "2px",
    textTransform: "uppercase",
    color: PUNCH,
    marginBottom: "16px",
  },
  langRow: {
    display: "flex",
    gap: "12px",
    marginBottom: "0",
  },
  langBtn: (active) => ({
    flex: 1,
    padding: "12px",
    borderRadius: "10px",
    border: active ? `2px solid ${PUNCH}` : "2px solid #ebebeb",
    background: active ? `${PUNCH}12` : "#fff",
    color: active ? PUNCH : "#666",
    fontWeight: active ? "700" : "400",
    fontSize: "15px",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "Calibri, Georgia, serif",
  }),
  tabRow: {
    display: "flex",
    gap: "0",
    marginBottom: "20px",
    borderBottom: "2px solid #ebebeb",
  },
  tab: (active) => ({
    padding: "10px 20px",
    background: "none",
    border: "none",
    borderBottom: active ? `2px solid ${PUNCH}` : "2px solid transparent",
    marginBottom: "-2px",
    color: active ? PUNCH : "#999",
    fontWeight: active ? "700" : "400",
    fontSize: "14px",
    cursor: "pointer",
    fontFamily: "Calibri, Georgia, serif",
    transition: "all 0.15s",
  }),
  textarea: {
    width: "100%",
    minHeight: "220px",
    padding: "16px",
    border: "1.5px solid #e0e0e0",
    borderRadius: "10px",
    fontSize: "14px",
    lineHeight: 1.6,
    resize: "vertical",
    fontFamily: "Calibri, Georgia, serif",
    color: INK,
    background: WARM,
    boxSizing: "border-box",
    outline: "none",
    transition: "border 0.15s",
  },
  dropzone: (drag) => ({
    border: `2px dashed ${drag ? PUNCH : "#d0d0d0"}`,
    borderRadius: "12px",
    padding: "40px 20px",
    textAlign: "center",
    background: drag ? `${PUNCH}08` : WARM,
    cursor: "pointer",
    transition: "all 0.2s",
  }),
  dropIcon: {
    fontSize: "32px",
    marginBottom: "10px",
  },
  dropText: {
    color: "#666",
    fontSize: "14px",
    lineHeight: 1.6,
  },
  fileChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    background: `${PUNCH}15`,
    color: PUNCH,
    padding: "6px 14px",
    borderRadius: "20px",
    fontSize: "13px",
    fontWeight: "600",
    marginTop: "12px",
  },
  generateBtn: (loading) => ({
    width: "100%",
    padding: "18px",
    background: loading ? "#ccc" : INK,
    color: loading ? "#888" : LIME,
    border: "none",
    borderRadius: "12px",
    fontSize: "17px",
    fontWeight: "800",
    cursor: loading ? "not-allowed" : "pointer",
    letterSpacing: "0.5px",
    fontFamily: "Georgia, serif",
    transition: "all 0.2s",
    marginTop: "8px",
  }),
  resultCard: {
    background: "#fff",
    borderRadius: "16px",
    padding: "32px",
    border: `2px solid ${PUNCH}`,
    boxShadow: `0 0 0 4px ${PUNCH}15`,
    marginTop: "24px",
  },
  resultHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "24px",
  },
  resultName: {
    fontSize: "24px",
    fontWeight: "800",
    fontFamily: "Georgia, serif",
    lineHeight: 1.2,
  },
  resultRole: {
    color: "#888",
    fontSize: "14px",
    marginTop: "4px",
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginBottom: "24px",
  },
  badge: (ok) => ({
    padding: "5px 12px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "600",
    background: ok ? "#dcfce7" : "#fff3cd",
    color: ok ? "#166534" : "#92400e",
  }),
  sectionLabel: {
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "2px",
    textTransform: "uppercase",
    color: PUNCH,
    marginBottom: "10px",
    paddingLeft: "10px",
    borderLeft: `4px solid ${LIME}`,
  },
  toolsTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
    marginBottom: "20px",
  },
  whyBox: {
    background: WARM,
    borderLeft: `4px solid ${LIME}`,
    padding: "14px 18px",
    borderRadius: "0 8px 8px 0",
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#374151",
    fontStyle: "italic",
    marginBottom: "20px",
  },
  copyBtn: {
    padding: "10px 20px",
    background: WARM,
    border: `1.5px solid ${PUNCH}`,
    color: PUNCH,
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    fontFamily: "Calibri, Georgia, serif",
  },
  errorBox: {
    background: "#fff0f0",
    border: "1.5px solid #fca5a5",
    borderRadius: "10px",
    padding: "16px 20px",
    color: "#991b1b",
    fontSize: "14px",
    marginTop: "16px",
  },
  loader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px",
    gap: "16px",
    color: "#888",
    fontSize: "15px",
  },
};

// ── Spinner ────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: "inline-block", width: 32, height: 32 }}>
      <svg viewBox="0 0 32 32" style={{ animation: "spin 0.8s linear infinite" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <circle cx="16" cy="16" r="12" fill="none" stroke="#ebebeb" strokeWidth="3"/>
        <path d="M16 4 A12 12 0 0 1 28 16" fill="none" stroke={PUNCH} strokeWidth="3" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// ── Result View ────────────────────────────────────────────
function ResultView({ data, lang }) {
  const [copied, setCopied] = useState(false);

  const copyText = () => {
    const text = `${data.name}
${data.role} · ${data.location} · ${data.modality}

QUICK SNAPSHOT
${Object.entries(data.snapshot).map(([k,v]) => `✅ ${k}: ${v}`).join('\n')}

TOOLS & HERRAMIENTAS
${data.tools.map(t => `${t.tool} | ${t.years} | ${t.level}`).join('\n')}

${lang === 'es' ? 'EL CANDIDATO EN 3 LÍNEAS' : 'THE CANDIDATE IN 3 LINES'}
${data.why}

HWG Talent Consultants · ${new Date().toLocaleDateString(lang === 'es' ? 'es-AR' : 'en-US', {day:'2-digit',month:'long',year:'numeric'})}
www.hwgtalent.com`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const snapLabels = lang === 'es'
    ? { techFit: "Fit técnico", exp: "Experiencia", cult: "Culture fit", lang: "Idiomas", avail: "Disponibilidad", salary: "Pretensión salarial" }
    : { techFit: "Technical fit", exp: "Experience", cult: "Culture fit", lang: "Languages", avail: "Availability", salary: "Salary expectation" };

  return (
    <div style={styles.resultCard}>
      <div style={styles.resultHeader}>
        <div>
          <div style={styles.resultName}>{data.name}</div>
          <div style={styles.resultRole}>{data.role} · {data.location} · {data.modality}</div>
        </div>
        <button style={styles.copyBtn} onClick={copyText}>
          {copied ? "✓ Copiado" : "Copiar texto"}
        </button>
      </div>

      {/* Snapshot badges */}
      <div style={styles.sectionLabel}>Quick Snapshot</div>
      <div style={{ marginBottom: 24 }}>
        {[
          [snapLabels.techFit, data.snapshot.techFit, true],
          [snapLabels.exp,     data.snapshot.exp,     true],
          [snapLabels.cult,    data.snapshot.cult,    true],
          [snapLabels.lang,    data.snapshot.lang,    true],
          [snapLabels.avail,   data.snapshot.avail,   data.snapshot.avail !== "[COMPLETAR]"],
          [snapLabels.salary,  data.snapshot.salary,  data.snapshot.salary !== "[COMPLETAR]"],
        ].map(([label, value, ok], i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #f0f0f0", alignItems: "flex-start" }}>
            <span style={{ fontSize: 16, minWidth: 20 }}>{ok ? "✅" : "⬜"}</span>
            <span style={{ fontWeight: 700, minWidth: 160, fontSize: 14, color: "#374151" }}>{label}</span>
            <span style={{ fontSize: 14, color: INK }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Tools table */}
      <div style={styles.sectionLabel}>Tools & Herramientas</div>
      <table style={styles.toolsTable}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${PUNCH}` }}>
            <th style={{ textAlign: "left", padding: "6px 10px", color: "#888", fontWeight: 600, fontSize: 12 }}>
              {lang === 'es' ? 'Herramienta' : 'Tool'}
            </th>
            <th style={{ textAlign: "center", padding: "6px 10px", color: "#888", fontWeight: 600, fontSize: 12 }}>
              {lang === 'es' ? 'Años' : 'Years'}
            </th>
            <th style={{ textAlign: "left", padding: "6px 10px", color: "#888", fontWeight: 600, fontSize: 12 }}>
              {lang === 'es' ? 'Nivel & contexto' : 'Level & context'}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.tools.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? WARM : "#fff" }}>
              <td style={{ padding: "9px 10px", fontWeight: 700, fontSize: 14 }}>{row.tool}</td>
              <td style={{ padding: "9px 10px", textAlign: "center", color: PUNCH, fontWeight: 700, fontSize: 14 }}>{row.years}</td>
              <td style={{ padding: "9px 10px", color: "#6b7280", fontSize: 14 }}>{row.level}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Why */}
      <div style={styles.sectionLabel}>
        {lang === 'es' ? 'El candidato/a en 3 líneas' : 'The candidate in 3 lines'}
      </div>
      <div style={styles.whyBox}>{data.why}</div>

      {/* Footer */}
      <div style={{ textAlign: "center", borderTop: "1px solid #ebebeb", paddingTop: 16, marginTop: 8 }}>
        <div style={{ color: "#999", fontSize: 13 }}>
          {lang === 'es' ? 'Presentado por' : 'Presented by'}{" "}
          <strong style={{ color: INK }}>HWG Talent Consultants</strong>{" "}
          · {new Date().toLocaleDateString(lang === 'es' ? 'es-AR' : 'en-US', { day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
        <div style={{ color: PUNCH, fontWeight: 700, fontSize: 13, marginTop: 2 }}>
          www.hwgtalent.com
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────
export default function HWGApp() {
  const [lang,      setLang]      = useState("es");
  const [file,      setFile]      = useState(null);
  const [fileText,  setFileText]  = useState("");
  const [notes,     setNotes]     = useState("");
  const [drag,      setDrag]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState(null);
  const fileRef = useRef();

  // ── File reading ──
  const readFile = useCallback(async (f) => {
    setFile(f);
    const text = await f.text().catch(() => "");
    setFileText(text || `[Archivo: ${f.name} — el contenido será procesado por Claude]`);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  }, [readFile]);

  // ── Generate ──
  const generate = async () => {
    const cv = fileText;
    if (!cv.trim()) { setError(lang === 'es' ? "Por favor subí un CV antes de continuar." : "Please upload a CV before continuing."); return; }
    setError(null); setLoading(true); setResult(null);

    const today = new Date().toLocaleDateString(lang === 'es' ? 'es-AR' : 'en-US', { day: '2-digit', month: 'long', year: 'numeric' });
    const isEs = lang === 'es';

    const prompt = `Sos un recruiter senior de HWG Talent Consultants. Analizá el siguiente CV y extraé la información para completar una presentación de candidato.

CV:
---
${cv}
---
${notes.trim() ? `\nNOTAS DEL RECRUITER (incorporalas naturalmente en la presentación, especialmente en el campo "why"):\n---\n${notes.trim()}\n---` : ""}

Respondé ÚNICAMENTE con un JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:
{
  "name": "Nombre completo del candidato",
  "role": "Título profesional más relevante del CV",
  "location": "Ciudad/País si está disponible, sino [COMPLETAR]",
  "modality": "${isEs ? 'Remoto / Híbrido / Presencial según el CV, sino [COMPLETAR]' : 'Remote / Hybrid / On-site if available, else [COMPLETE]'}",
  "snapshot": {
    "techFit": "${isEs ? 'Una línea sobre si cumple el perfil técnico general' : 'One line on technical fit'}",
    "exp": "${isEs ? 'Años de experiencia y área principal' : 'Years of experience and main area'}",
    "cult": "${isEs ? 'Rasgo de cultura más relevante (ej: perfil startup, académico, corporativo)' : 'Most relevant culture trait'}",
    "lang": "${isEs ? 'Idiomas y nivel' : 'Languages and level'}",
    "avail": "[COMPLETAR]",
    "salary": "[COMPLETAR]"
  },
  "tools": [
    { "tool": "Nombre herramienta", "years": "X años", "level": "${isEs ? 'Nivel y contexto breve' : 'Level and brief context'}" }
  ],
  "why": "${isEs ? 'Párrafo de 3-4 líneas. Quién es, qué lo hace relevante, su logro más impactante. Directo, sin relleno.' : '3-4 line paragraph. Who they are, what makes them relevant, most impactful achievement. Direct, no filler.'}"
}

REGLAS:
- tools: entre 4 y 6 items, los más relevantes del CV
- Si algo no está en el CV, usá "[COMPLETAR]"
- ${isEs ? 'Todo en español' : 'Everything in English'}
- Solo JSON, nada más`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      const raw = data.content?.map(c => c.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
    } catch (e) {
      setError("Hubo un error al procesar el CV. Revisá que el texto sea legible e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoAccent}>HWG</span> Talent Consultants
        </div>
        <div style={styles.tagline}>Candidate Presentation Generator</div>
      </div>

      <div style={styles.main}>
        {/* Hero */}
        <div style={styles.heroTitle}>
          CV → Presentación<br />
          <span style={{ color: PUNCH }}>en 10 segundos.</span>
        </div>
        <div style={styles.heroSub}>
          Subí el CV, elegí el idioma, y la presentación HWG sale lista.
        </div>

        {/* Lang selector */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Idioma de salida</div>
          <div style={styles.langRow}>
            <button style={styles.langBtn(lang === "es")} onClick={() => setLang("es")}>
              🇦🇷 Español
            </button>
            <button style={styles.langBtn(lang === "en")} onClick={() => setLang("en")}>
              🇺🇸 English
            </button>
          </div>
        </div>

        {/* CV Input */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>CV</div>

          <div
            style={styles.dropzone(drag)}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current.click()}
          >
            <input
              ref={fileRef} type="file"
              accept=".pdf,.doc,.docx,.txt"
              style={{ display: "none" }}
              onChange={e => e.target.files[0] && readFile(e.target.files[0])}
            />
            <div style={styles.dropIcon}>📄</div>
            <div style={styles.dropText}>
              {file
                ? <span style={styles.fileChip}>✓ {file.name}</span>
                : <>Arrastrá el archivo acá o <strong style={{ color: PUNCH }}>hacé click para seleccionar</strong><br/><span style={{ fontSize: 12, color: "#aaa" }}>PDF, Word o TXT</span></>
              }
            </div>
          </div>

          {/* Notes field */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#999", marginBottom: 10 }}>
              Notas o contexto adicional{" "}
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#bbb" }}>— opcional</span>
            </div>
            <textarea
              style={{ ...styles.textarea, minHeight: "110px", borderStyle: "dashed" }}
              placeholder={lang === 'es'
                ? "Ej: Lo conozco de una búsqueda anterior, es muy proactivo. Busca proyecto con impacto real..."
                : "E.g.: I know him from a previous search, very proactive. Looking for a project with real impact..."}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onFocus={e => e.target.style.border = `1.5px solid ${PUNCH}`}
              onBlur={e => e.target.style.border = "1.5px dashed #e0e0e0"}
            />
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button
            style={styles.generateBtn(loading)}
            onClick={generate}
            disabled={loading}
          >
            {loading ? "Generando..." : lang === 'es' ? "Generar presentación →" : "Generate presentation →"}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={styles.loader}>
            <Spinner />
            <span>Claude está leyendo el CV y armando la presentación...</span>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <ResultView data={result} lang={lang} />
        )}
      </div>
    </div>
  );
}
