import { DateTime } from 'luxon';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import test from 'tape';
import { closeTestFyo, getTestFyo, setupTestFyo } from 'tests/helpers';
import { getCompanyState, getGSTRRow } from '../gstBreakup';
import { getGSTR3BData } from '../gstr3bData';

const fyo = getTestFyo();
setupTestFyo(fyo, __filename);

const today = DateTime.local().toISODate();

// Company in Maharashtra (27).
const companyGstin = '27AAAAA0000A1Z5';

const items = [
  { name: 'Shirt', rate: 1000, tax: 'GST-18' },
  { name: 'Laptop', rate: 50000, tax: 'IGST-18' },
  { name: 'Rice', rate: 100, tax: 'GST-0' },
  { name: 'Textbook', rate: 200, tax: 'Exempt-GST-0' },
  { name: 'Petrol', rate: 100 },
];

async function makeSalesInvoice(
  party: string,
  lines: { item: string; quantity: number; rate?: number }[]
) {
  const doc = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Debtors',
    party,
    date: today,
    items: lines.map((line) => ({
      rate: items.find((i) => i.name === line.item)!.rate,
      ...line,
    })),
  }) as SalesInvoice;
  await doc.runFormulas();
  await doc.sync();
  await doc.submit();
  return doc;
}

test('create GST masters', async (t) => {
  await fyo.singles.AccountingSettings!.setAndSync('gstin', companyGstin);

  for (const item of items) {
    await fyo.doc
      .getNewDoc(ModelNameEnum.Item, { ...item, unit: 'Unit', for: 'Both' })
      .sync();
  }

  await fyo.doc
    .getNewDoc(ModelNameEnum.Party, {
      name: 'Local Traders',
      role: 'Customer',
      gstType: 'Registered Regular',
      gstin: '27BBBBB1111B1Z5',
    })
    .sync();

  const address = fyo.doc.getNewDoc(ModelNameEnum.Address, {
    name: 'Bengaluru Office',
    addressLine1: '1 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
  });
  await address.sync();
  await fyo.doc
    .getNewDoc(ModelNameEnum.Party, {
      name: 'Walk-in Bengaluru',
      role: 'Customer',
      gstType: 'Unregistered',
      address: address.name,
    })
    .sync();

  await fyo.doc
    .getNewDoc(ModelNameEnum.Party, {
      name: 'Pune Supplies',
      role: 'Supplier',
      gstType: 'Registered Regular',
      gstin: '27CCCCC2222C1Z5',
    })
    .sync();

  t.equal(
    await fyo.getValue(ModelNameEnum.Address, 'Bengaluru Office', 'pos'),
    'Karnataka',
    'place of supply set from address state'
  );
});

test('create GST transactions', async (t) => {
  const local = await makeSalesInvoice('Local Traders', [
    { item: 'Shirt', quantity: 2 },
    { item: 'Rice', quantity: 10 },
    { item: 'Textbook', quantity: 1 },
    { item: 'Petrol', quantity: 5 },
  ]);
  t.equal(local.grandTotal!.float, 3700 + 360, 'local invoice total');

  await makeSalesInvoice('Walk-in Bengaluru', [
    { item: 'Laptop', quantity: 1 },
  ]);

  const creditNote = (await local.getReturnDoc()) as SalesInvoice;
  creditNote.items = [];
  creditNote.append('items', { item: 'Shirt', quantity: 1, rate: 1000 });
  await creditNote.runFormulas();
  await creditNote.sync();
  await creditNote.submit();
  t.ok(creditNote.isReturn, 'credit note created');

  const purchase = fyo.doc.getNewDoc(ModelNameEnum.PurchaseInvoice, {
    account: 'Creditors',
    party: 'Pune Supplies',
    date: today,
    items: [
      { item: 'Shirt', quantity: 10, rate: 500 },
      { item: 'Rice', quantity: 5, rate: 100 },
    ],
  }) as PurchaseInvoice;
  await purchase.sync();
  await purchase.submit();
  t.equal(purchase.grandTotal!.float, 5500 + 900, 'purchase total');
});

