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
 * body: { value: number, products?: string[] }   // products length 0..3
 * 
 * Output: { results: [{ row_number, record_id, total_value }] }
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

  // --- Step 1: base set (prnk=1 & sell in range)
  const { data: baseRows, error: baseErr } = await supabase
    .from("records")
    .select("record_id,total_value,sell,prnk")
    .eq("prnk", 1)
    .gte("sell", minSell)
    .lte("sell", maxSell);

  if (baseErr) {
    return NextResponse.json({ error: baseErr.message }, { status: 500 });
  }

  // If nothing in base, early exit
  if (!baseRows || baseRows.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Build a map for quick total_value lookup (by record_id) from the base rows
  const baseMap = new Map<string, number>();
  for (const r of baseRows) {
    // If there are duplicates per record_id in base, keep the max total_value
    const prev = baseMap.get(r.record_id);
    if (prev == null || (typeof r.total_value === "number" && r.total_value > prev)) {
      baseMap.set(r.record_id, r.total_value);
    }
  }

  // Start with base set of record_ids
  let intersection = new Set(baseMap.keys());

  // --- Step 2: for each product, intersect record_ids where product = that id
  for (const p of products) {
    if (!p || typeof p !== "string") continue;

    const { data: prodRows, error: prodErr } = await supabase
      .from("records")
      .select("record_id")
      .eq("product", p);

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 500 });
    }

    const prodSet = new Set<string>((prodRows ?? []).map((r) => r.record_id));

    // Intersect with current working set
    intersection = new Set([...intersection].filter((id) => prodSet.has(id)));

    // Early exit if empty
    if (intersection.size === 0) {
      return NextResponse.json({ results: [] });
    }
  }

  // --- Step 3: gather results (only those in intersection), using total_value from baseMap
  const results = [...intersection]
    .map((record_id) => ({
      record_id,
      total_value: baseMap.get(record_id) ?? 0,
    }))
    .sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0));

  // --- Step 4: rank (row_number starting at 1)
  const ranked = results.map((r, i) => ({
    row_number: i + 1,
    record_id: r.record_id,
    total_value: r.total_value,
  }));

  return NextResponse.json({ results: ranked });
}
