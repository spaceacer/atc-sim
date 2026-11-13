export { performanceOf } from '../src/engine/index.js';
import { XDEM } from '../src/data/airports/xdem.js';
/** Half the practice runway's length, nm (thresholds at +/- this). */
export const XDEM_RUNWAY_HALF = Math.abs(XDEM.runways[0].thresholdX);
