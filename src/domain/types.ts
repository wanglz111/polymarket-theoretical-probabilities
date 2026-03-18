export type Underlying = "BTC" | "ETH" | "SOL";
export type PricingStyle = "binary" | "touch";

export interface PageContext {
  defaultDirection?: "up" | "down";
  expiryUtcMs: number;
  underlying: Underlying;
  pricingStyle: PricingStyle;
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
