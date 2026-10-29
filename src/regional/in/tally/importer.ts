import { Fyo, t } from 'fyo';
import { ModelNameEnum } from 'models/types';
import { codeStateMap } from 'regional/in';
import { TallyData, TallyLedger, TallyVoucher } from './parser';

/**
 * Imports parsed Tally data into the current Lekha books:
 *
 * - Tally groups become group Accounts under the matching Lekha group.
 * - Ledgers under Sundry Debtors/Creditors become Parties, booked against
 *   the Receivable/Payable account with the party set on each line.
 * - Other ledgers become Accounts (same-name accounts are reused).
 * - Stock items become Items.
 * - Opening balances are posted as one Opening Entry, the difference goes
 *   to the Temporary Opening account.
 * - Vouchers are posted as submitted Journal Entries.
 */

type RootType = 'Asset' | 'Liability' | 'Income' | 'Expense';

interface GroupMapping {
  parents: string[];
  rootType: RootType;
  accountType?: string;
  partyRole?: 'Customer' | 'Supplier';
}

const reservedGroups: Record<string, GroupMapping> = {
  'Capital Account': { parents: ['Capital Account'], rootType: 'Liability' },
  'Reserves & Surplus': { parents: ['Capital Account'], rootType: 'Liability' },
  'Current Assets': { parents: ['Current Assets'], rootType: 'Asset' },
  'Bank Accounts': {
    parents: ['Bank Accounts'],
    rootType: 'Asset',
    accountType: 'Bank',
  },
  'Cash-in-Hand': {
    parents: ['Cash In Hand'],
    rootType: 'Asset',
    accountType: 'Cash',
  },
  'Deposits (Asset)': {
    parents: ['Securities and Deposits', 'Current Assets'],
    rootType: 'Asset',
  },
  'Loans & Advances (Asset)': {
    parents: ['Loans and Advances (Assets)', 'Current Assets'],
    rootType: 'Asset',
  },
  'Stock-in-Hand': {
    parents: ['Stock Assets', 'Current Assets'],
    rootType: 'Asset',
    accountType: 'Stock',
  },
  'Sundry Debtors': {
    parents: ['Accounts Receivable', 'Current Assets'],
    rootType: 'Asset',
    accountType: 'Receivable',
    partyRole: 'Customer',
  },
  'Fixed Assets': {
    parents: ['Fixed Assets'],
    rootType: 'Asset',
    accountType: 'Fixed Asset',
  },
  Investments: { parents: ['Investments'], rootType: 'Asset' },
  'Misc. Expenses (ASSET)': { parents: ['Current Assets'], rootType: 'Asset' },
  'Current Liabilities': {
    parents: ['Current Liabilities'],
    rootType: 'Liability',
  },
  'Duties & Taxes': {
    parents: ['Duties and Taxes', 'Current Liabilities'],
    rootType: 'Liability',
    accountType: 'Tax',
  },
  Provisions: { parents: ['Current Liabilities'], rootType: 'Liability' },
  'Sundry Creditors': {
    parents: ['Accounts Payable', 'Current Liabilities'],
    rootType: 'Liability',
    accountType: 'Payable',
    partyRole: 'Supplier',
  },
  'Loans (Liability)': {
    parents: ['Loans (Liabilities)'],
    rootType: 'Liability',
  },
  'Bank OD A/c': {
    parents: ['Loans (Liabilities)'],
    rootType: 'Liability',
    accountType: 'Bank',
  },
  'Bank OCC A/c': {
    parents: ['Loans (Liabilities)'],
    rootType: 'Liability',
    accountType: 'Bank',
  },
  'Secured Loans': { parents: ['Loans (Liabilities)'], rootType: 'Liability' },
  'Unsecured Loans': {
    parents: ['Loans (Liabilities)'],
    rootType: 'Liability',
  },
  'Suspense A/c': { parents: ['Current Liabilities'], rootType: 'Liability' },
  'Branch / Divisions': {
    parents: ['Current Liabilities'],
    rootType: 'Liability',
  },
  'Sales Accounts': {
    parents: ['Direct Income'],
    rootType: 'Income',
    accountType: 'Income Account',
  },
  'Direct Incomes': {
    parents: ['Direct Income'],
    rootType: 'Income',
    accountType: 'Income Account',
  },
  'Indirect Incomes': {
    parents: ['Indirect Income'],
    rootType: 'Income',
    accountType: 'Income Account',
  },
  'Purchase Accounts': { parents: ['Direct Expenses'], rootType: 'Expense' },
  'Direct Expenses': { parents: ['Direct Expenses'], rootType: 'Expense' },
  'Indirect Expenses': { parents: ['Indirect Expenses'], rootType: 'Expense' },
  // Ledgers directly under Primary, e.g. "Profit & Loss A/c"
  Primary: { parents: ['Capital Account'], rootType: 'Liability' },
};

