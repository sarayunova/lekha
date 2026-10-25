import { Fyo } from 'fyo';
import { DateTime } from 'luxon';
import { Invoice, TaxDetail } from 'models/baseModels/Invoice/Invoice';
import { InvoiceItem } from 'models/baseModels/InvoiceItem/InvoiceItem';
import { Party } from 'models/regionalModels/in/Party';
import { ModelNameEnum } from 'models/types';
import { Money } from 'pesa';
import { codeStateMap } from 'regional/in';
import { GSTRRow } from './types';

/**
 * GST classification of invoice lines, shared by the GSTR reports.
 *
 * Tax amounts come from Invoice.getTaxItems so reports match what the
 * invoice posts. Accounts are identified by the names used in the India
 * chart of accounts and tax templates (src/regional/in).
 */

export type GSTSupplyCategory = 'Taxable' | 'NilRated' | 'Exempt' | 'NonGST';

export interface GSTLineBreakup {
  item: InvoiceItem;
  category: GSTSupplyCategory;
  /** Total GST rate of the item's tax template, e.g. 18 for GST-18. */
  rate: number;
  interState: boolean;
  /** Values below are in the company currency; negative for returns. */
  taxableValue: Money;
  igst: Money;
  cgst: Money;
  sgst: Money;
}

export interface InvoiceGSTBreakup {
  placeOfSupply: string;
  partyGstin: string;
  interState: boolean;
  lines: GSTLineBreakup[];
}

export const GSTAccounts = {
  IGST: 'IGST',
  CGST: 'CGST',
  SGST: 'SGST',
  Exempt: 'Exempt',
} as const;

/**
 * Filter for a Datetime field covering whole local days. Invoice dates are
 * stored as UTC timestamps, so a plain '<=' toDate comparison drops the last
 * day and India's +05:30 offset moves early-morning entries a day back.
 */
export function getDateRangeFilter(
  fromDate: string | undefined,
  toDate: string | undefined
): string[] {
  const filter: string[] = [];
  if (fromDate) {
    filter.push(
      '>=',
      DateTime.fromISO(fromDate).startOf('day').toUTC().toISO()!
    );
  }

  if (toDate) {
    filter.push(
      '<',
      DateTime.fromISO(toDate).plus({ days: 1 }).startOf('day').toUTC().toISO()!
    );
  }

  return filter;
}

export function getStateFromGstin(gstin: string | null | undefined): string {
  if (!gstin) {
    return '';
  }

  return codeStateMap[gstin.slice(0, 2)] ?? '';
}

export async function getCompanyState(fyo: Fyo): Promise<string> {
  const gstin = (await fyo.getValue(
    ModelNameEnum.AccountingSettings,
    'gstin'
  )) as string | null;

  return getStateFromGstin(gstin);
}

/**
 * Place of supply is the party's address' place of supply, else the state
 * in the party's GSTIN.
 */
export async function getPartyPlaceAndGstin(
  fyo: Fyo,
  partyName: string
): Promise<{ place: string; gstin: string }> {
  const party = (await fyo.doc.getDoc(ModelNameEnum.Party, partyName)) as Party;
  const gstin = party.gstin ?? '';

  if (party.address) {
    const pos = (await fyo.getValue(
      ModelNameEnum.Address,
      party.address as string,
      'pos'
    )) as string | undefined;

    if (pos) {
      return { place: pos, gstin };
    }
  }

  return { place: getStateFromGstin(gstin), gstin };
}

export async function getInvoiceGSTBreakup(
  invoice: Invoice,
  companyState: string
): Promise<InvoiceGSTBreakup> {
  const fyo = invoice.fyo;
  const { place, gstin } = await getPartyPlaceAndGstin(fyo, invoice.party!);
  const placeInterState = !!place && !!companyState && place !== companyState;
  const exchangeRate = invoice.exchangeRate ?? 1;

  const taxItems = await invoice.getTaxItems();
  const lines: GSTLineBreakup[] = [];
  for (const item of invoice.items ?? []) {
    const details = item.tax
      ? ((await invoice.getTax(item.tax)).details as TaxDetail[] | undefined) ??
        []
      : [];
    const accounts = details.map((d) => d.account);
    const rate = details.reduce((sum, d) => sum + (d.rate ?? 0), 0);

    let category: GSTSupplyCategory = 'Taxable';
    if (!item.tax) {
      category = 'NonGST';
    } else if (accounts.includes(GSTAccounts.Exempt)) {
      category = 'Exempt';
    } else if (rate === 0) {
      category = 'NilRated';
    }

    const line: GSTLineBreakup = {
      item,
      category,
      rate,
      interState: placeInterState,
      taxableValue: invoice.getItemTaxableAmount(item).mul(exchangeRate),
      igst: fyo.pesa(0),
      cgst: fyo.pesa(0),
      sgst: fyo.pesa(0),
    };

    for (const taxItem of taxItems) {
      if (taxItem.item !== item) {
        continue;
      }

      const amount = taxItem.taxAmount.mul(exchangeRate);
      switch (taxItem.details.account) {
        case GSTAccounts.IGST:
          line.igst = line.igst.add(amount);
          break;
        case GSTAccounts.CGST:
          line.cgst = line.cgst.add(amount);
          break;
        case GSTAccounts.SGST:
          line.sgst = line.sgst.add(amount);
          break;
      }
    }

    // The template, not the address, decides IGST vs CGST + SGST.
    if (accounts.includes(GSTAccounts.IGST)) {
      line.interState = true;
    } else if (
      accounts.includes(GSTAccounts.CGST) ||
      accounts.includes(GSTAccounts.SGST)
    ) {
      line.interState = false;
    }

    lines.push(line);
  }

  return {
    placeOfSupply: place,
    partyGstin: gstin,
    interState: lines.some((l) => l.interState) || placeInterState,
    lines,
  };
}

/**
 * One GSTR-1/GSTR-2 row per invoice.
 */
export async function getGSTRRow(
  invoice: Invoice,
  companyState: string
): Promise<GSTRRow> {
  const fyo = invoice.fyo;
  const breakup = await getInvoiceGSTBreakup(invoice, companyState);

  const total = (key: 'taxableValue' | 'igst' | 'cgst' | 'sgst') =>
    breakup.lines.reduce((sum, line) => sum.add(line[key]), fyo.pesa(0)).float;
  const categories = new Set(breakup.lines.map((l) => l.category));
  // An invoice can mix rates; show the highest taxable rate.
  const taxableRates = breakup.lines
    .filter((l) => l.category === 'Taxable')
    .map((l) => l.rate);

  return {
    gstin: breakup.partyGstin,
    partyName: invoice.party!,
    invNo: invoice.name!,
    invDate: invoice.date!,
    rate: taxableRates.length ? Math.max(...taxableRates) : 0,
    // Reverse charge is not supported yet.
    reverseCharge: 'N',
    inState: !breakup.interState,
    place: breakup.placeOfSupply,
    invAmt: (invoice.baseGrandTotal ?? invoice.grandTotal)?.float ?? 0,
    taxVal: total('taxableValue'),
    igstAmt: total('igst'),
    cgstAmt: total('cgst'),
    sgstAmt: total('sgst'),
    nilRated: categories.has('NilRated'),
    exempt: categories.has('Exempt'),
    nonGST: categories.has('NonGST'),
  };
}
