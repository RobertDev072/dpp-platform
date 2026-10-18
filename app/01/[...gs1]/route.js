import { NextResponse } from "next/server";

// GS1 Digital Link-resolver op het QR-domein: /01/{GTIN}[/10/{lot}][/21/{serienummer}]
// stuurt door naar het meest specifieke openbare paspoort (item → batch → model). Zo kan
// een GS1-QR-code of NFC-tag met een Digital Link direct naar VeriPasso wijzen.
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { gs1 } = await params;
  const path = `/01/${(gs1 || []).map((part) => encodeURIComponent(decodeURIComponent(part))).join("/")}`;
  const url = new URL(request.url);
  const origin = process.env.INTERNAL_API_ORIGIN || url.origin;
  const response = await fetch(`${origin}/api/v1/resolve?link=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!response.ok) {
    return new NextResponse(
      `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Productpaspoort niet gevonden</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#0f172a"><h1 style="font-size:20px">Productpaspoort niet gevonden</h1><p>Voor deze productcode is (nog) geen openbaar paspoort.</p></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  const { url: target } = await response.json();
  // Relatieve Location: blijft op het domein waarop gescand is (ook achter de proxy).
  const location = new URL(target);
  return new NextResponse(null, { status: 307, headers: { Location: `${location.pathname}${url.search}`, "Cache-Control": "public, max-age=300" } });
}
