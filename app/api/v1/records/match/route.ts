// app/api/v1/records/match/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const API_KEYS = new Set((process.env.API_KEYS ?? "demo-key").split(",").map(s=>s.trim()).filter(Boolean));

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

  const body = await req.json().catch(() => ({} as any));
  const value = Number(body?.value);
  const products: string[] = Array.isArray(body?.products) ? body.products.slice(0, 3) : [];

  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
  }

  const minSell = 0.9 * value;
  const maxSell = 1.1 * value;

  // Build a single SQL using PostgREST's RPC via Supabase SQL
  // We use a raw SQL with placeholders using the 'query' PostgREST endpoint through rpc
  // Easiest: create a Postgres function; but to keep it inline, we'll use supabase.sql (if available) fallback to two-step approach.

  // Approach: fetch base filtered rows, and if products provided, intersect via GROUP BY/HAVING
  // Using PostgREST filters we can’t write HAVING easily; so we’ll run one SQL call.
  const sql = `
    with base as (
      select record_id, total_value, product
      from records
      where prnk = 1
        and sell >= $1::numeric
        and sell <= $2::numeric
        ${products.length ? `and product = any($3::uuid[])` : ``}
    ),
    intersected as (
      ${products.length
        ? `
        select record_id, max(total_value) as total_value
        from base
        group by record_id
        having count(distinct product) = $4::int
      `
        : `
        select record_id, max(total_value) as total_value
        from base
        group by record_id
      `
      }
    )
    select record_id, total_value
    from intersected
    order by total_value desc;
  `;

  // Supabase JS v2 has .rpc() for functions; for raw SQL use the "query" helper on the admin API.
  // In environments without the SQL helper, we can simulate with two queries:
  try {
    // Prefer using supabase.postgrest `rpc` by creating a SQL function.
    // If you don't want to add a DB function, do it in two steps:

    // STEP 1: base filtered rows (only columns we need)
    let baseQ = supabase
      .from("records")
      .select("record_id,total_value,product")
      .eq("prnk", 1)
      .gte("sell", minSell)
      .lte("sell", maxSell);

    if (products.length) baseQ = baseQ.in("product", products);

    const { data: baseRows, error: baseErr } = await baseQ;
    if (baseErr) return NextResponse.json({ error: baseErr.message }, { status: 500 });

    if (!baseRows?.length) return NextResponse.json({ results: [] });

    // If products specified, keep only record_ids that have ALL products
    let kept: { record_id: string; total_value: number }[] = [];

    if (products.length) {
      // Group by record_id
      const map = new Map<
        string,
        { set: Set<string>; maxTotal: number }
      >();

      for (const r of baseRows) {
        const key = r.record_id;
        const entry = map.get(key) ?? { set: new Set<string>(), maxTotal: 0 };
        if (r.product) entry.set.add(r.product as unknown as string);
        const tv = Number(r.total_value) || 0;
        if (tv > entry.maxTotal) entry.maxTotal = tv;
        map.set(key, entry);
      }

      for (const [record_id, { set, maxTotal }] of map) {
        // Must contain all requested product IDs
        let ok = true;
        for (const p of products) if (!set.has(p)) { ok = false; break; }
        if (ok) kept.push({ record_id, total_value: maxTotal });
      }
    } else {
      // No products: just take max(total_value) per record_id
      const map = new Map<string, number>();
      for (const r of baseRows) {
        const tv = Number(r.total_value) || 0;
        const prev = map.get(r.record_id);
        if (prev == null || tv > prev) map.set(r.record_id, tv);
      }
      kept = [...map.entries()].map(([record_id, total_value]) => ({ record_id, total_value }));
    }

    // Sort & add row_number
    kept.sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0));
    const results = kept.map((row, i) => ({
      row_number: i + 1,
      record_id: row.record_id,
      total_value: row.total_value,
    }));

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