const baseVoucherTypes = [
  'Contra',
  'Payment',
  'Receipt',
  'Journal',
  'Sales',
  'Purchase',
  'Credit Note',
  'Debit Note',
];

export interface TallyImportResult {
  accounts: number;
  parties: number;
  items: number;
  openingEntry: boolean;
  vouchers: number;
  duplicates: number;
  errors: string[];
}

export type TallyImportProgress = (done: number, total: number) => void;

interface AccountInfo {
  name: string;
  isGroup: boolean;
  rootType: RootType;
  accountType: string;
}

interface LedgerTarget {
  account: string;
  party?: string;
}

interface JournalLine extends LedgerTarget {
  amount: number;
}

export const OPENING_REFERENCE = 'Tally Opening Balances';

export class TallyImporter {
  fyo: Fyo;
  data: TallyData;
  result: TallyImportResult;
  accounts: Map<string, AccountInfo> = new Map();
  groupParents: Map<string, string> = new Map();
  groupAccounts: Map<string, string> = new Map();
  ledgerTargets: Map<string, LedgerTarget> = new Map();

  constructor(fyo: Fyo, data: TallyData) {
    this.fyo = fyo;
    this.data = data;
    this.result = {
      accounts: 0,
      parties: 0,
      items: 0,
      openingEntry: false,
      vouchers: 0,
      duplicates: 0,
      errors: [],
    };
  }

  async import(onProgress?: TallyImportProgress) {
    await this.loadAccounts();
    for (const group of this.data.groups) {
      const name = group.reservedName || group.name;
      if (!reservedGroups[name] && group.parent) {
        this.groupParents.set(group.name, group.parent);
      }
    }

    await this.importLedgers();
    await this.importItems();
    await this.importOpeningBalances();
    await this.importVouchers(onProgress);
    return this.result;
  }

  async loadAccounts() {
    const accounts = (await this.fyo.db.getAllRaw(ModelNameEnum.Account, {
      fields: ['name', 'isGroup', 'rootType', 'accountType'],
    })) as unknown as AccountInfo[];

    for (const account of accounts) {
      this.accounts.set(account.name, {
        name: account.name,
        isGroup: !!account.isGroup,
        rootType: account.rootType,
        accountType: account.accountType ?? '',
      });
    }
  }

  /**
   * Returns the reserved group a Tally group belongs to along with the
   * chain of custom groups between them (outermost first).
   */
  resolveGroup(name: string): { mapping: GroupMapping; chain: string[] } {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = name || 'Primary';
    while (!reservedGroups[current]) {
      const parent = this.groupParents.get(current);
      if (parent === undefined || seen.has(current)) {
        throw new Error(
          t`Tally group ${current} could not be mapped to an account group`
        );
      }

      seen.add(current);
      chain.unshift(current);
      current = parent || 'Primary';
    }

    return { mapping: reservedGroups[current], chain };
  }

  findAccount(
    filter: (account: AccountInfo) => boolean
  ): AccountInfo | undefined {
    for (const account of this.accounts.values()) {
      if (filter(account)) {
        return account;
      }
    }
  }

  getBaseGroup(mapping: GroupMapping): string {
    for (const name of mapping.parents) {
      const account = this.accounts.get(name);
      if (account?.isGroup && account.rootType === mapping.rootType) {
        return name;
      }
    }

    const root = this.findAccount(
      (a) => a.isGroup && a.rootType === mapping.rootType
    );
    if (!root) {
      throw new Error(
        t`No ${mapping.rootType} account group found in the chart of accounts`
      );
    }
    return root.name;
  }

  getAvailableName(name: string, isGroup: boolean, rootType: RootType) {
    const existing = this.accounts.get(name);
    if (!existing) {
      return { name, exists: false };
    }

    if (existing.isGroup === isGroup && existing.rootType === rootType) {
      return { name, exists: true };
    }

    let suffix = 1;
    let candidate = `${name} (Tally)`;
    while (this.accounts.has(candidate)) {
      suffix += 1;
      candidate = `${name} (Tally ${suffix})`;
    }
    return { name: candidate, exists: false };
  }

