// app/api/v1/categories/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Ensure Node runtime
export const runtime = "nodejs";

// --- Env ---
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

// Supabase client (Service Role)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Auth helper
function requireApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  if (!key || !API_KEYS.has(key)) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  return null;
}

// GET /api/v1/records?q=&prnkOnly=1&product=&productLike=&limit=&cursor=
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const prnkOnly = searchParams.get("prnkOnly") === "1";

  const product = searchParams.get("product");
  const productLike = searchParams.get("productLike");

  const limitParam = parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(limitParam, 1), 100);
  const cursorParam = searchParams.get("cursor");
  const cursor = cursorParam ? Number(cursorParam) : undefined;

  let query = supabase
    .from("records")
    // ONLY these two columns:
    .select("record_id,total_value")
    // keep a stable order for keyset pagination:
    .order("record_id", { ascending: true })
    .limit(limit + 1);

  // q across product
  if (q) {
    const like = `%${q}%`;
    const enc = encodeURIComponent(like);
    query = query.or(`product.ilike.${enc}`);
  }

  if (prnkOnly) {
    query = query.eq("prnk", 1);
  }

  // Product filters (optional)
  if (productLike) {
    query = query.ilike("product", `%${productLike}%`);
  } else if (product) {
    const repeated = searchParams.getAll("product");
    const list =
      repeated.length > 1
        ? repeated
        : product.split(",").map(s => s.trim()).filter(Boolean);
    if (list.length === 1) query = query.eq("product", list[0]);
    else if (list.length > 1) query = query.in("product", list);
  }

  // Keyset pagination: fetch records with recordid > cursor
  if (cursor !== undefined && !Number.isNaN(cursor)) {
    query = query.gt("record_id", cursor);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const page = hasMore ? data!.slice(0, limit) : (data ?? []);
  const nextCursor = hasMore ? page[page.length - 1].record_id : null;

  return NextResponse.json({ records: page, nextCursor });
}
