import { t } from 'fyo';
import { Action } from 'fyo/model/types';
import { DateTime } from 'luxon';
import { Money } from 'pesa';
import getCommonExportActions from 'reports/commonExporter';
import { Report } from 'reports/Report';
import { ColumnField, ReportCell, ReportData } from 'reports/types';
import { Field } from 'schemas/types';
import { getGSTR3BData, GSTR3BData, TaxHeads } from './gstr3bData';

export class GSTR3B extends Report {
  static title = 'GSTR-3B';
  static reportName = 'gstr-3b';

  fromDate?: string;
  toDate?: string;
  loading = false;

  setDefaultFilters() {
    // GSTR-3B is usually filed for the previous month.
    const lastMonth = DateTime.local().minus({ months: 1 });
    this.fromDate ??= lastMonth.startOf('month').toISODate();
    this.toDate ??= lastMonth.endOf('month').toISODate();
  }

  getFilters(): Field[] {
    return [
      {
        fieldtype: 'Date',
        label: t`From Date`,
        placeholder: t`From Date`,
        fieldname: 'fromDate',
      },
      {
        fieldtype: 'Date',
        label: t`To Date`,
        placeholder: t`To Date`,
        fieldname: 'toDate',
      },
    ];
  }

  getColumns(): ColumnField[] {
    return [
      {
        label: t`Nature of Supplies`,
        fieldname: 'description',
        fieldtype: 'Data',
        width: 3,
      },
      {
        label: t`Taxable Value`,
        fieldname: 'taxableValue',
        fieldtype: 'Currency',
      },
      {
        label: t`Integrated Tax`,
        fieldname: 'igst',
        fieldtype: 'Currency',
      },
      {
        label: t`Central Tax`,
        fieldname: 'cgst',
        fieldtype: 'Currency',
      },
      {
        label: t`State/UT Tax`,
        fieldname: 'sgst',
        fieldtype: 'Currency',
      },
    ];
  }

  getActions(): Action[] {
    return getCommonExportActions(this);
  }

  async setReportData(): Promise<void> {
    this.loading = true;
    const data = await getGSTR3BData(this.fyo, this.fromDate!, this.toDate!);
    this.reportData = this.getReportDataFromGSTR3B(data);
    this.loading = false;
  }

  getReportDataFromGSTR3B(data: GSTR3BData): ReportData {
    const rows: ReportData = [];
    const heading = (text: string) =>
      rows.push({
        cells: [
          this.textCell(text, { bold: true }),
          ...Array.from({ length: 4 }, () => this.moneyCell(undefined)),
        ],
      });
    const line = (text: string, values: Partial<TaxHeads>) =>
      rows.push({
        cells: [
          this.textCell(text, { indent: 1 }),
          this.moneyCell(values.taxableValue),
          this.moneyCell(values.igst),
          this.moneyCell(values.cgst),
          this.moneyCell(values.sgst),
        ],
      });
    const gap = () => rows.push({ cells: [], isEmpty: true });

    const { outward, itc, inward, payment } = data;
    heading(
      t`3.1 Outward supplies and inward supplies liable to reverse charge`
    );
    line(
      t`(a) Outward taxable supplies (other than zero rated, nil rated and exempted)`,
      outward.taxable
    );
    line(t`(b) Outward taxable supplies (zero rated)`, outward.zeroRated);
    line(
      t`(c) Other outward supplies (nil rated, exempted)`,
      outward.nilExempt
    );
    line(
      t`(d) Inward supplies (liable to reverse charge)`,
      outward.reverseChargeInward
    );
    line(t`(e) Non-GST outward supplies`, outward.nonGST);

    gap();
    heading(t`3.2 Inter-State supplies to unregistered persons`);
    if (!data.interStateUnregistered.length) {
      line(t`None`, {});
    }
    for (const { place, taxableValue, igst } of data.interStateUnregistered) {
      line(place, { taxableValue, igst });
    }

    gap();
    heading(t`4. Eligible ITC`);
    line(t`(A)(5) All other ITC`, { ...itc.allOther, taxableValue: undefined });
    line(t`(C) Net ITC available`, { ...itc.net, taxableValue: undefined });

    gap();
    heading(t`5. Exempt, nil rated and non-GST inward supplies`);
    line(t`Exempt and nil rated supply (Inter-State)`, {
      taxableValue: inward.nilExempt.inter,
    });
    line(t`Exempt and nil rated supply (Intra-State)`, {
      taxableValue: inward.nilExempt.intra,
    });
    line(t`Non-GST supply (Inter-State)`, {
      taxableValue: inward.nonGST.inter,
    });
    line(t`Non-GST supply (Intra-State)`, {
      taxableValue: inward.nonGST.intra,
    });

    gap();
    heading(t`6.1 Payment of tax (estimated)`);
    line(t`Tax payable`, { ...outward.taxable, taxableValue: undefined });
    line(t`ITC available`, { ...itc.net, taxableValue: undefined });
    line(t`Tax to be paid in cash`, {
      ...payment.cash,
      taxableValue: undefined,
    });
    line(t`ITC carried forward`, {
      ...payment.carryForward,
      taxableValue: undefined,
    });

    return rows;
  }

  textCell(value: string, options: Partial<ReportCell> = {}): ReportCell {
    return { value, rawValue: value, align: 'left', width: 3, ...options };
  }

  moneyCell(value: Money | undefined): ReportCell {
    if (value === undefined) {
      return { value: '', rawValue: '', align: 'right', width: 1 };
    }

    return {
      value: this.fyo.format(value, 'Currency'),
      rawValue: value.float,
      align: 'right',
      width: 1,
    };
  }
}
