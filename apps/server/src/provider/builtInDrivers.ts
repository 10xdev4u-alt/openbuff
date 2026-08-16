/**
 * BUILT_IN_DRIVERS — the static set of `ProviderDriver`s this build ships
 * with.
 *
 * OpenBuff ships a single engine: the Freebuff driver (see issue #3, landing
 * in `Drivers/FreebuffDriver.ts`). Until it lands this array is empty; the
 * `ProviderInstanceRegistry` surfaces any configured instance as an
 * `"unavailable"` shadow snapshot at runtime (see
 * `buildUnavailableProviderSnapshot`).
 *
 * Adding a new first-party driver means:
 *   1. implement `ProviderDriver` in a sibling `Drivers/<Name>Driver.ts`,
 *   2. add it to this array,
 *   3. ensure the runtime layer satisfies its declared `R`.
 *
 * The aggregated `BuiltInDriversEnv` type is the union of every driver's
 * env requirement — the registry layer's `R` is this type.
 *
 * @module provider/builtInDrivers
 */
import type { AnyProviderDriver } from "./ProviderDriver.ts";
import { FreebuffDriver, type FreebuffDriverEnv } from "./Drivers/FreebuffDriver.ts";

/**
 * Union of infrastructure services required to construct any built-in
 * driver. The registry layer declares `R = BuiltInDriversEnv`; the runtime
 * layer must provide every service in this union.
 */
export type BuiltInDriversEnv = FreebuffDriverEnv;

/**
 * Ordered list of built-in drivers. Order matters only for tie-breaking in
 * UI presentation — the registry itself is keyed by `driverKind`, so
 * iteration order has no functional effect on instance lookup.
 */
export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  FreebuffDriver,
];