test('GSTR-3B figures', async (t) => {
  const data = await getGSTR3BData(fyo, today, today);
  const { outward, itc, inward, payment } = data;

  // Shirt 2000 - 1000 returned + Laptop 50000.
  t.equal(outward.taxable.taxableValue.float, 51000, '3.1(a) taxable value');
  t.equal(outward.taxable.igst.float, 9000, '3.1(a) IGST');
  t.equal(outward.taxable.cgst.float, 90, '3.1(a) CGST net of credit note');
  t.equal(outward.taxable.sgst.float, 90, '3.1(a) SGST net of credit note');
  t.equal(outward.nilExempt.taxableValue.float, 1200, '3.1(c) nil + exempt');
  t.equal(outward.nonGST.taxableValue.float, 500, '3.1(e) non-GST');

  t.deepEqual(
    data.interStateUnregistered.map((r) => [
      r.place,
      r.taxableValue.float,
      r.igst.float,
    ]),
    [['Karnataka', 50000, 9000]],
    '3.2 by place of supply'
  );

  t.equal(itc.net.igst.float, 0, '4(C) IGST');
  t.equal(itc.net.cgst.float, 450, '4(C) CGST');
  t.equal(itc.net.sgst.float, 450, '4(C) SGST');

  t.equal(inward.nilExempt.intra.float, 500, '5 nil rated intra-state');
  t.equal(inward.nilExempt.inter.float, 0, '5 nil rated inter-state');

  // CGST 450 credit pays CGST 90, remaining 360 goes to IGST; same for SGST.
  t.equal(payment.cash.igst.float, 9000 - 360 - 360, '6.1 IGST in cash');
  t.equal(payment.cash.cgst.float, 0, '6.1 CGST in cash');
  t.equal(payment.cash.sgst.float, 0, '6.1 SGST in cash');
  t.equal(payment.carryForward.cgst.float, 0, '6.1 CGST credit used up');
});

test('GSTR-1 rows use actual tax amounts', async (t) => {
  const companyState = await getCompanyState(fyo);
  const names = (await fyo.db.getAllRaw(ModelNameEnum.SalesInvoice, {
    fields: ['name'],
    filters: { submitted: true, cancelled: false },
  })) as { name: string }[];
  const rows = [];
  for (const { name } of names) {
    const invoice = (await fyo.doc.getDoc(
      ModelNameEnum.SalesInvoice,
      name
    )) as SalesInvoice;
    rows.push(await getGSTRRow(invoice, companyState));
  }

  const local = rows.find(
    (r) => r.partyName === 'Local Traders' && r.taxVal > 0
  );
  t.equal(local?.rate, 18, 'rate counted once');
  t.equal(local?.cgstAmt, 180, 'CGST');
  t.equal(local?.sgstAmt, 180, 'SGST');
  t.equal(local?.igstAmt, 0, 'no IGST on intra-state invoice');
  t.equal(local?.taxVal, 3700, 'taxable value includes all lines');
  t.ok(local?.nilRated && local?.exempt && local?.nonGST, 'line categories');
  t.equal(local?.reverseCharge, 'N', 'not reverse charge');
  t.ok(local?.inState, 'intra-state');

  const interState = rows.find((r) => r.partyName === 'Walk-in Bengaluru');
  t.equal(interState?.igstAmt, 9000, 'IGST');
  t.equal(interState?.cgstAmt, 0, 'no CGST on IGST invoice');
  t.equal(interState?.place, 'Karnataka', 'place of supply');
  t.notOk(interState?.inState, 'inter-state');
});

test('tax is charged when discount is applied after tax', async (t) => {
  await fyo.singles.AccountingSettings!.setAndSync('enableDiscounting', true);
  const doc = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Debtors',
    party: 'Local Traders',
    date: today,
    discountAfterTax: true,
    discountPercent: 10,
    items: [{ item: 'Shirt', quantity: 1, rate: 1000 }],
  }) as SalesInvoice;
  await doc.runFormulas();
  await doc.sync();

  const totalTax = (doc.taxes ?? []).reduce(
    (sum, tax) => sum + (tax.amount?.float ?? 0),
    0
  );
  t.equal(totalTax, 180, 'GST charged on the undiscounted amount');
  t.equal(
    doc.getTotalDiscount().float,
    118,
    'discount computed on the taxed total'
  );
});

closeTestFyo(fyo, __filename);
