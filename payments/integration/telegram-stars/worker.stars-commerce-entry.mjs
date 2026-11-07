// RUST UP: Existing Telegram bot with the ALREADY TESTED Telegram Stars fixed-goods
// invoice, signed precheckout, verified receipt, fulfillment and refund wrapper.
// This is a source entry only: it does not activate or deploy paid transactions.
// All existing game, admin, webhook and scheduled handlers are delegated to base.
import base from './worker.js';
import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';

export default wrapExistingWorker(base);
