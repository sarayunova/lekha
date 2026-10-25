import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';

/**
 * Parser for XML exported from Tally (ERP 9 and Prime) using
 * Display > Export (or Gateway > Export) in XML format.
 *
 * Amounts in Tally XML are signed: negative is debit, positive is credit.
 */

export interface TallyGroup {
  name: string;
  parent: string;
  reservedName: string;
}

export interface TallyLedger {
  name: string;
  parent: string;
  openingBalance: number;
  gstin: string;
  state: string;
  address: string[];
  pincode: string;
  email: string;
  phone: string;
}

export interface TallyStockItem {
  name: string;
  parent: string;
  unit: string;
  hsnCode: string;
  gstRate?: number;
  openingQuantity: number;
  openingValue: number;
}

export interface TallyVoucherEntry {
  ledger: string;
  amount: number;
}

export interface TallyVoucher {
  date: string;
  voucherType: string;
  number: string;
  narration: string;
  entries: TallyVoucherEntry[];
}

export interface TallyData {
  companyName: string;
  booksFrom: string;
  groups: TallyGroup[];
  ledgers: TallyLedger[];
  units: string[];
  stockItems: TallyStockItem[];
  // Custom voucher type name -> parent (base) voucher type
  voucherTypes: Record<string, string>;
  vouchers: TallyVoucher[];
  skippedVouchers: number;
}

export function decodeTallyFile(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  }

  if (data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  }

  // UTF-16 without BOM: every other byte of "<ENVELOPE>" is zero.
  if (data.length > 1 && data[0] === 0x3c && data[1] === 0) {
    return new TextDecoder('utf-16le').decode(data);
  }

  return new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
}

/**
 * Tally writes control characters (e.g. `&#4;`) that are not allowed in XML.
 */
function sanitize(xml: string): string {
  return xml
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (match, code: string) => {
      const value =
        code[0].toLowerCase() === 'x'
          ? parseInt(code.slice(1), 16)
          : parseInt(code, 10);
      if (value < 0x20 && value !== 0x9 && value !== 0xa && value !== 0xd) {
        return '';
      }
      return match;
    })
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function children(el: Element, tag: string): Element[] {
  const elements: Element[] = [];
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).tagName === tag) {
      elements.push(node as Element);
    }
  }
  return elements;
}

function text(el: Element | undefined, tag?: string): string {
  if (!el) {
    return '';
  }

  if (tag) {
    el = children(el, tag)[0];
  }

  return el?.textContent?.trim() ?? '';
}

