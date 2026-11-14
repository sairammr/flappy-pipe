// bun lib/board.check.ts — resolve() must agree with the contract's gate rule.
import { resolve, uAtTime } from "./board";
const p = { band_lo: 10, band_hi: 11, window_end_ms: 10000 }; // gap [10, 12), gate at 10_000
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
eq(resolve([{ t: 4000, u: 11 }, { t: 9000, u: 10 }], p), null); // no sample past the gate yet
eq(resolve([{ t: 8000, u: 10 }, { t: 12000, u: 14 }], p), { status: "Lost", at: 10000 }); // 12 at the gate: hi exclusive
eq(resolve([{ t: 8000, u: 9 }, { t: 12000, u: 13 }], p), { status: "Won", at: 10000 }); // 11 at the gate
eq(resolve([{ t: 8000, u: 30 }, { t: 10000, u: 10 }, { t: 11000, u: 30 }], p), { status: "Won", at: 10000 }); // sample on the gate, lo inclusive
eq(resolve([{ t: 6000, u: 50 }, { t: 9000, u: 11 }, { t: 11000, u: 11 }], p), { status: "Won", at: 10000 }); // only the gate counts
eq(resolve([{ t: 1000, u: 11 }, { t: 11001, u: 11 }], p), { status: "Refunded", at: 10000 }); // samples > 10 s apart
eq(resolve([{ t: 10500, u: 11 }], p), null); // history doesn't reach back
eq(uAtTime([{ t: 0, u: 0 }, { t: 10, u: 10 }], 5), 5);
eq(uAtTime([{ t: 0, u: 0 }, { t: 10, u: 10 }], 50), 10);
console.log("board.check OK");
