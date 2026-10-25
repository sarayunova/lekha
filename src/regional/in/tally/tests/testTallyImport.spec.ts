import { ModelNameEnum } from 'models/types';
import { QueryFilter } from 'utils/db/types';
import test from 'tape';
import { closeTestFyo, getTestFyo, setupTestFyo } from 'tests/helpers';
import { importTallyData, OPENING_REFERENCE } from '../importer';
import { decodeTallyFile, parseTallyNumber, parseTallyXML } from '../parser';

const fyo = getTestFyo();
setupTestFyo(fyo, __filename);

const masters = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
 <REQUESTDATA>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <GROUP NAME="Sundry Debtors" RESERVEDNAME="Sundry Debtors"><PARENT/></GROUP>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <GROUP NAME="Mumbai Debtors" RESERVEDNAME=""><PARENT>Sundry Debtors</PARENT></GROUP>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <GROUP NAME="Office Costs" RESERVEDNAME=""><PARENT>Indirect Expenses</PARENT></GROUP>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Cash" RESERVEDNAME="Cash"><PARENT>Cash-in-Hand</PARENT>
    <OPENINGBALANCE>-10000.00</OPENINGBALANCE></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="HDFC Bank" RESERVEDNAME=""><PARENT>Bank Accounts</PARENT>
    <OPENINGBALANCE>-50,000.00</OPENINGBALANCE></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Capital" RESERVEDNAME=""><PARENT>Capital Account</PARENT>
    <OPENINGBALANCE>70000.00</OPENINGBALANCE></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Sharma &amp; Sons&#4;" RESERVEDNAME=""><PARENT>Mumbai Debtors</PARENT>
    <ADDRESS.LIST TYPE="String"><ADDRESS>12 Market Road</ADDRESS><ADDRESS>Pune</ADDRESS></ADDRESS.LIST>
    <LEDSTATENAME>Maharashtra</LEDSTATENAME>
    <PARTYGSTIN>27aaaca1111a1z5</PARTYGSTIN>
    <OPENINGBALANCE>-15000.00</OPENINGBALANCE></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Gupta Traders" RESERVEDNAME=""><PARENT>Sundry Creditors</PARENT>
    <LEDMAILINGDETAILS.LIST><ADDRESS.LIST TYPE="String"><ADDRESS>Sector 5</ADDRESS><ADDRESS>Noida</ADDRESS></ADDRESS.LIST>
     <STATE>Uttar Pradesh</STATE></LEDMAILINGDETAILS.LIST>
    <OPENINGBALANCE>8000.00</OPENINGBALANCE></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Sales" RESERVEDNAME=""><PARENT>Sales Accounts</PARENT></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Purchase" RESERVEDNAME=""><PARENT>Purchase Accounts</PARENT></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="CGST" RESERVEDNAME=""><PARENT>Duties &amp; Taxes</PARENT></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="SGST" RESERVEDNAME=""><PARENT>Duties &amp; Taxes</PARENT></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Office Rent" RESERVEDNAME=""><PARENT>Office Costs</PARENT></LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <UNIT NAME="Nos" RESERVEDNAME=""><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <STOCKITEM NAME="Steel Rod" RESERVEDNAME=""><PARENT/><BASEUNITS>Nos</BASEUNITS>
    <OPENINGBALANCE> 10 Nos</OPENINGBALANCE><OPENINGVALUE>-5000.00</OPENINGVALUE>
    <GSTDETAILS.LIST><HSNCODE>7214</HSNCODE>
     <STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD><GSTRATE> 9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE> 18</GSTRATE></RATEDETAILS.LIST>
     </STATEWISEDETAILS.LIST></GSTDETAILS.LIST>
   </STOCKITEM>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHERTYPE NAME="Sales GST" RESERVEDNAME=""><PARENT>Sales</PARENT></VOUCHERTYPE>
  </TALLYMESSAGE>
 </REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;

