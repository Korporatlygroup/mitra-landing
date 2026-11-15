import { getTranslations } from 'next-intl/server';
import { proposeManualAction } from './actions';
import ActionForm from '@/components/ActionForm';

export interface FormSource { id: string; name: string; allowed_hosts: string[] }
export interface FormRule { field?: string; op?: string; value?: unknown; quote?: string }
export interface FormInitial {
  name?: string; category?: string; beneficiary_type?: string; description?: string; funding_type?: string; amount_min?: string; amount_max?: string;
  application_channel?: string; application_url?: string; info_url?: string; application_status?: string; opens_on?: string; closes_on?: string;
  documents?: string[]; sectors?: string[]; states?: string[]; rules?: FormRule[];
}

const CATEGORIES = ['grants_funding', 'business_financing', 'training', 'advisory', 'entrepreneurship', 'digital', 'other'] as const;
const FUNDING = ['grant', 'financing', 'subsidy', 'training', 'other'] as const;
const CHANNELS = ['unknown', 'online', 'branch', 'form', 'enquiry'] as const;
const STATUSES = ['unknown', 'open', 'upcoming', 'closed'] as const;
const BENEFICIARIES = ['entrepreneur', 'organisation', 'both'] as const;
const RULE_FIELDS = ['note', 'business_size', 'sector', 'state', 'registration', 'employees_min', 'employees_max', 'years_operating_min', 'citizenship', 'community', 'age_min', 'age_max'] as const;
const RULE_OPS = ['eq', 'in', 'gte', 'lte', 'note'] as const;
const MAX_ROWS = 40;

const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v));

/**
 * Editor for one programme (new, or a change to a published one). It only ever proposes: the change goes to the review queue and a
 * different administrator approves it. Blank fields are saved as "not confirmed", never filled in.
 */
