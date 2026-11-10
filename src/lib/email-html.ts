import { escapeHtml, mdToHtml, type Rapport } from "./rapport";

/**
 * Compte rendu → mail HTML aux couleurs du Port (styles en ligne : lisible dans Gmail, Apple Mail, Outlook).
 */

const C = { ink: "#2a2140", soft: "#5b5470", paper: "#fbf6ec", edge: "#e6dac4", sea: "#2f6f9f", moss: "#2e9d62", phare: "#d8433a" };

function inlineStyles(html: string): string {
  return html
    .replace(/<p>/g, `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:${C.ink}">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 10px;padding-left:20px;font-size:14px;line-height:1.55;color:${C.ink}">`)
    .replace(/<ol>/g, `<ol style="margin:0 0 10px;padding-left:20px;font-size:14px;line-height:1.55;color:${C.ink}">`)
    .replace(/<li>/g, `<li style="margin:0 0 4px">`)
    .replace(/<h([345])>/g, `<h$1 style="margin:14px 0 6px;font-size:15px;color:${C.ink}">`)
    .replace(/<table>/g, `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:13px">`)
    .replace(/<th>/g, `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid ${C.edge};color:${C.soft};font-size:11px;text-transform:uppercase;letter-spacing:.4px">`)
    .replace(/<td>/g, `<td style="padding:6px 8px;border-bottom:1px solid ${C.edge};vertical-align:top;color:${C.ink}">`)
    .replace(/<blockquote>/g, `<blockquote style="margin:6px 0;padding:8px 12px;border-left:3px solid ${C.sea};background:#f3f7fb">`)
    .replace(/<code>/g, `<code style="background:#f2eee5;padding:0 4px;border-radius:3px;font-size:12px">`)
    .replace(/<a /g, `<a style="color:${C.sea}" `);
}

export function rapportEmailHtml(r: Rapport, o: { kicker: string; lienPort?: string; aValider?: number }): string {
  const section = (titre: string, body: string) =>
    `<tr><td style="padding:18px 24px 4px"><div style="font-size:16px;font-weight:700;color:${C.ink};border-bottom:2px solid ${C.ink};padding-bottom:4px;margin-bottom:8px">${escapeHtml(titre)}</div>${body}</td></tr>`;
  const douane =
    o.aValider && o.lienPort
      ? `<tr><td style="padding:14px 24px 0"><a href="${o.lienPort}/douane" style="display:block;background:${C.phare};color:#fff;text-decoration:none;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:600">📦 ${o.aValider} élément${o.aValider > 1 ? "s" : ""} à valider en Douane →</a></td></tr>`
      : "";
  const etapes = r.prochaines_etapes?.length
    ? section(
        "Prochaines étapes",
        inlineStyles(
          `<table><thead><tr><th>Action</th><th>Qui</th><th>Quand</th></tr></thead><tbody>${r.prochaines_etapes
            .map((e) => `<tr><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.qui ?? "—")}</td><td>${escapeHtml(e.echeance ?? "—")}</td></tr>`)
            .join("")}</tbody></table>`,
        ),
      )
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#efe7f7">
<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(#cfc2ef,#f6d9c9);padding:24px 0"><tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:${C.paper};border:1px solid ${C.edge};border-radius:18px;font-family:'Helvetica Neue',Arial,sans-serif">
<tr><td style="padding:22px 24px 6px">
  <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.soft}">⚓ LE PORT · ${escapeHtml(o.kicker)}</div>
  <div style="font-size:22px;font-weight:800;color:${C.ink};margin-top:4px">${escapeHtml(r.titre)}</div>
</td></tr>
<tr><td style="padding:10px 24px 0"><div style="background:#eaf6ef;border-left:4px solid ${C.moss};border-radius:0 10px 10px 0;padding:12px 14px;font-size:15px;line-height:1.5;color:${C.ink}">${escapeHtml(r.resume)}</div></td></tr>
${douane}
${r.points_cles?.length ? section("Points clés", inlineStyles(`<ul>${r.points_cles.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`)) : ""}
${r.sections.map((s) => section(s.titre, inlineStyles(mdToHtml(s.contenu)))).join("\n")}
${etapes}
<tr><td style="padding:18px 24px 22px;font-size:12px;color:${C.soft}">${o.lienPort ? `<a href="${o.lienPort}" style="color:${C.sea}">Ouvrir LE PORT</a> · ` : ""}Envoyé automatiquement par les agents de MJAGENCY.</td></tr>
</table></td></tr></table></body></html>`;
}
