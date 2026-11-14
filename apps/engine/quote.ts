// View shape of board() (docs/IMPLEMENTATION.md). Quotes come from the contract`s quote() view.

export type Board = {
  now_ms: number;
  spot: string | null;
  sigma_ppm: number;
  tick: string;
  band0: number;
  window0: number;
  samples: { ts_ms: number; price: string }[];
};