export default async function ProgrammeForm({
  locale, sources, fixedSourceId, programmeId, initial = {}, defaultSourceId,
}: { locale: string; sources: FormSource[]; fixedSourceId?: string; programmeId?: string; initial?: FormInitial; defaultSourceId?: string }) {
  const t = await getTranslations({ locale, namespace: 'gov.admin.manual' });
  const rules = initial.rules ?? [];
  const rows = Math.min(MAX_ROWS, Math.max(3, rules.length + 2));
  const chosen = fixedSourceId ?? defaultSourceId ?? sources[0]?.id;

  return (
    <ActionForm action={proposeManualAction} submitLabel={t('submit')} className="form form-wide">
      <input type="hidden" name="locale" value={locale} />
      {programmeId ? <input type="hidden" name="programmeId" value={programmeId} /> : null}
      {fixedSourceId ? (
        <input type="hidden" name="sourceId" value={fixedSourceId} />
      ) : (
        <div className="field">
          <label htmlFor="mp-source">{t('source')}</label>
          <select id="mp-source" name="sourceId" defaultValue={chosen} required>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="hint">{t('sourceHint', { hosts: sources.find((s) => s.id === chosen)?.allowed_hosts.join(', ') ?? '' })}</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="mp-name">{t('name')}</label>
        <input id="mp-name" name="name" type="text" required minLength={3} maxLength={200} defaultValue={initial.name ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="mp-category">{t('category')}</label>
        <select id="mp-category" name="category" defaultValue={initial.category ?? 'other'} required>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`cat.${c}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="mp-ben">{t('beneficiary')}</label>
        <select id="mp-ben" name="beneficiary_type" defaultValue={initial.beneficiary_type ?? ''} aria-describedby="mp-ben-h">
          <option value="">{t('ben.unknown')}</option>
          {BENEFICIARIES.map((b) => (
            <option key={b} value={b}>
              {t(`ben.${b}`)}
            </option>
          ))}
        </select>
        <p className="hint" id="mp-ben-h">
          {t('benHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-desc">{t('description')}</label>
        <textarea id="mp-desc" name="description" rows={5} maxLength={4000} defaultValue={initial.description ?? ''} aria-describedby="mp-desc-h" />
        <p className="hint" id="mp-desc-h">
          {t('descriptionHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-ft">{t('fundingType')}</label>
        <select id="mp-ft" name="funding_type" defaultValue={initial.funding_type ?? ''}>
          <option value="">{t('ft.unknown')}</option>
          {FUNDING.map((f) => (
            <option key={f} value={f}>
              {t(`ft.${f}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="mp-amin">{t('amountMin')}</label>
        <input id="mp-amin" name="amount_min" type="text" inputMode="decimal" maxLength={15} defaultValue={initial.amount_min ?? ''} aria-describedby="mp-amt-h" />
      </div>
      <div className="field">
        <label htmlFor="mp-amax">{t('amountMax')}</label>
        <input id="mp-amax" name="amount_max" type="text" inputMode="decimal" maxLength={15} defaultValue={initial.amount_max ?? ''} aria-describedby="mp-amt-h" />
        <p className="hint" id="mp-amt-h">
          {t('amountHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-ch">{t('channel')}</label>
        <select id="mp-ch" name="application_channel" defaultValue={initial.application_channel ?? 'unknown'}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`ch.${c}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="mp-aurl">{t('applicationUrl')}</label>
        <input id="mp-aurl" name="application_url" type="url" maxLength={500} placeholder="https://" defaultValue={initial.application_url ?? ''} />
      </div>
      <div className="field">
        <label htmlFor="mp-iurl">{t('infoUrl')}</label>
        <input id="mp-iurl" name="info_url" type="url" required maxLength={500} placeholder="https://" defaultValue={initial.info_url ?? ''} aria-describedby="mp-iurl-h" />
        <p className="hint" id="mp-iurl-h">
          {t('infoHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-status">{t('appStatus')}</label>
        <select id="mp-status" name="application_status" defaultValue={initial.application_status ?? 'unknown'} aria-describedby="mp-status-h">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`st.${s}`)}
            </option>
          ))}
        </select>
        <p className="hint" id="mp-status-h">
          {t('statusHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-opens">{t('opens')}</label>
        <input id="mp-opens" name="opens_on" type="date" defaultValue={initial.opens_on ?? ''} aria-describedby="mp-date-h" />
      </div>
      <div className="field">
        <label htmlFor="mp-closes">{t('closes')}</label>
        <input id="mp-closes" name="closes_on" type="date" defaultValue={initial.closes_on ?? ''} aria-describedby="mp-date-h" />
        <p className="hint" id="mp-date-h">
          {t('dateHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-docs">{t('documents')}</label>
        <textarea id="mp-docs" name="documents" rows={4} maxLength={8000} defaultValue={(initial.documents ?? []).join('\n')} aria-describedby="mp-docs-h" />
        <p className="hint" id="mp-docs-h">
          {t('documentsHint')}
        </p>
      </div>

      <div className="field">
        <label htmlFor="mp-sectors">{t('sectors')}</label>
        <input id="mp-sectors" name="sectors" type="text" maxLength={2000} defaultValue={text(initial.sectors)} aria-describedby="mp-list-h" />
      </div>
      <div className="field">
        <label htmlFor="mp-states">{t('states')}</label>
        <input id="mp-states" name="states" type="text" maxLength={2000} defaultValue={text(initial.states)} aria-describedby="mp-list-h" />
        <p className="hint" id="mp-list-h">
          {t('listHint')}
        </p>
      </div>

      <fieldset>
        <legend>{t('rulesTitle')}</legend>
        <p className="hint">{t('rulesHint')}</p>
        {Array.from({ length: rows }, (_, i) => {
          const r = rules[i] ?? {};
          return (
            <fieldset key={i} data-rule-row={i}>
              <legend>{t('rule', { n: i + 1 })}</legend>
              <div className="field">
                <label htmlFor={`mp-r${i}-f`}>{t('ruleField')}</label>
                <select id={`mp-r${i}-f`} name={`rule_${i}_field`} defaultValue={r.field ?? 'note'}>
                  {RULE_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`rf.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`mp-r${i}-o`}>{t('ruleOp')}</label>
                <select id={`mp-r${i}-o`} name={`rule_${i}_op`} defaultValue={r.op ?? 'note'}>
                  {RULE_OPS.map((o) => (
                    <option key={o} value={o}>
                      {t(`op.${o}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`mp-r${i}-v`}>{t('ruleValue')}</label>
                <input id={`mp-r${i}-v`} name={`rule_${i}_value`} type="text" maxLength={300} defaultValue={r.op === 'note' ? '' : text(r.value)} />
              </div>
              <div className="field">
                <label htmlFor={`mp-r${i}-q`}>{t('ruleQuote')}</label>
                <input id={`mp-r${i}-q`} name={`rule_${i}_quote`} type="text" maxLength={600} defaultValue={r.quote ?? ''} />
              </div>
            </fieldset>
          );
        })}
      </fieldset>

      <div className="field">
        <label htmlFor="mp-reason">{t('reason')}</label>
        <input id="mp-reason" name="reason" type="text" required minLength={5} maxLength={1000} />
      </div>
    </ActionForm>
  );
}