function descendantText(el: Element, tag: string): string {
  for (const found of Array.from(el.getElementsByTagName(tag))) {
    const value = found.textContent?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function getName(el: Element): string {
  const name = el.getAttribute('NAME')?.trim();
  if (name) {
    return name;
  }

  const nameList = el.getElementsByTagName('NAME.LIST')[0];
  return text(nameList, 'NAME') || text(el, 'NAME');
}

function isYes(value: string) {
  return value.toLowerCase() === 'yes';
}

/**
 * Parses amounts like "-1180.00", "1,180.00", "-₹ 1180.00 @ ..." or
 * "10 Nos" (quantity), returning the leading signed number.
 */
export function parseTallyNumber(value: string): number {
  const match = value.replace(/,/g, '').match(/^(\D*?)(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  const number = parseFloat(match[2]);
  return match[1].includes('-') ? -number : number;
}

function parseDate(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseGroup(el: Element): TallyGroup {
  return {
    name: getName(el),
    parent: text(el, 'PARENT'),
    reservedName: el.getAttribute('RESERVEDNAME')?.trim() ?? '',
  };
}

function parseLedger(el: Element): TallyLedger {
  const mailing = el.getElementsByTagName('LEDMAILINGDETAILS.LIST')[0];
  const addressList =
    (mailing && mailing.getElementsByTagName('ADDRESS.LIST')[0]) ??
    children(el, 'ADDRESS.LIST')[0];
  const address = addressList
    ? children(addressList, 'ADDRESS')
        .map((a) => text(a))
        .filter(Boolean)
    : [];

  return {
    name: getName(el),
    parent: text(el, 'PARENT'),
    openingBalance: parseTallyNumber(text(el, 'OPENINGBALANCE')),
    gstin: (
      text(el, 'PARTYGSTIN') || descendantText(el, 'GSTIN')
    ).toUpperCase(),
    state:
      text(el, 'LEDSTATENAME') ||
      (mailing ? text(mailing, 'STATE') : '') ||
      text(el, 'STATENAME'),
    address,
    pincode: text(el, 'PINCODE') || (mailing ? text(mailing, 'PINCODE') : ''),
    email: text(el, 'EMAIL'),
    phone: text(el, 'LEDGERMOBILE') || text(el, 'LEDGERPHONE'),
  };
}

function parseStockItem(el: Element): TallyStockItem {
  let gstRate: number | undefined;
  for (const rateEl of Array.from(el.getElementsByTagName('RATEDETAILS.LIST'))) {
    const head = text(rateEl, 'GSTRATEDUTYHEAD');
    const rate = text(rateEl, 'GSTRATE');
    if (head === 'Integrated Tax' && rate) {
      gstRate = parseTallyNumber(rate);
      break;
    }
  }

  return {
    name: getName(el),
    parent: text(el, 'PARENT'),
    unit: text(el, 'BASEUNITS'),
    hsnCode: descendantText(el, 'HSNCODE'),
    gstRate,
    openingQuantity: Math.abs(parseTallyNumber(text(el, 'OPENINGBALANCE'))),
    openingValue: Math.abs(parseTallyNumber(text(el, 'OPENINGVALUE'))),
  };
}

function parseEntries(el: Element, tag: string): TallyVoucherEntry[] {
  return children(el, tag)
    .map((entry) => ({
      ledger: text(entry, 'LEDGERNAME'),
      amount: parseTallyNumber(text(entry, 'AMOUNT')),
    }))
    .filter((entry) => entry.ledger && entry.amount !== 0);
}

function parseVoucher(el: Element): TallyVoucher | null {
  const flags = ['ISCANCELLED', 'ISOPTIONAL', 'ISDELETED', 'ISVOID'];
  if (flags.some((flag) => isYes(text(el, flag)))) {
    return null;
  }

  const entries = [
    ...parseEntries(el, 'ALLLEDGERENTRIES.LIST'),
    ...parseEntries(el, 'LEDGERENTRIES.LIST'),
  ];

  for (const tag of ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST']) {
    for (const inventory of children(el, tag)) {
      entries.push(...parseEntries(inventory, 'ACCOUNTINGALLOCATIONS.LIST'));
    }
  }

  if (!entries.length) {
    return null;
  }

  return {
    date: parseDate(text(el, 'DATE')),
    voucherType:
      text(el, 'VOUCHERTYPENAME') || el.getAttribute('VCHTYPE')?.trim() || '',
    number: text(el, 'VOUCHERNUMBER'),
    narration: text(el, 'NARRATION'),
    entries,
  };
}

export function parseTallyXML(xml: string): TallyData {
  const doc = new DOMParser({
    onError(level, message) {
      if (level === 'fatalError') {
        throw new Error(message);
      }
    },
  }).parseFromString(sanitize(xml), 'text/xml');

  const root = doc.documentElement;
  if (!root || root.tagName !== 'ENVELOPE') {
    throw new Error('Not a Tally XML export');
  }

  const data: TallyData = {
    companyName: '',
    booksFrom: '',
    groups: [],
    ledgers: [],
    units: [],
    stockItems: [],
    voucherTypes: {},
    vouchers: [],
    skippedVouchers: 0,
  };

  for (const message of Array.from(root.getElementsByTagName('TALLYMESSAGE'))) {
    for (let node = message.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) {
        continue;
      }

      const el = node as Element;
      switch (el.tagName) {
        case 'COMPANY':
          data.companyName ||= getName(el);
          data.booksFrom ||= parseDate(text(el, 'BOOKSFROM'));
          break;
        case 'GROUP':
          data.groups.push(parseGroup(el));
          break;
        case 'LEDGER':
          data.ledgers.push(parseLedger(el));
          break;
        case 'UNIT':
          data.units.push(getName(el));
          break;
        case 'STOCKITEM':
          data.stockItems.push(parseStockItem(el));
          break;
        case 'VOUCHERTYPE':
          data.voucherTypes[getName(el)] = text(el, 'PARENT');
          break;
        case 'VOUCHER': {
          const voucher = parseVoucher(el);
          if (voucher) {
            data.vouchers.push(voucher);
          } else {
            data.skippedVouchers += 1;
          }
          break;
        }
      }
    }
  }

  return data;
}