const vouchers = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
 <REQUESTDATA>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Sales GST" ACTION="Create">
    <DATE>20250405</DATE><VOUCHERTYPENAME>Sales GST</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Sharma &amp; Sons</PARTYLEDGERNAME><NARRATION>Rods sold</NARRATION>
    <ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>
    <LEDGERENTRIES.LIST><LEDGERNAME>Sharma &amp; Sons</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-11800.00</AMOUNT></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><AMOUNT>900.00</AMOUNT></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><AMOUNT>900.00</AMOUNT></LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>      </LEDGERENTRIES.LIST>
    <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Steel Rod</STOCKITEMNAME><AMOUNT>10000.00</AMOUNT>
     <ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>10000.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
    </ALLINVENTORYENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Receipt" ACTION="Create">
    <DATE>20250410</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sharma &amp; Sons</LEDGERNAME><AMOUNT>20000.00</AMOUNT>
     <BILLALLOCATIONS.LIST><NAME>1</NAME><AMOUNT>20000.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>-20000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Payment" ACTION="Create">
    <DATE>20250415</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-3000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>3000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Purchase" ACTION="Create">
    <DATE>20250416</DATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><VOUCHERNUMBER>P-1</VOUCHERNUMBER>
    <ISCANCELLED>Yes</ISCANCELLED>
   </VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Journal" ACTION="Create">
    <DATE>20250417</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Unknown Ledger</LEDGERNAME><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
 </REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;

function toUTF16(text: string) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[3 + i * 2] = code >> 8;
  }
  return bytes;
}

async function getBalance(account: string, party?: string) {
  const filters: QueryFilter = { account, reverted: false };
  if (party) {
    filters.party = party;
  }

  const entries = (await fyo.db.getAllRaw(
    ModelNameEnum.AccountingLedgerEntry,
    { fields: ['debit', 'credit'], filters }
  )) as { debit: string; credit: string }[];

  return entries.reduce(
    (sum, e) => sum + Number(e.debit) - Number(e.credit),
    0
  );
}

test('parse Tally numbers', (t) => {
  t.equal(parseTallyNumber('-1,180.50'), -1180.5, 'negative with commas');
  t.equal(parseTallyNumber(' 10 Nos'), 10, 'quantity with unit');
  t.equal(parseTallyNumber('-₹ 100.00 @ ₹ 1/₹'), -100, 'currency symbol');
  t.equal(parseTallyNumber(''), 0, 'empty');
  t.end();
});

test('parse Tally XML', (t) => {
  const text = decodeTallyFile(toUTF16(masters));
  const data = parseTallyXML(text);

  t.equal(data.groups.length, 3, 'groups');
  t.equal(data.ledgers.length, 10, 'ledgers');
  t.equal(data.ledgers[3].name, 'Sharma & Sons', 'control entity removed');
  t.equal(data.ledgers[1].openingBalance, -50000, 'opening balance');
  t.deepEqual(
    data.ledgers[4].address,
    ['Sector 5', 'Noida'],
    'mailing address'
  );
  t.equal(data.ledgers[4].state, 'Uttar Pradesh', 'mailing state');
  t.equal(data.stockItems[0].gstRate, 18, 'IGST rate');
  t.equal(data.stockItems[0].hsnCode, '7214', 'HSN code');
  t.equal(data.stockItems[0].openingValue, 5000, 'stock opening value');
  t.equal(data.voucherTypes['Sales GST'], 'Sales', 'voucher type parent');

  const vouchersData = parseTallyXML(vouchers);
  t.equal(vouchersData.vouchers.length, 4, 'vouchers parsed');
  t.equal(vouchersData.skippedVouchers, 1, 'cancelled voucher skipped');
  t.equal(vouchersData.vouchers[0].entries.length, 4, 'inventory allocation');
  t.equal(vouchersData.vouchers[0].date, '2025-04-05', 'date');

  t.throws(() => parseTallyXML('<HTML></HTML>'), 'rejects non-Tally XML');
  t.end();
});