  async createAccount(
    name: string,
    parentAccount: string,
    isGroup: boolean,
    mapping: GroupMapping
  ): Promise<string> {
    const available = this.getAvailableName(name, isGroup, mapping.rootType);
    if (available.exists) {
      return available.name;
    }

    const accountType = mapping.accountType ?? '';
    await this.fyo.doc
      .getNewDoc(ModelNameEnum.Account, {
        name: available.name,
        parentAccount,
        rootType: mapping.rootType,
        accountType: accountType || undefined,
        isGroup,
      })
      .sync();

    this.accounts.set(available.name, {
      name: available.name,
      isGroup,
      rootType: mapping.rootType,
      accountType,
    });
    this.result.accounts += 1;
    return available.name;
  }

  async getGroupAccount(tallyGroup: string): Promise<string> {
    const cached = this.groupAccounts.get(tallyGroup);
    if (cached) {
      return cached;
    }

    const { mapping, chain } = this.resolveGroup(tallyGroup);
    let parent = this.getBaseGroup(mapping);
    for (const group of chain) {
      const known = this.groupAccounts.get(group);
      parent =
        known ?? (await this.createAccount(group, parent, true, mapping));
      this.groupAccounts.set(group, parent);
    }

    this.groupAccounts.set(tallyGroup, parent);
    return parent;
  }

  async importLedgers() {
    for (const ledger of this.data.ledgers) {
      try {
        const { mapping } = this.resolveGroup(ledger.parent);
        if (mapping.partyRole) {
          const party = await this.importParty(ledger, mapping.partyRole);
          const account = this.getPartyAccount(mapping);
          this.ledgerTargets.set(ledger.name, { account, party });
          continue;
        }

        const parent = await this.getGroupAccount(ledger.parent);
        const account = await this.createAccount(
          ledger.name,
          parent,
          false,
          mapping
        );
        this.ledgerTargets.set(ledger.name, { account });
      } catch (error) {
        this.addError(t`Ledger ${ledger.name}`, error);
      }
    }
  }

  getPartyAccount(mapping: GroupMapping) {
    const account = this.findAccount(
      (a) => !a.isGroup && a.accountType === mapping.accountType
    );
    if (!account) {
      throw new Error(
        t`No ${mapping.accountType!} account found in the chart of accounts`
      );
    }
    return account.name;
  }

  async importParty(ledger: TallyLedger, role: 'Customer' | 'Supplier') {
    const name = ledger.name;
    if (await this.fyo.db.exists(ModelNameEnum.Party, name)) {
      const existingRole = await this.fyo.getValue(
        ModelNameEnum.Party,
        name,
        'role'
      );
      if (existingRole !== role && existingRole !== 'Both') {
        const party = await this.fyo.doc.getDoc(ModelNameEnum.Party, name);
        await party.setAndSync('role', 'Both');
      }
      return name;
    }

    const gstin = /^[0-9]{2}[0-9A-Z]{13}$/.test(ledger.gstin)
      ? ledger.gstin
      : '';
    const address = await this.importAddress(ledger, gstin);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ledger.email)
      ? ledger.email
      : undefined;

