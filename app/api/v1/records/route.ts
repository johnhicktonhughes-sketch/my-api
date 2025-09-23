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

/**
 * GET /api/v1/categories?q=&limit=&cursor=
 * - q: optional search by name (case-insensitive)
 * - limit: 1..100 (default 20)
 * - cursor: ISO timestamp for keyset pagination by created_at (older than cursor)
 */
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limitParam = parseInt(searchParams.get("limit") || "20", 100);
  const limit = Math.min(Math.max(limitParam, 1), 1000);
  const cursor = searchParams.get("cursor"); // ISO timestamp

  let query = supabase
    .from("records")
    .select("*")
    .eq("prnk", 1) 
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (q) query = query.ilike("name", `%${q}%`);
  if (cursor) query = query.lt("id", cursor);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const page = hasMore ? data!.slice(0, limit) : data!;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return NextResponse.json({ records: page, nextCursor });
}

/**
 * POST /api/v1/categories
 * body: { name: string, description?: string }
 */
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description : null;

  if (!name || name.length > 64) {
    return NextResponse.json(
      { error: "name is required and must be <= 64 characters" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("records")
    .insert({ name, description })
    .select("*")
    .single();

  if (error) {
    // Handle unique name violation nicely
    if (String(error.message).toLowerCase().includes("duplicate")) {
      return NextResponse.json({ error: "Category name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
