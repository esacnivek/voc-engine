import { useState } from "react";

const sampleTickets = [
  { id: 1, subject: "App crashes on login", body: "Every time I try to log in, the app just crashes. Very frustrating, I've been a customer for 3 years!", status: "open" },
  { id: 2, subject: "Can't find invoice", body: "Where do I download my invoice? The billing section is confusing and I can't find anything.", status: "solved" },
  { id: 3, subject: "Slow loading times", body: "The dashboard takes forever to load. Sometimes 30+ seconds. This is unusable for our team.", status: "open" },
  { id: 4, subject: "Great support experience!", body: "Just wanted to say your team was amazing. Sarah resolved my issue in minutes. 10/10!", status: "solved" },
  { id: 5, subject: "Integration with Slack broken", body: "Our Slack integration stopped working after your last update. Notifications aren't coming through.", status: "pending" },
  { id: 6, subject: "Need bulk export feature", body: "We really need a way to export all our data in bulk. This is blocking our reporting workflow.", status: "open" },
  { id: 7, subject: "Pricing confusion", body: "Your pricing page is unclear. I don't understand what's included in each tier.", status: "solved" },
  { id: 8, subject: "Mobile app missing features", body: "The mobile app is missing half the features of the desktop version. When will it be updated?", status: "open" },
  { id: 9, subject: "Password reset not working", body: "I've tried resetting my password 4 times. The email never arrives.", status: "open" },
  { id: 10, subject: "Excellent onboarding!", body: "The onboarding flow was smooth and intuitive. Got my team set up in under an hour.", status: "solved" },
];

