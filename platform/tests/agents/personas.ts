import type { PersonaKey } from './store';

// Persona definitions. All identities, businesses and contacts are fictional; emails use the reserved example.test domain.
export interface PersonaDef {
  key: PersonaKey;
  label: string;
  displayName: string;
  email: string;
  orgType: 'buyer' | 'business' | 'partner' | null;
  orgName: string | null;
  role: string;
  mfa: boolean;
  goal: string;
}

export const PERSONAS: PersonaDef[] = [
  { key: 'buyerA', label: 'Buyer A', displayName: 'Agent Buyer A', email: 'agent-buyer-a@example.test', orgType: 'buyer', orgName: 'AGENT Buyer A Trading (test)', role: 'owner of a buyer organisation', mfa: false, goal: 'Find a uniform maker, post a request, negotiate and accept a quotation, ask for Indian-sourced products, follow government programmes.' },
  { key: 'buyerB', label: 'Buyer B', displayName: 'Agent Buyer B', email: 'agent-buyer-b@example.test', orgType: 'buyer', orgName: 'AGENT Buyer B Retail (test)', role: 'owner of a second, unrelated buyer organisation', mfa: false, goal: 'Behave as a competitor/outsider: must never see Buyer A\'s private transactions.' },
  { key: 'seller', label: 'Seller', displayName: 'Agent Seller', email: 'agent-seller@example.test', orgType: 'business', orgName: 'AGENT Seller Kedai Uniform (test)', role: 'owner of a business organisation', mfa: false, goal: 'Register and verify a business, publish a listing, answer enquiries and quotations, track leads, use government help.' },
  { key: 'supplier', label: 'Supplier (partner)', displayName: 'Agent Supplier', email: 'agent-supplier@example.test', orgType: 'partner', orgName: 'AGENT Supplier Chennai Textiles (test)', role: 'owner of a catalogue partner organisation', mfa: false, goal: 'Register suppliers and products, get them reviewed, answer product price requests and sourcing requests.' },
  { key: 'admin', label: 'Administrator', displayName: 'Agent Admin', email: 'agent-admin@example.test', orgType: null, orgName: null, role: 'admin_super in the operator organisation (MFA required)', mfa: true, goal: 'Review verification, listings, products, programmes and reports; approve second-person changes.' },
  { key: 'admin2', label: 'Second administrator', displayName: 'Agent Admin Two', email: 'agent-admin2@example.test', orgType: null, orgName: null, role: 'admin_review, invited through the app by the first administrator', mfa: true, goal: 'Second person for four-eyes approvals.' },
];
export const def = (k: PersonaKey): PersonaDef => PERSONAS.find((p) => p.key === k)!;
