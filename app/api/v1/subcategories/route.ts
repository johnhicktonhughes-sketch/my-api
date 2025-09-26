// app/api/v1/items/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ensure Node runtime (not Edge)
export const runtime = "nodejs";

// env (server-only)
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_KEYS = new Set(
  (process.env.API_KEYS ?? "demo-key")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// sanity check on startup (won't print secrets)
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

// supabase server client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// simple API key auth
function requireApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  if (!key || !API_KEYS.has(key)) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }
  return null;
}

// GET /api/v1/items?q=&limit=&cursor=
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limitParam = parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(limitParam, 1), 100);
  const cursor = searchParams.get("cursor"); // ISO timestamp

  let query = supabase
    .from("subcategories")
    .select("*")
    .order("category", { ascending: true })
    .order("subcategory", { ascending: true })
    .limit(limit + 1); // +1 to detect hasMore

  if (q) query = query.ilike("name", `%${q}%`);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const page = hasMore ? data!.slice(0, limit) : data!;
  const nextCursor = hasMore ? page[page.length - 1].created_at : null;

  return NextResponse.json({ items: page, nextCursor });
}

// POST /api/v1/items  { name: string }
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name || name.length > 64) {
    return NextResponse.json(
      { error: "name is required and must be <= 64 characters" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("items")
    .insert({ name })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
