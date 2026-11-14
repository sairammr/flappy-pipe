// bun lib/board.check.ts — resolve() must agree with the contract's outcome rule.
import { resolve, uAtTime } from "./board";
const p = { band_lo: 10, band_hi: 11, window_start_ms: 5000, window_end_ms: 10000 }; // gap [10, 12)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
eq(resolve([{ t: 4000, u: 11 }, { t: 7000, u: 11 }, { t: 9000, u: 10 }], p), null); // no sample past end yet
eq(resolve([{ t: 4000, u: 11 }, { t: 7000, u: 11 }, { t: 10000, u: 10 }], p), { status: "Won", at: 10000 }); // edges inclusive
eq(resolve([{ t: 4000, u: 11 }, { t: 7000, u: 13 }], p), { status: "Lost", at: 5500 }); // crosses 12 at t=5500
eq(resolve([{ t: 4000, u: 15 }, { t: 6000, u: 15 }], p), { status: "Lost", at: 5000 }); // already outside: hits the wall
eq(resolve([{ t: 4000, u: 15 }, { t: 6000, u: 11 }, { t: 11000, u: 30 }], p), { status: "Won", at: 10000 }); // outside before/after ignored
eq(resolve([{ t: 7000, u: 15 }, { t: 11000, u: 30 }], p), null); // history doesn't cover the window
eq(resolve([{ t: 4000, u: 11 }, { t: 11000, u: 11 }], p), { status: "Refunded", at: 10000 });
eq(resolve([{ t: 4000, u: 11 }, { t: 6000, u: 12 }], p)!.status, "Lost"); // hi is exclusive
eq(uAtTime([{ t: 0, u: 0 }, { t: 10, u: 10 }], 5), 5);
eq(uAtTime([{ t: 0, u: 0 }, { t: 10, u: 10 }], 50), 10);
console.log("board.check OK");
