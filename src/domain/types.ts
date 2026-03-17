export interface PageContext {
  expiryUtcMs: number;
  underlying: "BTC" | "ETH";
  slug: string;
  title: string;
}

export interface PriceRow {
  barrier: number;
  direction: "up" | "down";
  marketProbability?: number;
  priceNode: HTMLElement;
  probabilityNode: HTMLElement;
  rowNode: HTMLElement;
}

export interface RowProbability {
  row: PriceRow;
  value: number;
}
