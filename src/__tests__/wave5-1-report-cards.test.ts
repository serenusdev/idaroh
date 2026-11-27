import { describe, expect, it } from "vitest";
import { chunk } from "@/lib/inngest/report-batch";
import { matchStudent, parseCsv } from "@/modules/report-cards/parser";

describe("Wave 5.1 report-card contracts", () => {
  it("keeps batch steps at ten students or fewer", () => {
    expect(chunk(Array.from({ length: 21 }, (_, index) => index))).toEqual([
      Array.from({ length: 10 }, (_, index) => index),
      Array.from({ length: 10 }, (_, index) => index + 10),
      [20],
    ]);
  });

  it("parses CSV rows and matches by exact NIS before name", () => {
    const [row] = parseCsv('nis,full_name,tahfidz_data\nNIS-001,Ahmad Ali,"{""achieved_juz"":2}"');
    expect(matchStudent(row, [{ id: "student-1", nis: "NIS-001", full_name: "Nama Berbeda" }])).toMatchObject({ confidence: 1, student: { id: "student-1" } });
    expect(row.tahfidzData).toEqual({ achieved_juz: 2 });
  });

  it("does not claim a fuzzy match when NIS and normalized name miss", () => {
    const [row] = parseCsv("nama\nNama Tidak Ada");
    expect(matchStudent(row, [{ id: "student-1", nis: "NIS-001", full_name: "Ahmad Ali" }])).toEqual({ student: null, confidence: 0 });
  });
});
