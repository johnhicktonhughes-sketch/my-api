import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// --- Env / client ---
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_KEYS = new Set(
  (process.env.API_KEYS ?? "demo-key")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- Auth helper ---
function requireApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  if (!key || !API_KEYS.has(key)) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  return null;
}

/**
 * POST /api/v1/records/by-value
 * body: { value: number }
 * returns: { results: [{ row_number, record_id, total_value }] }
 */
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({} as any));
  const value = Number(body?.value);

  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
  }

  const minSell = 0.9 * value;
  const maxSell = 1.1 * value;

  // Fetch matching rows
  const { data, error } = await supabase
    .from("records")
    .select("record_id,total_value")
    .eq("prnk", 1)
    .gte("sell", minSell)
    .lte("sell", maxSell)
    .order("total_value", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // DISTINCT (record_id, total_value)
  const seen = new Set<string>();
  const distinct = (data ?? []).filter((r) => {
    const key = `${r.record_id}::${r.total_value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Add row_number (1-based), already ordered by total_value asc
  const results = distinct.map((r, i) => ({
    row_number: i + 1,
    record_id: r.record_id,
    total_value: r.total_value,
  }));

  return NextResponse.json({ results, number_of_results: results.length });
}
