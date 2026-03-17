import { oneTouchHitProb } from "../domain/model";
import type { PageContext, PriceRow, RowProbability } from "../domain/types";
import type { DeribitClient } from "./deribit";

const FALLBACK_IV = 0.5;
const HOURS_PER_YEAR = 24 * 365;

interface ComputeParams {
  deribit: DeribitClient;
  page: PageContext;
  rows: PriceRow[];
}

export async function computeTheoreticalProbabilities(
  params: ComputeParams,
): Promise<RowProbability[]> {
  const spot = await params.deribit.getSpot(params.page.underlying);
  const referenceIV =
    (await params.deribit.getReferenceIV(params.page.underlying, params.page.expiryUtcMs, spot)) ??
    FALLBACK_IV;
  const timeToExpiryYears = Math.max(
    (params.page.expiryUtcMs - Date.now()) / (1000 * 60 * 60 * HOURS_PER_YEAR),
    0,
  );

  return params.rows.map((row) => ({
    row,
    value: oneTouchHitProb({
      barrier: row.barrier,
      direction: row.direction,
      q: 0,
      r: 0,
      sigma: referenceIV,
      spot,
      timeToExpiryYears,
    }),
  }));
}
