import { Fyo, t } from 'fyo';
import { Invoice } from 'models/baseModels/Invoice/Invoice';
import { ModelNameEnum } from 'models/types';
import { Money } from 'pesa';
import {
  getCompanyState,
  getDateRangeFilter,
  getInvoiceGSTBreakup,
  GSTLineBreakup,
} from './gstBreakup';

export interface TaxHeads {
  taxableValue: Money;
  igst: Money;
  cgst: Money;
  sgst: Money;
}

export interface InterIntra {
  inter: Money;
  intra: Money;
}

export interface GSTR3BData {
  /** Table 3.1 */
  outward: {
    taxable: TaxHeads;
    zeroRated: TaxHeads;
    nilExempt: TaxHeads;
    reverseChargeInward: TaxHeads;
    nonGST: TaxHeads;
  };
  /** Table 3.2, by place of supply */
  interStateUnregistered: { place: string; taxableValue: Money; igst: Money }[];
  /** Table 4 */
  itc: { allOther: TaxHeads; net: TaxHeads };
  /** Table 5 */
  inward: { nilExempt: InterIntra; nonGST: InterIntra };
  /** Table 6.1, estimated */
  payment: { cash: TaxHeads; carryForward: TaxHeads };
}

function zeroHeads(fyo: Fyo): TaxHeads {
  return {
    taxableValue: fyo.pesa(0),
    igst: fyo.pesa(0),
    cgst: fyo.pesa(0),
    sgst: fyo.pesa(0),
  };
}

function addLine(heads: TaxHeads, line: GSTLineBreakup) {
  heads.taxableValue = heads.taxableValue.add(line.taxableValue);
  heads.igst = heads.igst.add(line.igst);
  heads.cgst = heads.cgst.add(line.cgst);
  heads.sgst = heads.sgst.add(line.sgst);
}

async function getSubmittedInvoices(
  fyo: Fyo,
  schemaName: ModelNameEnum.SalesInvoice | ModelNameEnum.PurchaseInvoice,
  fromDate: string,
  toDate: string
): Promise<Invoice[]> {
  const entries = (await fyo.db.getAllRaw(schemaName, {
    fields: ['name'],
    filters: {
      date: getDateRangeFilter(fromDate, toDate),
      submitted: true,
      cancelled: false,
    },
  })) as { name: string }[];

  const invoices: Invoice[] = [];
  for (const { name } of entries) {
    invoices.push((await fyo.doc.getDoc(schemaName, name)) as Invoice);
  }

  return invoices;
}

export async function getGSTR3BData(
  fyo: Fyo,
  fromDate: string,
  toDate: string
): Promise<GSTR3BData> {
  const companyState = await getCompanyState(fyo);
  const data: GSTR3BData = {
    outward: {
      taxable: zeroHeads(fyo),
      zeroRated: zeroHeads(fyo),
      nilExempt: zeroHeads(fyo),
      reverseChargeInward: zeroHeads(fyo),
      nonGST: zeroHeads(fyo),
    },
    interStateUnregistered: [],
    itc: { allOther: zeroHeads(fyo), net: zeroHeads(fyo) },
    inward: {
      nilExempt: { inter: fyo.pesa(0), intra: fyo.pesa(0) },
      nonGST: { inter: fyo.pesa(0), intra: fyo.pesa(0) },
    },
    payment: { cash: zeroHeads(fyo), carryForward: zeroHeads(fyo) },
  };

  const unregisteredByPlace: Record<string, TaxHeads> = {};
  const sales = await getSubmittedInvoices(
    fyo,
    ModelNameEnum.SalesInvoice,
    fromDate,
    toDate
  );
  for (const invoice of sales) {
    const breakup = await getInvoiceGSTBreakup(invoice, companyState);
    for (const line of breakup.lines) {
      if (line.category === 'Taxable') {
        addLine(data.outward.taxable, line);
      } else if (line.category === 'NonGST') {
        addLine(data.outward.nonGST, line);
      } else {
        addLine(data.outward.nilExempt, line);
      }

      if (
        line.category === 'Taxable' &&
        line.interState &&
        !breakup.partyGstin
      ) {
        const place = breakup.placeOfSupply || t`Unknown`;
        unregisteredByPlace[place] ??= zeroHeads(fyo);
        addLine(unregisteredByPlace[place], line);
      }
    }
  }

  data.interStateUnregistered = Object.keys(unregisteredByPlace)
    .sort()
    .map((place) => ({
      place,
      taxableValue: unregisteredByPlace[place].taxableValue,
      igst: unregisteredByPlace[place].igst,
    }));

  const purchases = await getSubmittedInvoices(
    fyo,
    ModelNameEnum.PurchaseInvoice,
    fromDate,
    toDate
  );
  for (const invoice of purchases) {
    const breakup = await getInvoiceGSTBreakup(invoice, companyState);
    for (const line of breakup.lines) {
      if (line.category === 'Taxable') {
        addLine(data.itc.allOther, line);
        continue;
      }

      const bucket =
        line.category === 'NonGST' ? data.inward.nonGST : data.inward.nilExempt;
      if (line.interState) {
        bucket.inter = bucket.inter.add(line.taxableValue);
      } else {
        bucket.intra = bucket.intra.add(line.taxableValue);
      }
    }
  }

  // No ITC reversals or ineligible ITC are recorded, so net ITC is all ITC.
  data.itc.net = { ...data.itc.allOther };
  data.payment = getEstimatedPayment(fyo, data.outward.taxable, data.itc.net);
  return data;
}

/**
 * Sets off ITC against output tax in the Rule 88A order and returns the
 * tax left to pay in cash and the credit carried forward. CGST credit is
 * never used for SGST, or SGST credit for CGST.
 */
export function getEstimatedPayment(
  fyo: Fyo,
  outputTax: TaxHeads,
  itc: TaxHeads
): GSTR3BData['payment'] {
  const nonNegative = (m: Money) => (m.isNegative() ? fyo.pesa(0) : m);
  const owed = {
    igst: nonNegative(outputTax.igst),
    cgst: nonNegative(outputTax.cgst),
    sgst: nonNegative(outputTax.sgst),
  };
  const credit = {
    igst: nonNegative(itc.igst),
    cgst: nonNegative(itc.cgst),
    sgst: nonNegative(itc.sgst),
  };

  const setOff = (from: keyof typeof credit, to: keyof typeof owed) => {
    const used = credit[from].lt(owed[to]) ? credit[from] : owed[to];
    credit[from] = credit[from].sub(used);
    owed[to] = owed[to].sub(used);
  };

  // IGST credit first: IGST, then the CGST and SGST that their own credit
  // cannot cover, so that credit is not spent where it is not needed.
  setOff('igst', 'igst');
  const cgstShortfall = owed.cgst.gt(credit.cgst)
    ? owed.cgst.sub(credit.cgst)
    : fyo.pesa(0);
  const sgstShortfall = owed.sgst.gt(credit.sgst)
    ? owed.sgst.sub(credit.sgst)
    : fyo.pesa(0);
  for (const [head, shortfall] of [
    ['cgst', cgstShortfall],
    ['sgst', sgstShortfall],
  ] as const) {
    const used = credit.igst.lt(shortfall) ? credit.igst : shortfall;
    credit.igst = credit.igst.sub(used);
    owed[head] = owed[head].sub(used);
  }

  setOff('cgst', 'cgst');
  setOff('cgst', 'igst');
  setOff('sgst', 'sgst');
  setOff('sgst', 'igst');

  return {
    cash: { taxableValue: fyo.pesa(0), ...owed },
    carryForward: { taxableValue: fyo.pesa(0), ...credit },
  };
}
