// app/api/v1/records/match/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_KEYS = new Set(
  (process.env.API_KEYS ?? "demo-key")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function requireApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  if (!key || !API_KEYS.has(key)) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  return null;
}

/**
 * POST /api/v1/records/match
 * body: { value: number, products?: string[] }   // up to 3 product IDs
 * 
 * Returns:
 * { results: [{ row_number: number, record_id: string, total_value: number }] }
 */
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({} as any));
  const value = Number(body?.value);
  const products: string[] = Array.isArray(body?.products) ? body.products : [];

  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
  }
  if (products.length > 3) {
    return NextResponse.json({ error: "products may have at most 3 items" }, { status: 400 });
  }

  const minSell = 0.9 * value;
  const maxSell = 1.1 * value;

  // ---- Base set: prnk=1 AND sell in [0.9*value, 1.1*value]
  // Keep only the columns we need.
  const { data: baseRows, error: baseErr } = await supabase
    .from("records")
    .select("record_id,total_value")
    .eq("prnk", 1)
    .gte("sell", minSell)
    .lte("sell", maxSell);

  if (baseErr) return NextResponse.json({ error: baseErr.message }, { status: 500 });

  if (!baseRows || baseRows.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Map record_id -> max(total_value) (in case of duplicates in base)
  const baseValueById = new Map<string, number>();
  for (const r of baseRows) {
    const prev = baseValueById.get(r.record_id);
    if (prev == null || (typeof r.total_value === "number" && r.total_value > prev)) {
      baseValueById.set(r.record_id, r.total_value ?? 0);
    }
  }

  // Start with all base record_ids
  let intersection = new Set(baseValueById.keys());

  // ---- For each product: fetch DISTINCT record_ids, then intersect
  for (const p of products) {
    if (!p) continue;

    const { data: prodRows, error: prodErr } = await supabase
      .from("records")
      .select("record_id") // we only need record_id
      .eq("product", p);

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 500 });
    }

    // Ensure distinct record_ids from this product query
    const prodSet = new Set<string>((prodRows ?? []).map(r => r.record_id));

    // Intersect by record_id
    intersection = new Set([...intersection].filter(id => prodSet.has(id)));

    if (intersection.size === 0) {
      return NextResponse.json({ results: [] });
    }
  }

  // ---- Build final results only for ids in the intersection
  const results = [...intersection]
    .map(record_id => ({
      record_id,
      total_value: baseValueById.get(record_id) ?? 0,
    }))
    .sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0))
    .map((row, idx) => ({
      row_number: idx + 1,
      record_id: row.record_id,
      total_value: row.total_value,
    }));

  return NextResponse.json({ results });
}