    await this.fyo.doc
      .getNewDoc(ModelNameEnum.Party, {
        name,
        role,
        gstType: gstin ? 'Registered Regular' : 'Unregistered',
        gstin: gstin || undefined,
        email,
        phone: ledger.phone || undefined,
        address,
      })
      .sync();
    this.result.parties += 1;
    return name;
  }

  async importAddress(ledger: TallyLedger, gstin: string) {
    const stateNames = Object.values(codeStateMap);
    const state =
      codeStateMap[gstin.slice(0, 2)] ??
      stateNames.find((s) => s.toLowerCase() === ledger.state.toLowerCase()) ??
      ledger.state;

    const lines = ledger.address;
    if (!lines.length && !state) {
      return undefined;
    }

    if (await this.fyo.db.exists(ModelNameEnum.Address, ledger.name)) {
      return undefined;
    }

    const address = this.fyo.doc.getNewDoc(ModelNameEnum.Address, {
      name: ledger.name,
      addressLine1: lines[0] ?? state,
      addressLine2: lines.slice(1, -1).join(', ') || undefined,
      city: lines.length > 1 ? lines[lines.length - 1] : state || lines[0],
      state: state || undefined,
      postalCode: ledger.pincode || undefined,
      country: 'India',
    });
    await address.sync();
    return address.name;
  }

  async importItems() {
    const units = new Set([
      ...this.data.units,
      ...this.data.stockItems.map((i) => i.unit),
    ]);
    for (const unit of units) {
      if (unit && !(await this.fyo.db.exists(ModelNameEnum.UOM, unit))) {
        await this.fyo.doc.getNewDoc(ModelNameEnum.UOM, { name: unit }).sync();
      }
    }

    for (const item of this.data.stockItems) {
      try {
        if (await this.fyo.db.exists(ModelNameEnum.Item, item.name)) {
          continue;
        }

        let tax: string | undefined;
        if (item.gstRate !== undefined) {
          const name = `GST-${item.gstRate}`;
          if (await this.fyo.db.exists(ModelNameEnum.Tax, name)) {
            tax = name;
          }
        }

        await this.fyo.doc
          .getNewDoc(ModelNameEnum.Item, {
            name: item.name,
            unit: item.unit || undefined,
            hsnCode: item.hsnCode || undefined,
            itemType: 'Product',
            for: 'Both',
            tax,
          })
          .sync();
        this.result.items += 1;
      } catch (error) {
        this.addError(t`Stock item ${item.name}`, error);
      }
    }
  }

  async importOpeningBalances() {
    const lines: JournalLine[] = [];
    for (const ledger of this.data.ledgers) {
      const target = this.ledgerTargets.get(ledger.name);
      if (target && ledger.openingBalance) {
        lines.push({ ...target, amount: ledger.openingBalance });
      }
    }

    const stockValue = this.data.stockItems.reduce(
      (sum, item) => sum + item.openingValue,
      0
    );
    if (stockValue) {
      const stock = this.findAccount(
        (a) => !a.isGroup && a.accountType === 'Stock'
      );
      if (stock) {
        lines.push({ account: stock.name, amount: -stockValue });
      }
    }

    if (!lines.length) {
      return;
    }

    const date =
      this.data.booksFrom ||
      this.data.vouchers
        .map((v) => v.date)
        .filter(Boolean)
        .sort()[0] ||
      new Date().toISOString().slice(0, 10);

    const difference = lines.reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(difference) >= 0.005) {
      const temporary = this.findAccount(
        (a) => !a.isGroup && a.accountType === 'Temporary'
      );
      if (!temporary) {
        this.result.errors.push(
          t`Opening balances do not match and no Temporary account was found`
        );
        return;
      }
      lines.push({ account: temporary.name, amount: -difference });
    }

    try {
      const posted = await this.postJournalEntry({
        entryType: 'Opening Entry',
        date,
        referenceNumber: OPENING_REFERENCE,
        userRemark: t`Opening balances imported from Tally`,
        lines,
      });
      this.result.openingEntry = posted;
    } catch (error) {
      this.addError(t`Opening balances`, error);
    }
  }

  async importVouchers(onProgress?: TallyImportProgress) {
    const total = this.data.vouchers.length;
    for (const [index, voucher] of this.data.vouchers.entries()) {
      const label = this.getReference(voucher) || voucher.date;
      try {
        const lines: JournalLine[] = [];
        for (const entry of voucher.entries) {
          const target = await this.getLedgerTarget(entry.ledger);
          lines.push({ ...target, amount: entry.amount });
        }

        const posted = await this.postJournalEntry({
          entryType: this.getEntryType(voucher, lines),
          date: voucher.date,
          referenceNumber: this.getReference(voucher),
          userRemark: voucher.narration,
          lines,
        });
        if (posted) {
          this.result.vouchers += 1;
        }
      } catch (error) {
        this.addError(t`Voucher ${label}`, error);
      }

      onProgress?.(index + 1, total);
    }
  }

  /**
   * Ledgers missing from the selected files may have been imported earlier.
   */
  async getLedgerTarget(ledger: string): Promise<LedgerTarget> {
    const known = this.ledgerTargets.get(ledger);
    if (known) {
      return known;
    }

    let target: LedgerTarget | undefined;
    const account = this.accounts.get(ledger);
    if (account && !account.isGroup) {
      target = { account: ledger };
    } else if (await this.fyo.db.exists(ModelNameEnum.Party, ledger)) {
      const role = await this.fyo.getValue(ModelNameEnum.Party, ledger, 'role');
      const mapping =
        role === 'Supplier'
          ? reservedGroups['Sundry Creditors']
          : reservedGroups['Sundry Debtors'];
      target = { account: this.getPartyAccount(mapping), party: ledger };
    }

    if (!target) {
      throw new Error(t`Ledger ${ledger} not found`);
    }

    this.ledgerTargets.set(ledger, target);
    return target;
  }

  getReference(voucher: TallyVoucher) {
    return [voucher.voucherType, voucher.number].filter(Boolean).join(' ');
  }

  getBaseVoucherType(voucherType: string) {
    const seen = new Set<string>();
    let current = voucherType;
    while (!baseVoucherTypes.includes(current) && !seen.has(current)) {
      seen.add(current);
      const parent = this.data.voucherTypes[current];
      if (!parent) {
        break;
      }
      current = parent;
    }
    return current;
  }

  getEntryType(voucher: TallyVoucher, lines: JournalLine[]) {
    const base = this.getBaseVoucherType(voucher.voucherType);
    if (base === 'Contra') {
      return 'Contra Entry';
    }

    if (base === 'Credit Note' || base === 'Debit Note') {
      return base;
    }

    if (base === 'Payment' || base === 'Receipt') {
      const isBank = lines.some(
        (l) => this.accounts.get(l.account)?.accountType === 'Bank'
      );
      return isBank ? 'Bank Entry' : 'Cash Entry';
    }

    return 'Journal Entry';
  }

  existingReferences?: Set<string>;

  async isDuplicate(referenceNumber: string, date: string) {
    if (!this.existingReferences) {
      const entries = (await this.fyo.db.getAllRaw(ModelNameEnum.JournalEntry, {
        fields: ['referenceNumber', 'date'],
        filters: { cancelled: false },
      })) as { referenceNumber: string | null; date: string | Date }[];

      this.existingReferences = new Set(
        entries
          .filter((e) => e.referenceNumber)
          .map((e) => `${e.referenceNumber ?? ''}|${toISODate(e.date)}`)
      );
    }

    const key = `${referenceNumber}|${date}`;
    if (this.existingReferences.has(key)) {
      return true;
    }

    this.existingReferences.add(key);
    return false;
  }

  /**
   * Posts a submitted Journal Entry, lines with negative amounts are debits.
   * Returns false if it was skipped as a duplicate or has no effect.
   */
  async postJournalEntry(entry: {
    entryType: string;
    date: string;
    referenceNumber: string;
    userRemark: string;
    lines: JournalLine[];
  }): Promise<boolean> {
    if (!entry.date) {
      throw new Error(t`Date is missing`);
    }

    const net = new Map<string, JournalLine>();
    for (const line of entry.lines) {
      const key = `${line.account}\u0000${line.party ?? ''}`;
      const existing = net.get(key);
      if (existing) {
        existing.amount += line.amount;
      } else {
        net.set(key, { ...line });
      }
    }

    const lines = [...net.values()].filter((l) => Math.abs(l.amount) >= 0.005);
    const difference = lines.reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(difference) >= 0.005) {
      throw new Error(
        t`Debit and credit differ by ${Math.abs(difference).toFixed(2)}`
      );
    }

    if (!lines.length) {
      return false;
    }

    if (
      entry.referenceNumber &&
      (await this.isDuplicate(entry.referenceNumber, entry.date))
    ) {
      this.result.duplicates += 1;
      return false;
    }

    const doc = this.fyo.doc.getNewDoc(ModelNameEnum.JournalEntry, {
      entryType: entry.entryType,
      date: entry.date,
      referenceNumber: entry.referenceNumber || undefined,
      referenceDate: entry.referenceNumber ? entry.date : undefined,
      userRemark: entry.userRemark || undefined,
      accounts: lines.map((l) => ({
        account: l.account,
        party: l.party,
        debit: this.fyo.pesa(l.amount < 0 ? -l.amount : 0),
        credit: this.fyo.pesa(l.amount > 0 ? l.amount : 0),
      })),
    });
    await doc.sync();
    await doc.submit();
    return true;
  }

  addError(label: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.result.errors.push(`${label}: ${message}`);
  }
}

function toISODate(date: string | Date) {
  if (date instanceof Date) {
    return date.toISOString().slice(0, 10);
  }
  return date.slice(0, 10);
}

export async function importTallyData(
  fyo: Fyo,
  data: TallyData,
  onProgress?: TallyImportProgress
) {
  return await new TallyImporter(fyo, data).import(onProgress);
}
