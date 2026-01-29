// 🥟 Mandu Filling - blacklist-api
// Pattern: /api/blacklist

import { Mandu } from "@mandujs/core";

interface BlacklistRecord {
  id: number;
  name: string;
  phone: string;
  carModel: string;
  plateNumber: string;
  rentalDate: string;
  amountOwed: number;
  status: "stolen" | "unpaid";
  notes: string;
  createdAt: string;
}

const records: BlacklistRecord[] = [
  {
    id: 1,
    name: "김철수",
    phone: "010-1234-5678",
    carModel: "현대 아반떼",
    plateNumber: "12가 3456",
    rentalDate: "2025-12-01",
    amountOwed: 1500000,
    status: "unpaid",
    notes: "3개월 연체, 연락 두절",
    createdAt: "2026-01-10T09:00:00Z",
  },
  {
    id: 2,
    name: "박영희",
    phone: "010-9876-5432",
    carModel: "기아 K5",
    plateNumber: "34나 7890",
    rentalDate: "2025-11-15",
    amountOwed: 0,
    status: "stolen",
    notes: "차량 반납 없이 잠적",
    createdAt: "2026-01-15T14:30:00Z",
  },
];

let nextId = 3;

export default Mandu.filling()
  .get((ctx) => {
    const url = new URL(ctx.request.url);
    const statusFilter = url.searchParams.get("status") || "all";
    const search = (url.searchParams.get("search") || "").toLowerCase();

    let filtered = records;

    if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }

    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          r.phone.includes(search) ||
          r.plateNumber.includes(search)
      );
    }

    return ctx.ok({ records: filtered, total: filtered.length });
  })
  .post(async (ctx) => {
    const body = await ctx.body();

    const record: BlacklistRecord = {
      id: nextId++,
      name: body.name,
      phone: body.phone,
      carModel: body.carModel,
      plateNumber: body.plateNumber,
      rentalDate: body.rentalDate,
      amountOwed: body.amountOwed ?? 0,
      status: body.status,
      notes: body.notes ?? "",
      createdAt: new Date().toISOString(),
    };

    records.push(record);
    return ctx.created({ record });
  })
  .delete((ctx) => {
    const url = new URL(ctx.request.url);
    const id = Number(url.searchParams.get("id"));

    const index = records.findIndex((r) => r.id === id);
    if (index === -1) {
      return ctx.notFound({ error: "Record not found" });
    }

    records.splice(index, 1);
    return ctx.ok({ records, total: records.length });
  });
