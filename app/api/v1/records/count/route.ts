// app/api/v1/records/count/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_KEYS = new Set((process.env.API_KEYS ?? "demo-key").split(",").map(s => s.trim()).filter(Boolean));
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

// GET /api/v1/categories/count?q=&prnkOnly=1
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const prnkOnly = searchParams.get("prnkOnly") === "1"; // optional toggle

  let query = supabase
    .from("records")
    .select("*", { count: "exact", head: true }); // head=true avoids row data

  if (q) query = query.ilike("name", `%${q}%`);
  if (prnkOnly) query = query.eq("prnk", 1);

  const { count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ count: count ?? 0 });
}
