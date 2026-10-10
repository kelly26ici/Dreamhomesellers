import { NextResponse } from "next/server";
import { connection } from "next/server";

export const instant = false;

export async function GET() {
  await connection();
  const simonUrl = process.env.SIMON_URL ?? "http://localhost:8931";

  return NextResponse.redirect(simonUrl, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
