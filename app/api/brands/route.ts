import { NextResponse } from 'next/server';
import { searchBrands } from '@/lib/depop/brands';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') || '';
  return NextResponse.json({ brands: searchBrands(q.slice(0, 60), 12) });
}
