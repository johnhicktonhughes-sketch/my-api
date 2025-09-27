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
 * POST /api/v1/records/intersect-by-category
 * body: { categories: string[] } // 1..3 UUIDs (or strings) of category ids
 * returns: { results: Array<{ row_number: number; record_id: string }>, number_of_results: number }
 *
 * Semantics (equivalent to your CTE example):
 *  - Keep record_ids that appear for ALL provided categories (intersection).
 */
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  // Parse body strictly (avoid `any`)
  let categories: string[] = [];
  try {
    const json = (await req.json()) as unknown;
    if (json && typeof json === "object" && "categories" in (json as Record<string, unknown>)) {
      const arr = (json as Record<string, unknown>).categories;
      if (Array.isArray(arr) && arr.every(x => typeof x === "string")) {
        categories = arr.slice(0, 3); // cap at 3 per your requirement
      }
    }
  } catch {
    // fall through with empty categories
  }

  if (categories.length === 0) {
    return NextResponse.json({ error: "categories must be a non-empty array (max 3)" }, { status: 400 });
  }

  // Pull only the columns we need, limited to those categories
  const { data, error } = await supabase
    .from("records")
    .select("record_id,category") // minimal payload
    .in("category", categories);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ results: [], number_of_results: 0 });
  }

  // Group: record_id -> set of categories seen
  const need = new Set(categories); // which categories must be present
  const byId = new Map<string, Set<string>>();

  for (const r of rows) {
    const rid = String(r.record_id);
    const cat = String(r.category);
    const set = byId.get(rid) ?? new Set<string>();
    set.add(cat);
    byId.set(rid, set);
  }

  // Keep only record_ids that have ALL required categories
  const hits: string[] = [];
  outer: for (const [rid, set] of byId) {
    for (const c of need) {
      if (!set.has(c)) continue outer;
    }
    hits.push(rid);
  }

  // Sort for stable output, add row_number (1-based)
  hits.sort(); // choose any order; change to custom sort if you prefer
  const results = hits.map((record_id, i) => ({
    row_number: i + 1,
    record_id,
  }));

  return NextResponse.json({
    results,
    number_of_results: results.length,
  });
}
