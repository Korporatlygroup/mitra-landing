import en from '../../messages/en.json';
import ta from '../../messages/ta.json';
import ms from '../../messages/ms.json';
import enPartner from '../../messages/p5/partner.en.json';
import taPartner from '../../messages/p5/partner.ta.json';
import msPartner from '../../messages/p5/partner.ms.json';
import enBuyer from '../../messages/p5/buyer.en.json';
import taBuyer from '../../messages/p5/buyer.ta.json';
import msBuyer from '../../messages/p5/buyer.ms.json';
import enAdmin from '../../messages/p5/admin.en.json';
import taAdmin from '../../messages/p5/admin.ta.json';
import msAdmin from '../../messages/p5/admin.ms.json';
import enCommon from '../../messages/p5/common.en.json';
import taCommon from '../../messages/p5/common.ta.json';
import msCommon from '../../messages/p5/common.ms.json';

// Phase 5 strings live in messages/p5/<area>.<locale>.json (top-level namespaces p5partner, p5buyer, p5admin, p5common) so that
// several people can work on them at once. They are merged here, once, for the app, the unit tests and (by file read) the browser tests.
type Tree = Record<string, unknown>;
const merge = (...parts: Tree[]): Tree => Object.assign({}, ...parts);

export const MESSAGES = {
  en: merge(en, enPartner, enBuyer, enAdmin, enCommon),
  ta: merge(ta, taPartner, taBuyer, taAdmin, taCommon),
  ms: merge(ms, msPartner, msBuyer, msAdmin, msCommon),
} as const;

export type Locale = keyof typeof MESSAGES;
export const messagesFor = (locale: Locale): Tree => MESSAGES[locale];