test('import Tally data', async (t) => {
  const data = parseTallyXML(masters);
  const voucherData = parseTallyXML(vouchers);
  data.vouchers = voucherData.vouchers;

  const progress: number[] = [];
  const result = await importTallyData(fyo, data, (done) =>
    progress.push(done)
  );

  t.deepEqual(progress, [1, 2, 3, 4], 'progress reported');
  t.equal(result.parties, 2, 'parties created');
  t.equal(result.items, 1, 'items created');
  t.ok(result.openingEntry, 'opening entry posted');
  t.equal(result.vouchers, 3, 'vouchers posted');
  t.equal(result.errors.length, 1, 'one voucher failed');
  t.ok(result.errors[0]?.includes('Unknown Ledger'), 'error names ledger');

  const sharma = await fyo.doc.getDoc(ModelNameEnum.Party, 'Sharma & Sons');
  t.equal(sharma.role, 'Customer', 'debtor is a customer');
  t.equal(sharma.gstin, '27AAACA1111A1Z5', 'GSTIN upper-cased');
  t.equal(sharma.gstType, 'Registered Regular', 'registered');
  t.equal(
    await fyo.getValue(ModelNameEnum.Address, 'Sharma & Sons', 'pos'),
    'Maharashtra',
    'place of supply from GSTIN'
  );
  t.equal(
    await fyo.getValue(ModelNameEnum.Address, 'Gupta Traders', 'city'),
    'Noida',
    'city from last address line'
  );
  t.equal(
    await fyo.getValue(ModelNameEnum.Party, 'Gupta Traders', 'role'),
    'Supplier',
    'creditor is a supplier'
  );

  t.equal(
    await fyo.getValue(ModelNameEnum.Account, 'HDFC Bank', 'accountType'),
    'Bank',
    'bank account type'
  );
  t.equal(
    await fyo.getValue(ModelNameEnum.Account, 'HDFC Bank', 'parentAccount'),
    'Bank Accounts',
    'bank under Bank Accounts'
  );
  t.equal(
    await fyo.getValue(ModelNameEnum.Account, 'Office Costs', 'parentAccount'),
    'Indirect Expenses',
    'custom group recreated'
  );
  t.equal(
    await fyo.getValue(ModelNameEnum.Account, 'Office Rent', 'parentAccount'),
    'Indirect Expenses',
    'existing account reused'
  );
  t.notOk(
    await fyo.db.exists(ModelNameEnum.Account, 'Mumbai Debtors'),
    'no account for party groups'
  );
  t.equal(
    await fyo.getValue(ModelNameEnum.Item, 'Steel Rod', 'tax'),
    'GST-18',
    'item tax template'
  );

  t.equal(await getBalance('Cash'), 10000 - 3000, 'cash balance');
  t.equal(await getBalance('HDFC Bank'), 50000 + 20000, 'bank balance');
  t.equal(
    await getBalance('Debtors', 'Sharma & Sons'),
    15000 + 11800 - 20000,
    'party balance kept separately'
  );
  t.equal(
    await getBalance('Creditors', 'Gupta Traders'),
    -8000,
    'supplier balance'
  );
  t.equal(await getBalance('Stock In Hand'), 5000, 'stock opening value');
  t.equal(
    await getBalance('Temporary Opening'),
    -(10000 + 50000 + 15000 + 5000 - 70000 - 8000),
    'opening difference'
  );
  t.equal(await getBalance('Sales'), -10000, 'sales');

  const entryTypes = (await fyo.db.getAllRaw(ModelNameEnum.JournalEntry, {
    fields: ['entryType', 'referenceNumber'],
    orderBy: 'referenceNumber',
    order: 'asc',
  })) as { entryType: string; referenceNumber: string }[];
  t.deepEqual(
    entryTypes.map((e) => [e.referenceNumber, e.entryType]),
    [
      ['Payment 1', 'Cash Entry'],
      ['Receipt 1', 'Bank Entry'],
      ['Sales GST 1', 'Journal Entry'],
      [OPENING_REFERENCE, 'Opening Entry'],
    ],
    'entry types'
  );

  const again = await importTallyData(fyo, data);
  t.equal(again.vouchers, 0, 're-import posts nothing');
  t.equal(again.duplicates, 4, 'duplicates detected');
  t.equal(again.parties, 0, 'parties not duplicated');
});

test('import vouchers after masters', async (t) => {
  const data = parseTallyXML(vouchers.replace(/20250405/g, '20250501'));
  const result = await importTallyData(fyo, data);
  t.equal(result.vouchers, 1, 'voucher posted using existing ledgers');
  t.equal(result.duplicates, 2, 'other vouchers already imported');
  t.equal(
    await getBalance('Debtors', 'Sharma & Sons'),
    15000 + 11800 * 2 - 20000,
    'party resolved from existing parties'
  );
});

closeTestFyo(fyo, __filename);