export default function App() {
  const [screen, setScreen] = useState("setup");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [useDemo, setUseDemo] = useState(true);
  const [zdSubdomain, setZdSubdomain] = useState("");
  const [zdEmail, setZdEmail] = useState("");
  const [zdToken, setZdToken] = useState("");
  const [zdPassword, setZdPassword] = useState("");
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  const analyze = async () => {
    if (!anthropicKey) { setError("Anthropic API key is required."); return; }
    setError("");
    setScreen("analyzing");
    setProgress(10);
    setProgressLabel("Fetching tickets...");

    let tickets = sampleTickets;

    if (!useDemo) {
      try {
        setProgress(25);
        if (!zdSubdomain) throw new Error("Zendesk subdomain is required.");
        if (!zdEmail) throw new Error("Zendesk email is required.");
        if (!zdToken) throw new Error("Zendesk API token is required.");
        const auth = btoa(`${zdEmail}/token:${zdToken}`);
        let res;
        try {
          res = await fetch(`https://${zdSubdomain}.zendesk.com/api/v2/tickets.json?per_page=50&sort_by=created_at&sort_order=desc`, {
            headers: { "Authorization": `Basic ${auth}` }
          });
        } catch (networkErr) {
          throw new Error(`Network error reaching Zendesk — this is likely a CORS issue. Browsers block direct Zendesk API calls. Try using Demo mode, or route requests through a backend proxy.`);
        }
        if (res.status === 401) throw new Error("Zendesk auth failed (401) — check your email and API token.");
        if (res.status === 403) throw new Error("Zendesk access denied (403) — your account may lack permission to read tickets.");
        if (res.status === 404) throw new Error(`Zendesk subdomain "${zdSubdomain}" not found (404) — check your subdomain.`);
        if (!res.ok) throw new Error(`Zendesk returned an unexpected error (HTTP ${res.status}).`);
        const data = await res.json();
        if (!data.tickets?.length) throw new Error("Zendesk returned no tickets. Your account may have no tickets, or the API response was unexpected.");
        tickets = data.tickets.map(t => ({ id: t.id, subject: t.subject || "", body: t.description || "", status: t.status }));
      } catch (e) {
        setError(e.message);
        setScreen("setup");
        return;
      }
    }

    setProgress(50);
    setProgressLabel("Sending to Claude for analysis...");

    const prompt = `You are a senior customer insights analyst. Analyze these ${tickets.length} support tickets and return a JSON report.

Tickets:
${tickets.map(t => `[#${t.id}] Subject: ${t.subject}\nBody: ${t.body}\nStatus: ${t.status}`).join("\n---\n")}

Return ONLY valid JSON (no markdown) with this exact structure:
{
  "executive_summary": "2-3 sentence overview of key findings",
  "total_tickets": number,
  "sentiment_breakdown": { "positive": number, "neutral": number, "negative": number },
  "top_issues": [{ "theme": string, "count": number, "urgency": "high"|"medium"|"low", "quotes": [string] }],
  "emerging_trends": [{ "trend": string, "description": string, "urgency": "high"|"medium"|"low" }],
  "suggested_faqs": [{ "question": string, "answer": string }],
  "health_score": number between 0-100
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error("Invalid Anthropic API key (401) — make sure it starts with sk-ant- and has no extra spaces.");
        if (res.status === 429) throw new Error("Anthropic rate limit hit (429) — wait a moment and try again.");
        if (res.status === 500) throw new Error("Anthropic server error (500) — try again in a few seconds.");
        throw new Error(errData.error?.message || `Anthropic API error (HTTP ${res.status}).`);
      }

      setProgress(85);
      setProgressLabel("Building your insights report...");

      const data = await res.json();
      const raw = data.content[0].text.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("Claude returned an unexpected response format. Please try again.");
      }
      setInsights(parsed);
      setProgress(100);
      setTimeout(() => setScreen("results"), 400);
    } catch (e) {
      setError(e.message);
      setScreen("setup");
    }
  };

  const urgencyColor = (u) => u === "high" ? "#ff4d4d" : u === "medium" ? "#ffaa00" : "#00cc88";
  const sentimentTotal = insights
    ? insights.sentiment_breakdown.positive + insights.sentiment_breakdown.neutral + insights.sentiment_breakdown.negative
    : 1;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e4dc", fontFamily: "Georgia, serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .serif { font-family: 'DM Serif Display', Georgia, serif; }
        .mono { font-family: 'DM Mono', monospace; }
        input { outline: none; background: transparent; }
        input::placeholder { color: #444; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        .fadeUp { animation: fadeUp 0.5s ease forwards; }
        .btn-primary { transition: opacity 0.2s; }
        .btn-primary:hover { opacity: 0.85; }
      `}</style>

      <div style={{ borderBottom: "1px solid #1a1a2e", padding: "18px 36px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#c8a96e", boxShadow: "0 0 10px #c8a96e88" }} />
        <span className="mono" style={{ fontSize: 12, color: "#c8a96e", letterSpacing: "0.15em" }}>VOICE OF CUSTOMER ENGINE</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#2a2a3e", fontFamily: "monospace" }}>Powered by Claude</span>
      </div>

      {screen === "setup" && (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "56px 24px" }} className="fadeUp">
          <h1 className="serif" style={{ fontSize: 48, lineHeight: 1.1, marginBottom: 16 }}>
            Customer<br /><em style={{ color: "#c8a96e" }}>Intelligence</em><br />Engine
          </h1>
          <p style={{ color: "#555", fontSize: 15, lineHeight: 1.7, marginBottom: 48 }}>
            Drop in your Zendesk tickets and get executive-grade insights, sentiment analysis, and auto-drafted FAQs — powered by Claude.
          </p>

          {error && (
            <div style={{ background: "#1a0808", border: "1px solid #ff4d4d33", borderRadius: 6, padding: "12px 16px", marginBottom: 24, color: "#ff6b6b", fontSize: 13, fontFamily: "monospace" }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <label className="mono" style={{ fontSize: 10, color: "#c8a96e", letterSpacing: "0.12em", display: "block", marginBottom: 10 }}>ANTHROPIC API KEY *</label>
            <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-..."
              style={{ width: "100%", border: "1px solid #1e1e30", borderRadius: 6, padding: "12px 14px", color: "#e8e4dc", fontSize: 14, fontFamily: "monospace", background: "#0d0d1a" }} />
          </div>

          <div style={{ marginBottom: 28 }}>
            <label className="mono" style={{ fontSize: 10, color: "#c8a96e", letterSpacing: "0.12em", display: "block", marginBottom: 12 }}>DATA SOURCE</label>
            <div style={{ display: "flex", gap: 10 }}>
              {[{ label: "Demo Tickets", val: true }, { label: "My Zendesk", val: false }].map(o => (
                <button key={String(o.val)} onClick={() => setUseDemo(o.val)} style={{
                  flex: 1, padding: "11px", borderRadius: 6, cursor: "pointer",
                  background: useDemo === o.val ? "#c8a96e15" : "transparent",
                  border: `1px solid ${useDemo === o.val ? "#c8a96e" : "#1e1e30"}`,
                  color: useDemo === o.val ? "#c8a96e" : "#444",
                  fontFamily: "DM Mono, monospace", fontSize: 13, transition: "all 0.2s"
                }}>{o.label}</button>
              ))}
            </div>
          </div>

          {!useDemo && (
            <div style={{ padding: "20px", background: "#0d0d1a", border: "1px solid #1e1e30", borderRadius: 8, marginBottom: 28 }}>
              {[
                { label: "SUBDOMAIN", ph: "yourcompany", val: zdSubdomain, set: setZdSubdomain },
                { label: "EMAIL", ph: "admin@company.com", val: zdEmail, set: setZdEmail },
                { label: "ADMIN PASSWORD", ph: "Your admin password", val: zdPassword, set: setZdPassword, pwd: true },
                { label: "API TOKEN", ph: "Your Zendesk API token", val: zdToken, set: setZdToken, pwd: true },
              ].map(f => (
                <div key={f.label} style={{ marginBottom: 16 }}>
                  <label className="mono" style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em", display: "block", marginBottom: 7 }}>{f.label}</label>
                  <input type={f.pwd ? "password" : "text"} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                    style={{ width: "100%", border: "1px solid #1a1a2e", borderRadius: 4, padding: "9px 12px", color: "#e8e4dc", fontSize: 13, fontFamily: "monospace", background: "#08080f" }} />
                </div>
              ))}
            </div>
          )}

          <button className="btn-primary" onClick={analyze} style={{
            width: "100%", padding: "15px", background: "#c8a96e", color: "#0a0a0f",
            border: "none", borderRadius: 6, fontSize: 15, fontFamily: "DM Serif Display, Georgia, serif",
            cursor: "pointer", letterSpacing: "0.04em"
          }}>Generate Insights Report →</button>

          {useDemo && <p className="mono" style={{ fontSize: 11, color: "#2a2a3e", marginTop: 10, textAlign: "center" }}>10 pre-loaded sample tickets — no Zendesk account needed</p>}
        </div>
      )}

      {screen === "analyzing" && (
        <div style={{ maxWidth: 440, margin: "0 auto", padding: "100px 24px", textAlign: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", border: "2px solid #1e1e30", borderTopColor: "#c8a96e", margin: "0 auto 28px", animation: "spin 1s linear infinite" }} />
          <h2 className="serif" style={{ fontSize: 26, marginBottom: 10 }}>Analyzing tickets...</h2>
          <p className="mono" style={{ fontSize: 12, color: "#444", marginBottom: 28 }}>{progressLabel}</p>
          <div style={{ height: 2, background: "#1e1e30", borderRadius: 1 }}>
            <div style={{ height: "100%", background: "#c8a96e", borderRadius: 1, width: `${progress}%`, transition: "width 0.6s ease" }} />
          </div>
          <p className="mono" style={{ fontSize: 11, color: "#2a2a3e", marginTop: 8 }}>{progress}%</p>
        </div>
      )}

      {screen === "results" && insights && (
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 80px" }} className="fadeUp">

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
            {[
              { label: "Tickets Analyzed", val: insights.total_tickets },
              { label: "Health Score", val: `${insights.health_score}/100` },
              { label: "Issues Found", val: insights.top_issues?.length },
            ].map(m => (
              <div key={m.label} style={{ background: "#0d0d1a", border: "1px solid #1e1e30", borderRadius: 8, padding: "22px 18px" }}>
                <div className="serif" style={{ fontSize: 38, color: "#c8a96e", lineHeight: 1 }}>{m.val}</div>
                <div className="mono" style={{ fontSize: 10, color: "#333", marginTop: 8, letterSpacing: "0.08em" }}>{m.label.toUpperCase()}</div>
              </div>
            ))}
          </div>

          {[
            {
              title: "EXECUTIVE SUMMARY",
              content: <p style={{ fontSize: 16, lineHeight: 1.75, color: "#aaa8a0", fontStyle: "italic" }}>"{insights.executive_summary}"</p>
            },
            {
              title: "SENTIMENT BREAKDOWN",
              content: ["positive", "neutral", "negative"].map((k, i) => {
                const colors = ["#00cc88", "#ffaa00", "#ff4d4d"];
                const pct = Math.round((insights.sentiment_breakdown[k] / sentimentTotal) * 100);
                return (
                  <div key={k} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: "#666", fontFamily: "monospace", textTransform: "capitalize" }}>{k}</span>
                      <span className="mono" style={{ fontSize: 12, color: colors[i] }}>{pct}%</span>
                    </div>
                    <div style={{ height: 3, background: "#1a1a2e", borderRadius: 2 }}>
                      <div style={{ height: "100%", background: colors[i], borderRadius: 2, width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            },
            {
              title: "TOP ISSUES",
              content: insights.top_issues?.map((issue, i) => {
                const uc = urgencyColor(issue.urgency);
                return (
                  <div key={i} style={{ paddingBottom: 18, marginBottom: 18, borderBottom: i < insights.top_issues.length - 1 ? "1px solid #111120" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span className="serif" style={{ fontSize: 20, color: "#c8a96e" }}>{issue.count}</span>
                      <span style={{ fontSize: 14, color: "#ddd" }}>{issue.theme}</span>
                      <span style={{ marginLeft: "auto", padding: "2px 9px", borderRadius: 999, fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", background: uc + "22", color: uc, border: `1px solid ${uc}44` }}>{issue.urgency}</span>
                    </div>
                    {issue.quotes?.[0] && <p className="mono" style={{ fontSize: 11, color: "#333", fontStyle: "italic", lineHeight: 1.5 }}>"{issue.quotes[0]}"</p>}
                  </div>
                );
              })
            },
            {
              title: "EMERGING TRENDS",
              content: insights.emerging_trends?.map((t, i) => {
                const uc = urgencyColor(t.urgency);
                return (
                  <div key={i} style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: uc, marginTop: 6, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: "#ddd", marginBottom: 3 }}>{t.trend}</div>
                      <div style={{ fontSize: 12, color: "#444", lineHeight: 1.5, fontFamily: "monospace" }}>{t.description}</div>
                    </div>
                    <span style={{ flexShrink: 0, padding: "2px 9px", borderRadius: 999, fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", height: "fit-content", background: uc + "22", color: uc, border: `1px solid ${uc}44` }}>{t.urgency}</span>
                  </div>
                );
              })
            },
            {
              title: "AUTO-DRAFTED FAQS",
              content: insights.suggested_faqs?.map((faq, i) => (
                <div key={i} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < insights.suggested_faqs.length - 1 ? "1px solid #111120" : "none" }}>
                  <div style={{ fontSize: 14, color: "#ddd", marginBottom: 6, fontWeight: "bold" }}>Q: {faq.question}</div>
                  <div style={{ fontSize: 12, color: "#555", lineHeight: 1.6, fontFamily: "monospace" }}>A: {faq.answer}</div>
                </div>
              ))
            }
          ].map(section => (
            <div key={section.title} style={{ background: "#0d0d1a", border: "1px solid #1e1e30", borderRadius: 8, padding: "24px", marginBottom: 16 }}>
              <div className="mono" style={{ fontSize: 10, color: "#c8a96e", letterSpacing: "0.14em", marginBottom: 18 }}>{section.title}</div>
              {section.content}
            </div>
          ))}

          <button onClick={() => { setScreen("setup"); setInsights(null); setError(""); }} style={{
            padding: "11px 24px", background: "transparent", border: "1px solid #1e1e30",
            borderRadius: 6, color: "#444", fontFamily: "DM Mono, monospace", fontSize: 12, cursor: "pointer"
          }}>← Run Another Analysis</button>
        </div>
      )}
    </div>
  );
}
