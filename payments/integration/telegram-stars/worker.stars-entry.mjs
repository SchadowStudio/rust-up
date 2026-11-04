// Additional route wrapper around the EXISTING live RUST UP Worker source.
import original from './worker.js';
import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';
export default wrapExistingWorker(original);
