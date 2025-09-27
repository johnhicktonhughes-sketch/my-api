// app/api/v1/records/byvalue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_KEYS = new Set((process.env.API_KEYS ?? "demo-key").split(",").map(s => s.trim()).filter(Boolean));

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

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  let json: unknown = null;
  try {
    json = await req.json();
  } catch {
    // leave json as null
  }

  let value: number | null = null;
  if (json && typeof json === "object" && "value" in json) {
    const v = (json as Record<string, unknown>).value;
    if (typeof v === "number") value = v;
  }
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
  }

  const minSell = 0.9 * value;
  const maxSell = 1.1 * value;

  const { data, error } = await supabase
    .from("records")
    .select("record_id,total_value")
    .eq("prnk", 1)
    .gte("sell", minSell)
    .lte("sell", maxSell)
    .order("total_value", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // DISTINCT on (record_id, total_value)
  const seen = new Set<string>();
  const distinct = (data ?? []).filter(r => {
    const key = `${r.record_id}::${r.total_value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const results = distinct.map((r, i) => ({
    row_number: i + 1,
    record_id: r.record_id,
    total_value: r.total_value,
  }));

  return NextResponse.json({
    results,
    number_of_results: results.length,
  });
}
